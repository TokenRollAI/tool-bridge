import { SELF } from 'cloudflare:test'
import { type DeviceFrame, decodeDeviceFrame, encodeDeviceFrame } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { TEST_ADMIN_SK } from './fixtures'

const adminHeaders = { authorization: `Bearer ${TEST_ADMIN_SK}` }

function admin(extra: RequestInit = {}): RequestInit {
  return { ...extra, headers: { ...adminHeaders, ...(extra.headers ?? {}) } }
}

async function postJson(path: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://tb.test/${path}`, {
    method: 'POST',
    ...init,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

async function issueSk(input: unknown): Promise<string> {
  const res = await postJson('system/sk', { tool: 'write', arguments: input }, admin())
  expect(res.status).toBe(200)
  const body = (await res.json()) as { secret: string }
  return body.secret
}

function nextFrame(ws: WebSocket): Promise<DeviceFrame> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      cleanup()
      try {
        resolve(decodeDeviceFrame(String(event.data)))
      } catch (err) {
        reject(err)
      }
    }
    const onClose = () => {
      cleanup()
      reject(new Error('websocket closed before next frame'))
    }
    const cleanup = () => {
      ws.removeEventListener('message', onMessage)
      ws.removeEventListener('close', onClose)
    }
    ws.addEventListener('message', onMessage)
    ws.addEventListener('close', onClose)
  })
}

async function connectDevice(
  deviceId: string,
  init: {
    sk?: string
    mountPath?: string
    shell?: { allow?: string[] }
    fs?: { roots: string[]; readOnly?: boolean }
  } = {},
): Promise<WebSocket> {
  const res = await SELF.fetch(`https://tb.test/system/device/ws?deviceId=${deviceId}`, {
    headers: {
      authorization: `Bearer ${init.sk ?? TEST_ADMIN_SK}`,
      upgrade: 'websocket',
    },
  })
  expect(res.status).toBe(101)
  const ws = res.webSocket
  expect(ws).toBeDefined()
  ws?.accept()
  const ready = nextFrame(ws as WebSocket)
  ws?.send(
    encodeDeviceFrame({
      type: 'hello',
      deviceId,
      ...(init.mountPath !== undefined ? { mountPath: init.mountPath } : {}),
      expose: {
        ...(init.shell !== undefined ? { shell: init.shell } : {}),
        ...(init.fs !== undefined ? { fs: init.fs } : {}),
      },
    }),
  )
  expect(await ready).toMatchObject({
    type: 'ready',
    mountPath: init.mountPath ?? `device/${deviceId}`,
  })
  return ws as WebSocket
}

describe('DeviceSession DO + /system/device/ws(Phase 4)', () => {
  it('无 SK 的 WS 连接 → 401', async () => {
    const res = await SELF.fetch('https://tb.test/system/device/ws?deviceId=noauth', {
      headers: { upgrade: 'websocket' },
    })
    expect(res.status).toBe(401)
  })

  it('hello 后注册 shell/fs 节点,HTTP 调 shell 经 WS 回帧成功,断线后 503', async () => {
    const deviceId = `d-${crypto.randomUUID().slice(0, 8)}`
    const ws = await connectDevice(deviceId, {
      shell: { allow: ['echo'] },
      fs: { roots: ['/tmp'], readOnly: true },
    })

    const treeRes = await SELF.fetch('https://tb.test/~tree?depth=4', {
      headers: { ...adminHeaders, accept: 'application/json' },
    })
    expect(treeRes.status).toBe(200)
    const treeText = await treeRes.text()
    expect(treeText).toContain(`device/${deviceId}`)
    expect(treeText).toContain(`device/${deviceId}/shell`)
    expect(treeText).toContain(`device/${deviceId}/fs`)

    const helpRes = await SELF.fetch(`https://tb.test/device/${deviceId}/shell/~help`, admin())
    expect(helpRes.status).toBe(200)
    const help = await helpRes.text()
    expect(help).toContain('cmd exec POST')
    expect(help).toContain('scope call')
    expect(help).toContain('effect destructive')
    expect(help).toContain('允许命令: echo;其余拒绝')

    const callSeen = nextFrame(ws)
    const invoke = postJson(
      `device/${deviceId}/shell`,
      { tool: 'exec', arguments: { command: 'echo hi' } },
      admin(),
    )
    const call = await callSeen
    expect(call).toMatchObject({
      type: 'call',
      path: 'shell',
      tool: 'exec',
      arguments: { command: 'echo hi' },
    })
    if (call.type !== 'call') throw new Error('expected call frame')
    ws.send(
      encodeDeviceFrame({
        type: 'result',
        id: call.id,
        ok: true,
        value: { stdout: 'hi\n', stderr: '', exitCode: 0 },
      }),
    )
    const invokeRes = await invoke
    expect(invokeRes.status).toBe(200)
    expect(await invokeRes.json()).toEqual({ stdout: 'hi\n', stderr: '', exitCode: 0 })

    const fsCallSeen = nextFrame(ws)
    const fsInvoke = postJson(
      `device/${deviceId}/fs`,
      { tool: 'Get', arguments: { path: 'tmp/note.txt' } },
      admin(),
    )
    const fsCall = await fsCallSeen
    expect(fsCall).toMatchObject({
      type: 'call',
      path: 'fs',
      tool: 'Get',
      arguments: { path: 'tmp/note.txt' },
    })
    if (fsCall.type !== 'call') throw new Error('expected fs call frame')
    ws.send(
      encodeDeviceFrame({
        type: 'result',
        id: fsCall.id,
        ok: true,
        value: {
          uri: `node://device/${deviceId}/fs/tmp/note.txt`,
          contentType: 'text/plain',
          version: 'v1',
          updatedAt: '2026-07-07T00:00:00Z',
          metadata: {},
          content: 'hello fs',
        },
      }),
    )
    const fsRes = await fsInvoke
    expect(fsRes.status).toBe(200)
    expect(await fsRes.json()).toMatchObject({ content: 'hello fs' })

    ws.close(1000)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const offline = await postJson(
      `device/${deviceId}/shell`,
      { tool: 'exec', arguments: { command: 'echo hi' } },
      admin(),
    )
    expect(offline.status).toBe(503)
    const body = (await offline.json()) as { code: string; retryable: boolean }
    expect(body).toMatchObject({ code: 'unavailable', retryable: true })

    const ws2 = await connectDevice(deviceId, {
      shell: { allow: ['echo'] },
      fs: { roots: ['/tmp'], readOnly: true },
    })
    const restoredCallSeen = nextFrame(ws2)
    const restoredInvoke = postJson(
      `device/${deviceId}/shell`,
      { tool: 'exec', arguments: { command: 'echo again' } },
      admin(),
    )
    const restoredCall = await restoredCallSeen
    expect(restoredCall).toMatchObject({
      type: 'call',
      path: 'shell',
      tool: 'exec',
      arguments: { command: 'echo again' },
    })
    if (restoredCall.type !== 'call') throw new Error('expected restored call frame')
    ws2.send(
      encodeDeviceFrame({
        type: 'result',
        id: restoredCall.id,
        ok: true,
        value: { stdout: 'again\n', stderr: '', exitCode: 0 },
      }),
    )
    const restoredRes = await restoredInvoke
    expect(restoredRes.status).toBe(200)
    expect(await restoredRes.json()).toEqual({ stdout: 'again\n', stderr: '', exitCode: 0 })
    ws2.close(1000)
  })

  it('registerPaths 限定:默认路径被拒,指定允许路径成功', async () => {
    const allowedPath = `device/allowed-${crypto.randomUUID().slice(0, 8)}`
    const sk = await issueSk({
      owner: 'device:limited',
      scopes: [{ pattern: '**', actions: ['read', 'register', 'call'] }],
      registerPaths: [allowedPath],
    })
    const deniedId = `denied-${crypto.randomUUID().slice(0, 8)}`
    const deniedRes = await SELF.fetch(`https://tb.test/system/device/ws?deviceId=${deniedId}`, {
      headers: { authorization: `Bearer ${sk}`, upgrade: 'websocket' },
    })
    expect(deniedRes.status).toBe(101)
    const denied = deniedRes.webSocket
    expect(denied).toBeDefined()
    denied?.accept()
    const deniedFrame = nextFrame(denied as WebSocket)
    denied?.send(
      encodeDeviceFrame({
        type: 'hello',
        deviceId: deniedId,
        expose: { shell: { allow: ['echo'] } },
      }),
    )
    expect(await deniedFrame).toMatchObject({
      type: 'error',
      error: { code: 'permission_denied' },
    })
    denied?.close(1000)

    const allowed = await connectDevice(`allowed-${crypto.randomUUID().slice(0, 8)}`, {
      sk,
      mountPath: allowedPath,
      shell: { allow: ['echo'] },
    })
    allowed.close(1000)
  })
})
