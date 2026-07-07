/**
 * Node 宿主集成测试:真实 http(port 0)全 wire 断言(与 curl 等价,不直捣内部对象)。
 * 覆盖:healthz / 认证 / ~help / ~register 挂树 / 重启同 dataDir 数据持久(User Case #4
 * 核心断言)/ SK 吊销即时生效(SQLite 强一致,无 KV 最终一致窗口)。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import pkg from '../package.json' with { type: 'json' }
import { configFromEnv, createTbServer, type TbServer } from '../src'

const ADMIN_SK = 'tbk_server_test_admin_00000000'
const ENCRYPTION_KEY = '3ZwpbBkSrp3eT9ylcZedfN33yq9fJLlmeusH98qNbt8'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

function tmpDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-server-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

async function startServer(dataDir: string): Promise<{ server: TbServer; baseUrl: string }> {
  const config = configFromEnv({
    TB_PORT: '0',
    TB_HOST: '127.0.0.1',
    TB_DATA_DIR: dataDir,
    TB_BOOTSTRAP_ADMIN_SK: ADMIN_SK,
    TB_SECRET_ENCRYPTION_KEY: ENCRYPTION_KEY,
  })
  const server = createTbServer(config)
  const { port } = await server.start()
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

const admin = (extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { authorization: `Bearer ${ADMIN_SK}`, ...(extra.headers ?? {}) },
})

async function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${baseUrl}/${path}`, {
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

describe('Node 宿主 HTTP 面', () => {
  it('healthz 免认证;~help 无 SK 401、Admin SK 200 且首行 htbp 0.1', async () => {
    const { server, baseUrl } = await startServer(tmpDataDir())
    cleanups.push(() => server.close())

    const health = await fetch(`${baseUrl}/healthz`)
    expect(health.status).toBe(200)
    const healthBody = (await health.json()) as { healthy: boolean; version: string }
    expect(healthBody.healthy).toBe(true)
    expect(healthBody.version).toBe(pkg.version)

    const anon = await fetch(`${baseUrl}/~help`)
    expect(anon.status).toBe(401)
    const anonBody = (await anon.json()) as { code: string }
    expect(anonBody.code).toBe('permission_denied')

    const help = await fetch(`${baseUrl}/~help`, admin())
    expect(help.status).toBe(200)
    const text = await help.text()
    expect(text.split('\n')[0]).toBe('htbp 0.1')
    expect(text).toContain('system')
  })

  it('重启同 dataDir:注册的节点在新进程仍在(User Case #4)', async () => {
    const dataDir = tmpDataDir()
    const first = await startServer(dataDir)
    const reg = await postJson(
      first.baseUrl,
      'docs/notes/~register',
      { path: 'docs/notes', kind: 'directory', description: 'persisted across restarts' },
      admin(),
    )
    expect(reg.status).toBe(200)
    await first.server.close()

    const second = await startServer(dataDir)
    cleanups.push(() => second.server.close())
    const tree = await fetch(
      `${second.baseUrl}/~tree?depth=3`,
      admin({ headers: { accept: 'application/json' } }),
    )
    expect(tree.status).toBe(200)
    const treeBody = JSON.stringify(await tree.json())
    expect(treeBody).toContain('docs/notes')
  })

  it('SK 吊销即时生效(mint → 200 → delete → 401)', async () => {
    const { server, baseUrl } = await startServer(tmpDataDir())
    cleanups.push(() => server.close())

    const mint = await postJson(
      baseUrl,
      'system/sk',
      {
        tool: 'write',
        arguments: { owner: 'agent:probe', scopes: [{ pattern: '**', actions: ['read'] }] },
      },
      admin(),
    )
    expect(mint.status).toBe(200)
    const minted = (await mint.json()) as { key: { id: string }; secret: string }

    const before = await fetch(`${baseUrl}/~help`, {
      headers: { authorization: `Bearer ${minted.secret}` },
    })
    expect(before.status).toBe(200)

    const del = await postJson(
      baseUrl,
      'system/sk',
      { tool: 'delete', arguments: { id: minted.key.id } },
      admin(),
    )
    expect(del.status).toBe(200)

    const after = await fetch(`${baseUrl}/~help`, {
      headers: { authorization: `Bearer ${minted.secret}` },
    })
    expect(after.status).toBe(401)
  })

  it('引导幂等:同 dataDir 重启不重复引导(sk 表不重复)', async () => {
    const dataDir = tmpDataDir()
    const first = await startServer(dataDir)
    const list1 = await postJson(
      first.baseUrl,
      'system/sk',
      { tool: 'list', arguments: {} },
      admin(),
    )
    expect(list1.status).toBe(200)
    const count1 = ((await list1.json()) as { items: unknown[] }).items.length
    await first.server.close()

    const second = await startServer(dataDir)
    cleanups.push(() => second.server.close())
    const list2 = await postJson(
      second.baseUrl,
      'system/sk',
      { tool: 'list', arguments: {} },
      admin(),
    )
    expect(list2.status).toBe(200)
    const count2 = ((await list2.json()) as { items: unknown[] }).items.length
    expect(count2).toBe(count1)
  })
})
