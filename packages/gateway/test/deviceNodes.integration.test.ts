/**
 * expose.nodes 自定义节点的 HTTP→WS 调用转发:
 * hello 携带自定义 tool 节点(含 cmds 工具表)→ 树上出现、~help 列工具表、
 * HTTP 调用经帧协议 call 转发(path 相对 mountPath)、断线 503 retryable;
 * 注册面手工伪造 device 转发标记 → 拒。
 */

import { SELF } from 'cloudflare:test'
import {
  type DeviceExpose,
  type DeviceFrame,
  decodeDeviceFrame,
  encodeDeviceFrame,
} from '@tool-bridge/core'
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

async function connectDevice(deviceId: string, expose: DeviceExpose): Promise<WebSocket> {
  const res = await SELF.fetch(`https://tb.test/system/device/ws?deviceId=${deviceId}`, {
    headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, upgrade: 'websocket' },
  })
  expect(res.status).toBe(101)
  const ws = res.webSocket as WebSocket
  expect(ws).toBeDefined()
  ws.accept()
  const ready = nextFrame(ws)
  ws.send(encodeDeviceFrame({ type: 'hello', deviceId, expose }))
  expect(await ready).toMatchObject({ type: 'ready', mountPath: `device/${deviceId}` })
  return ws
}

describe('expose.nodes 自定义节点转发', () => {
  it('hello 带自定义 tool 节点 → 树上出现、~help 列工具表、调用经 WS call 转发、断线 503', async () => {
    const deviceId = `sdk-${crypto.randomUUID().slice(0, 8)}`
    const ws = await connectDevice(deviceId, {
      nodes: [
        {
          path: 'tools/echo',
          kind: 'tool',
          description: '回声工具',
          cmds: [
            {
              name: 'echo',
              description: '原样返回入参',
              inputSchema: {
                type: 'object',
                required: ['text'],
                properties: { text: { type: 'string' } },
              },
              effect: 'read',
            },
          ],
        },
        // 无 cmds 的节点(老客户端向后兼容):~help 只有节点描述。
        { path: 'tools/bare', kind: 'tool', description: '无工具表节点' },
      ],
    })

    const treeRes = await SELF.fetch('https://tb.test/~tree?depth=5', {
      headers: { ...adminHeaders, accept: 'application/json' },
    })
    expect(treeRes.status).toBe(200)
    const treeText = await treeRes.text()
    expect(treeText).toContain(`device/${deviceId}/tools/echo`)
    expect(treeText).toContain(`device/${deviceId}/tools/bare`)

    // 节点级 ~help:索引形态列工具表(两级披露与 mcp/http 对齐)。
    const helpRes = await SELF.fetch(`https://tb.test/device/${deviceId}/tools/echo/~help`, admin())
    expect(helpRes.status).toBe(200)
    const help = await helpRes.text()
    expect(help).toContain('cmd echo POST')
    expect(help).toContain('scope call')
    expect(help).toContain('原样返回入参')

    // 工具级 ~help:全量 spec 来自注册时缓存的 cmds,不打设备。
    const toolHelpRes = await SELF.fetch(
      `https://tb.test/device/${deviceId}/tools/echo/echo/~help`,
      admin(),
    )
    expect(toolHelpRes.status).toBe(200)
    expect(await toolHelpRes.text()).toContain('text')

    // 无 cmds 节点:~help 只有节点描述,无 cmd 行。
    const bareHelpRes = await SELF.fetch(
      `https://tb.test/device/${deviceId}/tools/bare/~help`,
      admin(),
    )
    expect(bareHelpRes.status).toBe(200)
    const bareHelp = await bareHelpRes.text()
    expect(bareHelp).toContain('无工具表节点')
    expect(bareHelp).not.toContain('cmd ')

    // HTTP 调用 → WS call 帧(path 相对 mountPath)→ result 回 200。
    const callSeen = nextFrame(ws)
    const invoke = postJson(
      `device/${deviceId}/tools/echo`,
      { tool: 'echo', arguments: { text: 'hi' } },
      admin(),
    )
    const call = await callSeen
    expect(call).toMatchObject({
      type: 'call',
      path: 'tools/echo',
      tool: 'echo',
      arguments: { text: 'hi' },
    })
    if (call.type !== 'call') throw new Error('expected call frame')
    ws.send(encodeDeviceFrame({ type: 'result', id: call.id, ok: true, value: { echoed: 'hi' } }))
    const invokeRes = await invoke
    expect(invokeRes.status).toBe(200)
    expect(await invokeRes.json()).toEqual({ echoed: 'hi' })

    // 设备断开 → 503 unavailable retryable(与 shell 口径一致)。
    ws.close(1000)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const offline = await postJson(
      `device/${deviceId}/tools/echo`,
      { tool: 'echo', arguments: { text: 'hi' } },
      admin(),
    )
    expect(offline.status).toBe(503)
    expect(await offline.json()).toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('注册面手工携带 device 转发标记 → invalid_argument 拒(标记仅网关代写)', async () => {
    const path = `forge/${crypto.randomUUID().slice(0, 8)}`
    const res = await postJson(
      `${path}/~register`,
      {
        path,
        kind: 'tool',
        description: '伪造设备标记',
        config: {
          kind: 'tool',
          provider: 'whatever',
          providerConfig: { deviceId: 'victim', mountPath: 'device/victim' },
        },
      },
      admin(),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'invalid_argument' })
  })
})
