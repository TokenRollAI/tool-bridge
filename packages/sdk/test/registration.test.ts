/**
 * 注册语义保真:本地落库与 connect 上报共用同一个 NodeInput 构造(nodeInputOf)。
 *
 * 回归动机:上报侧曾硬编码 config、丢掉 virtualize 与 readOnly,导致「本地跑正常、
 * 连上远程后 ~help 与权限都变了」。本文件在 wire 层断言本地侧的构造结果;上报侧由
 * 「两条路径共用同一函数」这一结构性保证覆盖(真实远端链路见 opt-in connect.remote)。
 */

import { MemoryStateStore, TBError, type ToolResult, type ToolSpec } from '@tool-bridge/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve } from '@hono/node-server'
import { createToolBridge, type ToolBridge } from '../src'

const ADMIN_SK = 'tbk_sdk_reg_admin_00000000000'

/** 只读 context:只实现 Get/List —— 旧的四动词强制契约下写不出来。 */
function readOnlyNotes() {
  return {
    List: () => Promise.resolve({ items: [] }),
    Get: (path: string) => Promise.reject(TBError.notFound(`no such entry: ${path}`)),
  }
}

const spec: ToolSpec = { name: 'ping', description: 'ping' }

function pingProvider() {
  return {
    List: (): ToolSpec[] => [spec],
    Get: (): ToolSpec => spec,
    Call: (): ToolResult => ({ content: 'pong' }),
  }
}

let baseUrl: string
let close: () => void
let tb: ToolBridge

beforeAll(async () => {
  tb = createToolBridge({ state: new MemoryStateStore(), adminSk: ADMIN_SK })
  tb.registerContext('readonly-notes', readOnlyNotes(), { description: '只读笔记' })
  tb.registerTool('tools/ping', pingProvider(), {
    description: 'ping 工具',
    virtualize: { prefix: 'v_' },
  })
  const server = serve({ fetch: (req: Request) => tb.fetch(req), port: 0 })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no server port')
  baseUrl = `http://127.0.0.1:${address.port}`
  close = () => server.close()
  // 触发惰性引导与注册 flush
  await fetch(`${baseUrl}/~help`, { headers: { authorization: `Bearer ${ADMIN_SK}` } })
})

afterAll(() => close?.())

async function registryGet(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}/system/registry`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${ADMIN_SK}`,
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({ tool: 'get', arguments: { path } }),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as Record<string, unknown>
}

describe('registerContext 的能力推导落进节点配置', () => {
  it('无写 handler 的 provider → config.readOnly 自动为 true', async () => {
    const node = await registryGet('readonly-notes')
    const config = node.config as { provider?: string, readOnly?: boolean }
    expect(config.provider).toBe('@local')
    expect(config.readOnly).toBe(true)
  })

  it('~help 只列真实存在的动词(只读 provider 无写动词)', async () => {
    const res = await fetch(`${baseUrl}/readonly-notes/~help`, {
      headers: { authorization: `Bearer ${ADMIN_SK}`, accept: 'application/json' },
    })
    expect(res.status).toBe(200)
    const help = (await res.json()) as { cmds: Array<{ name: string }> }
    const names = help.cmds.map(c => c.name).sort()
    expect(names).toEqual(['Get', 'List'])
    expect(names).not.toContain('Write')
    expect(names).not.toContain('Update')
  })

  it('~describe 的 capabilities 按 handler 推导(无 Search/Delete → 空)', async () => {
    const res = await fetch(`${baseUrl}/readonly-notes/~describe`, {
      headers: { authorization: `Bearer ${ADMIN_SK}`, accept: 'application/json' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { capabilities: string[], kind: string }
    expect(body.kind).toBe('context')
    expect(body.capabilities).toEqual([])
  })
})

describe('registerTool 的 meta 保真', () => {
  it('virtualize 落进节点(不被注册路径丢弃)', async () => {
    const node = await registryGet('tools/ping')
    expect(node.virtualize).toEqual({ prefix: 'v_' })
  })

  it('虚拟化生效:对外只暴露前缀名', async () => {
    const res = await fetch(`${baseUrl}/tools/ping/~help`, {
      headers: { authorization: `Bearer ${ADMIN_SK}`, accept: 'application/json' },
    })
    expect(res.status).toBe(200)
    const help = (await res.json()) as { cmds: Array<{ name: string }> }
    expect(help.cmds.map(c => c.name)).toEqual(['v_ping'])
  })
})
