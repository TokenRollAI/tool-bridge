/**
 * PG 后端的端到端装配验收:用 TB_DATABASE_URL 起真实 createTbServer,经 HTTP 注册
 * 节点并走 `~search`,证明 PgStateStore + PgSearchIndex 在真实装配下贯通
 * (registry 写入 → SearchSynchronizer 增量索引 → 权限 hydrate → ToolSpec 返回)。
 *
 * 需要真实 PG(设 TB_TEST_DATABASE_URL);缺省整组 skip。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import postgres, { type Sql } from 'postgres'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTbServer, type TbServer } from '../src/server'

const DATABASE_URL = process.env.TB_TEST_DATABASE_URL
const suite = DATABASE_URL === undefined ? describe.skip : describe
const SCHEMA = 'tb_e2e_server'
const ADMIN_SK = 'tb_sk_e2e_pg_admin_key_000000000000'

let server: TbServer
let base: string
let dataDir: string
let admin: Sql

const headers = {
  'accept': 'application/json',
  'authorization': `Bearer ${ADMIN_SK}`,
  'content-type': 'application/json',
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return
  // 独立 schema,避免污染 public;search_path 保留 public 兜底内置函数解析。
  admin = postgres(DATABASE_URL, { max: 2, onnotice: () => {} })
  await admin.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  await admin.unsafe(`CREATE SCHEMA ${SCHEMA}`)
  dataDir = mkdtempSync(join(tmpdir(), 'tb-e2e-pg-'))
  const url = new URL(DATABASE_URL)
  url.searchParams.set('options', `-c search_path=${SCHEMA},public`)
  server = createTbServer({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    databaseUrl: url.toString(),
    adminSk: ADMIN_SK,
    allowInsecureBootstrap: false,
    allowInsecureHttp: true,
    remote: { allowlist: [], maxHops: 4, allowInsecure: true },
    deviceReclaimSec: 86_400,
  })
  const { port } = await server.start()
  base = `http://127.0.0.1:${port}`
}, 60_000)

afterAll(async () => {
  if (server !== undefined) await server.close()
  if (dataDir !== undefined) rmSync(dataDir, { recursive: true, force: true })
  if (admin !== undefined) {
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
    await admin.end({ timeout: 5 })
  }
})

async function search(query: string): Promise<Array<{ name: string, path: string }>> {
  const response = await fetch(`${base}/~search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  })
  expect(response.status).toBe(200)
  const body = await response.json() as { items: Array<{ path: string, tool: { name: string } }> }
  return body.items.map(item => ({ name: item.tool.name, path: item.path }))
}

suite('PG 后端端到端(createTbServer + HTTP ~search)', () => {
  it('声明 search capability', async () => {
    const response = await fetch(`${base}/~describe`, { headers })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      kind: 'directory',
      capabilities: ['search'],
    })
  })

  it('注册节点后可经 ~search 命中(长词/CJK 短词/名称)', async () => {
    const register = await fetch(`${base}/system/registry`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tool: 'write',
        arguments: {
          path: 'e2e/pg',
          kind: 'http',
          description: 'PG e2e fixture',
          config: {
            kind: 'http',
            endpoint: 'https://pg.example.test',
            tools: [{
              name: 'lookup_calendar',
              description: 'Search calendar 日程 appointments',
              method: 'GET',
              pathTemplate: '/cal',
            }],
          },
        },
      }),
    })
    expect(register.status).toBe(200)

    for (const query of ['calendar', '日程', 'lookup']) {
      expect(await search(query)).toEqual([{ name: 'lookup_calendar', path: 'e2e/pg' }])
    }
  })

  it('删除节点后索引同步清空', async () => {
    const remove = await fetch(`${base}/system/registry`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool: 'delete', arguments: { path: 'e2e/pg' } }),
    })
    expect(remove.status).toBe(200)
    expect(await search('calendar')).toEqual([])
  })
})
