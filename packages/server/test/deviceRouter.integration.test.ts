/**
 * 多副本设备通道:跨副本调用转发的集成测试。
 *
 * 真起**两个** server 副本(共享同一 PG 状态 + 同一 Redis),设备只连副本 A,
 * 然后把调用打到副本 B —— B 手里没有那个 socket,必须经 Redis 转发给 A 再把结果收回。
 * 这是"横向扩容"真正要证明的事,单副本测试无论如何覆盖不到。
 *
 * 需要 Redis(TB_TEST_REDIS_URL)+ PG(TB_TEST_DATABASE_URL);缺任一整组 skip。
 * 状态必须共享:两副本各持一份 SQLite 的话,设备节点在 B 上根本不存在,
 * 那验证的是状态存储而不是调用路由。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import postgres, { type Sql } from 'postgres'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Redis } from 'ioredis'
import { WebSocket } from 'ws'
import { configFromEnv, createTbServer, DEVICE_WS_PATH, type TbServer } from '../src'

const ADMIN_SK = 'tbk_router_test_admin_00000000'
const ENCRYPTION_KEY = '3ZwpbBkSrp3eT9ylcZedfN33yq9fJLlmeusH98qNbt8'
const REDIS_URL = process.env.TB_TEST_REDIS_URL
const DATABASE_URL = process.env.TB_TEST_DATABASE_URL
const suite = REDIS_URL !== undefined && DATABASE_URL !== undefined ? describe : describe.skip
const SCHEMA = 'tb_router_test'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

function tmpDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-router-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

interface Replica {
  baseUrl: string
  server: TbServer
  wsBase: string
}

/** 起一个副本;replicaId 显式给 —— 同机两进程 hostname 相同,缺省值区分不开。 */
async function startReplica(replicaId: string, databaseUrl: string): Promise<Replica> {
  const config = configFromEnv({
    TB_PORT: '0',
    TB_HOST: '127.0.0.1',
    TB_DATA_DIR: tmpDataDir(),
    TB_BOOTSTRAP_ADMIN_SK: ADMIN_SK,
    TB_SECRET_ENCRYPTION_KEY: ENCRYPTION_KEY,
    TB_DATABASE_URL: databaseUrl,
    TB_REDIS_URL: REDIS_URL as string,
    TB_REPLICA_ID: replicaId,
  })
  const server = createTbServer(config)
  const { port } = await server.start()
  cleanups.push(async () => await server.close())
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    wsBase: `ws://127.0.0.1:${port}`,
  }
}

async function wsConnect(wsBase: string, deviceId: string): Promise<WebSocket> {
  const ws = new WebSocket(`${wsBase}${DEVICE_WS_PATH}?deviceId=${deviceId}`, {
    headers: { authorization: `Bearer ${ADMIN_SK}` },
  })
  cleanups.push(() => ws.terminate())
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('unexpected-response', (_req, res) =>
      reject(new Error(`upgrade rejected: ${res.statusCode}`)))
    ws.on('error', reject)
  })
  return ws
}

async function nextFrame(ws: WebSocket, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('frame timeout')), timeoutMs)
    ws.once('message', (data) => {
      clearTimeout(timer)
      resolve(JSON.parse(data.toString()) as Record<string, unknown>)
    })
  })
}

/** 接入设备并自动应答 shell 调用;回显 replicaTag 以证明结果确实来自该设备。 */
async function connectDevice(
  wsBase: string,
  deviceId: string,
  replicaTag: string,
): Promise<WebSocket> {
  const ws = await wsConnect(wsBase, deviceId)
  const ready = nextFrame(ws)
  ws.send(JSON.stringify({
    type: 'hello',
    deviceId,
    expose: { shell: { allow: ['echo'] } },
  }))
  const frame = await ready
  expect(frame.type).toBe('ready')
  ws.on('message', (data) => {
    const f = JSON.parse(data.toString()) as { arguments?: unknown, id?: string, type: string }
    if (f.type === 'call' && f.id !== undefined) {
      ws.send(JSON.stringify({
        type: 'result',
        id: f.id,
        ok: true,
        value: { stdout: `device-on-${replicaTag}`, exitCode: 0 },
      }))
    }
  })
  return ws
}

async function callShell(baseUrl: string, deviceId: string): Promise<{
  body: string
  status: number
}> {
  const response = await fetch(`${baseUrl}/device/${deviceId}/shell`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${ADMIN_SK}`,
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({ tool: 'exec', arguments: { command: 'echo hi' } }),
  })
  return { status: response.status, body: JSON.stringify(await response.json()) }
}

async function prepareShared(): Promise<{ admin: Sql, databaseUrl: string }> {
  const admin = postgres(DATABASE_URL as string, { max: 2, onnotice: () => {} })
  await admin.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await admin.unsafe(`CREATE SCHEMA ${SCHEMA}`)
  const url = new URL(DATABASE_URL as string)
  url.searchParams.set('options', `-c search_path=${SCHEMA},public`)
  const redis = new Redis(REDIS_URL as string)
  const keys = await redis.keys('tb:device:route:*')
  if (keys.length > 0) await redis.del(...keys)
  await redis.quit()
  cleanups.push(async () => {
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    await admin.end({ timeout: 5 })
  })
  return { admin, databaseUrl: url.toString() }
}

suite('多副本设备通道(Redis 路由 + 跨副本转发)', () => {
  it('设备连在副本 A,调用打到副本 B 也能成功', async () => {
    const { databaseUrl } = await prepareShared()
    const a = await startReplica('replica-a', databaseUrl)
    const b = await startReplica('replica-b', databaseUrl)
    const deviceId = 'crossdev1'
    await connectDevice(a.wsBase, deviceId, 'a')

    // 基线:打到持有者副本,本地直连。
    const viaA = await callShell(a.baseUrl, deviceId)
    expect(viaA.status).toBe(200)
    expect(viaA.body).toContain('device-on-a')

    // 核心:打到 B。B 没有这个 socket,必须转发给 A —— 这条断言就是横向扩容本身。
    const viaB = await callShell(b.baseUrl, deviceId)
    expect(viaB.status).toBe(200)
    expect(viaB.body).toContain('device-on-a')
  }, 120_000)

  it('路由表记录持有者;设备迁移到另一副本后随之更新,反向转发也通', async () => {
    const { databaseUrl } = await prepareShared()
    const a = await startReplica('replica-a3', databaseUrl)
    const b = await startReplica('replica-b3', databaseUrl)
    const deviceId = 'migratedev1'
    const redis = new Redis(REDIS_URL as string)
    cleanups.push(async () => {
      await redis.quit()
    })

    const first = await connectDevice(a.wsBase, deviceId, 'a')
    expect(await redis.get(`tb:device:route:${deviceId}`)).toBe('replica-a3')
    first.close()
    await new Promise(resolve => setTimeout(resolve, 1_500))

    // 重连到 B:路由指向 B,且从 A 发起的调用要能转发过去(方向与上一条相反)。
    await connectDevice(b.wsBase, deviceId, 'b')
    expect(await redis.get(`tb:device:route:${deviceId}`)).toBe('replica-b3')
    const viaA = await callShell(a.baseUrl, deviceId)
    expect(viaA.status).toBe(200)
    expect(viaA.body).toContain('device-on-b')
  }, 120_000)

  it('设备断开后另一副本的调用即时返回离线,不永久挂起', async () => {
    const { databaseUrl } = await prepareShared()
    const a = await startReplica('replica-a2', databaseUrl)
    const b = await startReplica('replica-b2', databaseUrl)
    const deviceId = 'offlinedev1'
    const device = await connectDevice(a.wsBase, deviceId, 'a')

    expect((await callShell(b.baseUrl, deviceId)).body).toContain('device-on-a')

    device.close()
    await new Promise(resolve => setTimeout(resolve, 1_500))

    // 关键是**不挂起**:转发超时是 65s,这里必须远快于它返回离线。
    const started = Date.now()
    const afterClose = await callShell(b.baseUrl, deviceId)
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(afterClose.body).toMatch(/offline|unavailable/i)
  }, 120_000)
})

suite('多副本回收安全', () => {
  /**
   * reclaim 会 deleteSubtree —— 删数据。多副本下"本副本没有该连接"不等于"设备离线",
   * 只看本地 Map 会误删一个仍在线设备的整棵子树。这里用极短 reclaimSec 逼出竞态:
   * 设备连在 A,B 的回收 timer 到期时必须查全局路由并放弃回收。
   */
  it('副本 B 的回收 timer 不会删掉仍连在副本 A 的设备子树', async () => {
    const { databaseUrl } = await prepareShared()
    const deviceId = 'reclaimdev1'
    const a = await startReplica('replica-ar', databaseUrl)
    await connectDevice(a.wsBase, deviceId, 'a')

    // B 以 1 秒回收起,且启动时会 sweepOrphans:它看到 devicemeta 却本地无连接。
    const bConfig = configFromEnv({
      TB_PORT: '0',
      TB_HOST: '127.0.0.1',
      TB_DATA_DIR: tmpDataDir(),
      TB_BOOTSTRAP_ADMIN_SK: ADMIN_SK,
      TB_SECRET_ENCRYPTION_KEY: ENCRYPTION_KEY,
      TB_DATABASE_URL: databaseUrl,
      TB_REDIS_URL: REDIS_URL as string,
      TB_REPLICA_ID: 'replica-br',
      TB_DEVICE_RECLAIM_SEC: '1',
    })
    const b = createTbServer(bConfig)
    const { port } = await b.start()
    cleanups.push(async () => await b.close())
    // 给回收 timer 充分到期的时间。
    await new Promise(resolve => setTimeout(resolve, 3_000))

    // 设备仍应可调用:子树没被 B 删掉。
    const viaA = await callShell(a.baseUrl, deviceId)
    expect(viaA.status).toBe(200)
    expect(viaA.body).toContain('device-on-a')
    // 从 B 也仍能转发过去。
    const viaB = await callShell(`http://127.0.0.1:${port}`, deviceId)
    expect(viaB.status).toBe(200)
    expect(viaB.body).toContain('device-on-a')
  }, 120_000)
})
