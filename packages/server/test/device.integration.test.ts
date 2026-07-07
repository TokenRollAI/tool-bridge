/**
 * DeviceHub 集成测试:真实 http + ws 客户端全链路(帧手写,不依赖 SDK)。
 * 覆盖:升级认证(无/错 SK 401 且树零污染)、hello→挂树 online→HTTP 调用→result 回传、
 * requestId 幂等、断线→online:false→短 reclaim 子树删除、崩溃重启孤儿回收、
 * 回收窗口内重连不误删。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { configFromEnv, createTbServer, type TbServer } from '../src'

const ADMIN_SK = 'tbk_server_test_admin_00000000'
const ENCRYPTION_KEY = '3ZwpbBkSrp3eT9ylcZedfN33yq9fJLlmeusH98qNbt8'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function tmpDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-device-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

async function startServer(
  dataDir: string,
  reclaimSec = 60,
): Promise<{ server: TbServer; baseUrl: string; wsBase: string }> {
  const config = configFromEnv({
    TB_PORT: '0',
    TB_HOST: '127.0.0.1',
    TB_DATA_DIR: dataDir,
    TB_BOOTSTRAP_ADMIN_SK: ADMIN_SK,
    TB_SECRET_ENCRYPTION_KEY: ENCRYPTION_KEY,
    TB_DEVICE_RECLAIM_SEC: String(reclaimSec),
  })
  const server = createTbServer(config)
  const { port } = await server.start()
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    wsBase: `ws://127.0.0.1:${port}`,
  }
}

const admin = (extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { authorization: `Bearer ${ADMIN_SK}`, ...(extra.headers ?? {}) },
})

async function registryGet(baseUrl: string, path: string): Promise<Response> {
  return fetch(`${baseUrl}/system/registry`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ADMIN_SK}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ tool: 'get', arguments: { path } }),
  })
}

/** 建 ws 连接;resolve 于 open,或 reject 于非 101 应答(带 statusCode)。 */
function wsConnect(wsBase: string, deviceId: string, sk?: string): Promise<WebSocket> {
  const ws = new WebSocket(`${wsBase}/system/device/ws?deviceId=${deviceId}`, {
    ...(sk !== undefined ? { headers: { authorization: `Bearer ${sk}` } } : {}),
  })
  cleanups.push(() => ws.terminate())
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws))
    ws.on('unexpected-response', (_req, res) => {
      reject(new Error(`upgrade rejected: ${res.statusCode}`))
    })
    ws.on('error', (err) => reject(err))
  })
}

/** 收下一帧(JSON 解码);超时抛错。 */
function nextFrame(ws: WebSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('frame timeout')), timeoutMs)
    ws.once('message', (data) => {
      clearTimeout(timer)
      resolve(JSON.parse(data.toString()) as Record<string, unknown>)
    })
  })
}

/** 接入一台设备:hello(shell expose)→ 等 ready;附带自动应答 exec 调用。 */
async function connectDevice(
  wsBase: string,
  deviceId: string,
  opts: { autoReply?: boolean } = {},
): Promise<WebSocket> {
  const ws = await wsConnect(wsBase, deviceId, ADMIN_SK)
  const ready = nextFrame(ws)
  ws.send(
    JSON.stringify({
      type: 'hello',
      deviceId,
      expose: { shell: { allow: ['echo'] } },
    }),
  )
  const frame = await ready
  expect(frame.type).toBe('ready')
  expect(frame.mountPath).toBe(`device/${deviceId}`)
  if (opts.autoReply !== false) {
    ws.on('message', (data) => {
      const f = JSON.parse(data.toString()) as { type: string; id?: string; arguments?: unknown }
      if (f.type === 'call' && f.id !== undefined) {
        ws.send(
          JSON.stringify({
            type: 'result',
            id: f.id,
            ok: true,
            value: { stdout: 'device says hi-node', exitCode: 0 },
          }),
        )
      }
    })
  }
  return ws
}

describe('DeviceHub 升级认证', () => {
  it('无 SK / 错 SK → 握手 401,树上无 device 节点(认证旁路守护)', async () => {
    const { server, baseUrl, wsBase } = await startServer(tmpDataDir())
    cleanups.push(() => server.close())

    await expect(wsConnect(wsBase, 'nokey')).rejects.toThrow('upgrade rejected: 401')
    await expect(wsConnect(wsBase, 'badkey', 'tbk_bogus')).rejects.toThrow('upgrade rejected: 401')

    const tree = await fetch(
      `${baseUrl}/~tree?depth=3`,
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(JSON.stringify(await tree.json())).not.toContain('device/')
  })

  it('非 device 路径的升级请求 → 404', async () => {
    const { server, wsBase } = await startServer(tmpDataDir())
    cleanups.push(() => server.close())
    const ws = new WebSocket(`${wsBase}/elsewhere`, {
      headers: { authorization: `Bearer ${ADMIN_SK}` },
    })
    cleanups.push(() => ws.terminate())
    await expect(
      new Promise((resolve, reject) => {
        ws.on('open', resolve)
        ws.on('unexpected-response', (_req, res) =>
          reject(new Error(`upgrade rejected: ${res.statusCode}`)),
        )
        ws.on('error', reject)
      }),
    ).rejects.toThrow('upgrade rejected: 404')
  })
})

describe('DeviceHub 全链路', () => {
  it('hello→ready 挂树 online;HTTP 调用经帧转发回传结果', async () => {
    const { server, baseUrl, wsBase } = await startServer(tmpDataDir())
    cleanups.push(() => server.close())
    await connectDevice(wsBase, 'dev1')

    const node = await registryGet(baseUrl, 'device/dev1')
    expect(node.status).toBe(200)
    expect(JSON.stringify(await node.json())).toContain('"online":true')

    const call = await fetch(`${baseUrl}/device/dev1/shell`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ADMIN_SK}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ tool: 'exec', arguments: { command: 'echo hi' } }),
    })
    expect(call.status).toBe(200)
    expect(await call.text()).toContain('device says hi-node')
  })

  it('requestId 幂等:同 id 重复 invoke 不重复下发,以首次结果应答', async () => {
    const { server, wsBase } = await startServer(tmpDataDir())
    cleanups.push(() => server.close())
    const ws = await connectDevice(wsBase, 'dev2', { autoReply: false })

    let callFrames = 0
    ws.on('message', (data) => {
      const f = JSON.parse(data.toString()) as { type: string; id?: string }
      if (f.type === 'call' && f.id !== undefined) {
        callFrames++
        ws.send(JSON.stringify({ type: 'result', id: f.id, ok: true, value: { n: callFrames } }))
      }
    })

    const req = { id: 'fixed-id-1', path: 'shell', tool: 'exec', arguments: {} }
    const first = (await server.deviceHub.invoke('dev2', req)) as { ok: boolean; value: unknown }
    const second = (await server.deviceHub.invoke('dev2', req)) as { ok: boolean; value: unknown }
    expect(first).toEqual({ ok: true, value: { n: 1 } })
    expect(second).toEqual(first)
    expect(callFrames).toBe(1)
  })

  it('无活连接的设备 invoke → deviceOffline', async () => {
    const { server } = await startServer(tmpDataDir())
    cleanups.push(() => server.close())
    const res = (await server.deviceHub.invoke('ghost', {
      id: 'x',
      path: 'shell',
      tool: 'exec',
      arguments: {},
    })) as { ok: boolean; error?: { code: string } }
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('unavailable')
  })
})

describe('DeviceHub 断线回收', () => {
  it('断连 → online:false;短 reclaim 后子树删除', async () => {
    const { server, baseUrl, wsBase } = await startServer(tmpDataDir(), 1)
    cleanups.push(() => server.close())
    const ws = await connectDevice(wsBase, 'dev3')

    ws.close()
    await sleep(300)
    const node = await registryGet(baseUrl, 'device/dev3')
    expect(JSON.stringify(await node.json())).toContain('"online":false')

    await sleep(1200)
    const gone = await registryGet(baseUrl, 'device/dev3')
    expect(gone.status).toBe(404)
  })

  it('崩溃重启(meta 无 disconnectedAt)→ sweepOrphans 排程回收', async () => {
    const dataDir = tmpDataDir()
    const first = await startServer(dataDir, 1)
    await connectDevice(first.wsBase, 'dev4')
    // close() 先清空 activeByDevice 再 terminate → onClose 早退,meta 保持"在线"崩溃态。
    await first.server.close()

    const second = await startServer(dataDir, 1)
    cleanups.push(() => second.server.close())
    // 崩溃态按启动时刻起算:1s reclaim + 余量后子树删除。
    await sleep(1500)
    const gone = await registryGet(second.baseUrl, 'device/dev4')
    expect(gone.status).toBe(404)
  })

  it('回收窗口内重连 → timer 取消,树保留', async () => {
    const dataDir = tmpDataDir()
    const first = await startServer(dataDir, 2)
    await connectDevice(first.wsBase, 'dev5')
    await first.server.close()

    const second = await startServer(dataDir, 2)
    cleanups.push(() => second.server.close())
    // 窗口内(2s)重连;再等超过原回收时刻,断言未被误删。
    await connectDevice(second.wsBase, 'dev5')
    await sleep(2500)
    const node = await registryGet(second.baseUrl, 'device/dev5')
    expect(node.status).toBe(200)
    expect(JSON.stringify(await node.json())).toContain('"online":true')
  })
})
