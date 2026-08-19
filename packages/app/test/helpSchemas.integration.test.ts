import type { HelpJson } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { MemorySearchIndex } from './memorySearchIndex'
import { TEST_ADMIN_SK } from './fixtures'
import { createTestApp } from './harness'

/**
 * `~help?schemas=1`(issue #72 快路径):节点级 `~help` 默认是索引形态(不含
 * inputSchema,agent 需逐工具下钻);schemas=1 关闭索引形态,一次往返内联全量 schema。
 */

const tb = await createTestApp({ search: new MemorySearchIndex() })

const admin = (extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, ...(extra.headers ?? {}) },
})

const INPUT_SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
}

async function mountHttp(path: string): Promise<void> {
  const response = await tb.request('https://tb.test/system/registry', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      ...admin().headers,
    },
    body: JSON.stringify({
      tool: 'write',
      arguments: {
        path,
        kind: 'http',
        description: `${path} tools`,
        config: {
          kind: 'http',
          endpoint: 'https://help-schemas-upstream.test',
          tools: [
            {
              name: 'greet',
              description: 'greet someone by name',
              method: 'POST',
              pathTemplate: '/greet',
              inputSchema: INPUT_SCHEMA,
            },
          ],
        },
      },
    }),
  })
  expect(response.status).toBe(200)
}

async function helpJson(path: string, query = ''): Promise<HelpJson> {
  const response = await tb.request(`https://tb.test/${path}/~help${query}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, accept: 'application/json' },
  })
  expect(response.status).toBe(200)
  return (await response.json()) as HelpJson
}

describe('~help?schemas=1 内联全量 schema', () => {
  it('默认索引形态省略 inputSchema,schemas=1 时内联', async () => {
    await mountHttp('help-schemas-http')

    const indexed = await helpJson('help-schemas-http')
    expect(indexed.cmds[0]?.name).toBe('greet')
    // 默认(索引形态):无 inputSchema,靠 hint 指引下钻。
    expect(indexed.cmds[0]?.inputSchema).toBeUndefined()

    const full = await helpJson('help-schemas-http', '?schemas=1')
    expect(full.cmds[0]?.name).toBe('greet')
    // schemas=1:节点级即带全量 inputSchema,无需二次工具级 ~help。
    expect(full.cmds[0]?.inputSchema).toEqual(INPUT_SCHEMA)
  })

  it('Markdown 表现同源:schemas=1 渲染出 JSON Schema 块', async () => {
    await mountHttp('help-schemas-md')
    const response = await tb.request('https://tb.test/help-schemas-md/~help?schemas=1', {
      method: 'GET',
      headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, accept: 'text/markdown' },
    })
    expect(response.status).toBe(200)
    const md = await response.text()
    expect(md).toContain('Request body (JSON Schema)')
    expect(md).not.toContain('schema not shown in this index')
  })
})
