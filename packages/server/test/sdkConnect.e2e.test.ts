import {
  MemoryObjectStore,
  MemoryStateStore,
  type ToolResult,
  type ToolSpec,
} from '@tool-bridge/core'
/** Full SDK registration/invoke/teardown contract against the real local Node listener. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testPersistence } from '../../sdk/test/domainFixtures'
import { createTbServer, type TbServer } from '../src/server'
import { testServerConfig } from './helpers/server'
import { createToolBridge } from '../../sdk/src'

let BASE_URL = ''
const SK = 'tbk_local_sdk_e2e_administrator_000000'
let gateway: TbServer

async function remote(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL.replace(/\/+$/, '')}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${SK}`,
      accept: 'application/json',
      ...(init.body !== undefined
        ? { 'content-type': 'application/json' }
        : {}),
      ...(init.headers ?? {}),
    },
  })
}

async function deleteNode(path: string): Promise<Response> {
  return remote('system/registry/delete', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
}

describe('SDK connect 全链路（本地 PostgreSQL / Node / WebSocket）', () => {
  beforeAll(async () => {
    gateway = createTbServer(await testServerConfig({ adminSk: SK }))
    const started = await gateway.start()
    BASE_URL = `http://127.0.0.1:${started.port}`
  })
  afterAll(async () => {
    await gateway?.close()
  })
  it(
    'registerTool → connect → 远程树可见 → 远程调用 → close + 节点回收',
    {
      timeout: 120_000,
    },
    async () => {
      const deviceId = `sdk-e2e-${Math.random().toString(36).slice(2, 10)}`
      const mountPath = `device/${deviceId}`
      const marker = `sdk-${Date.now()}`

      const tb = createToolBridge({
        state: new MemoryStateStore(),
        adminSk: 'tbk_embedded_sdk_e2e_administrator_000000',
        ...testPersistence(new MemoryObjectStore()),
      })
      tb.registerTool(
        'tools/echo',
        {
          list: (): ToolSpec[] => [
            {
              name: 'echo',
              description: 'echo back',
              inputSchema: { type: 'object' },
            },
          ],
          call: (_name: string, args: Record<string, unknown>): ToolResult => ({
            content: { echoed: args.text, marker },
          }),
        },
        { description: 'SDK e2e echo' },
      )

      const conn = tb.connect(BASE_URL, SK, { deviceId })
      try {
        const mounted = await conn.ready
        expect(mounted).toBe(mountPath)
        expect(conn.state).toBe('ready')

        // 远程树出现该工具节点(ready 已确认代注册完成;PostgreSQL 已持久化)。
        const nodePath = `${mountPath}/tools/echo`
        const help = await remote(`${nodePath}/~help`)
        expect(help.status).toBe(200)
        const model = (await help.json()) as { cmds: Array<{ name: string }> }
        expect(model.cmds.map(c => c.name)).toContain('echo')

        // 经远程 HTTP 调用 → HTTP→WS 帧转发 → 本地函数结果回传。
        const call = await remote(`${nodePath}/echo`, {
          method: 'POST',
          body: JSON.stringify({ text: 'hello from remote' }),
        })
        expect(call.status).toBe(200)
        expect(await call.json()).toEqual({
          echoed: 'hello from remote',
          marker,
        })
      } finally {
        conn.close()
        await conn.closed
        // teardown:子节点在前(同 SK 删除;失败仅告警,残骸有 24h 自动回收兜底)。
        for (const p of [
          `${mountPath}/tools/echo`,
          `${mountPath}/tools`,
          mountPath,
        ]) {
          const res = await deleteNode(p)
          if (res.status !== 200) {
            console.warn(`teardown: delete ${p} → HTTP ${res.status}`)
          }
        }
      }
      expect(conn.state).toBe('closed')

      // 节点回收确认:挂载点 ~help 404。
      const gone = await remote(`${mountPath}/~help`)
      expect(gone.status).toBe(404)
    },
  )
})
