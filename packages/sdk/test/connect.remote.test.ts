/**
 * SDK connect 全链路(DoD ② 后半,DOD.md:105;opt-in,消耗真实资源):
 * `TB_TEST_SDK_REMOTE=1 TB_BASE_URL=... TB_SK=...` 时对已部署网关跑——
 * SDK 实例 registerTool 本地函数工具 → connect(随机 deviceId)→ 远程树出现该
 * 工具节点 → 经远程 HTTP 调用返回本地函数结果 → close + teardown(节点回收确认)。
 *
 * teardown 注意 §2.4d:节点只能由注册它的 SK 删除;此处 connect 与 delete 用同一把 SK。
 */

import { MemoryStateStore, type ToolResult, type ToolSpec } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { createToolBridge } from '../src'

const optIn = process.env.TB_TEST_SDK_REMOTE === '1'
const BASE_URL = process.env.TB_BASE_URL ?? ''
const SK = process.env.TB_SK ?? ''

const describeRemote = optIn && BASE_URL !== '' && SK !== '' ? describe : describe.skip

async function remote(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL.replace(/\/+$/, '')}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${SK}`,
      accept: 'application/json',
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
}

async function deleteNode(path: string): Promise<Response> {
  return remote('system/registry', {
    method: 'POST',
    body: JSON.stringify({ tool: 'delete', arguments: { path } }),
  })
}

describeRemote('SDK connect 全链路(生产网关,opt-in)', () => {
  it('registerTool → connect → 远程树可见 → 远程调用 → close + 节点回收', {
    timeout: 120_000,
  }, async () => {
    const deviceId = `sdk-e2e-${Math.random().toString(36).slice(2, 10)}`
    const mountPath = `device/${deviceId}`
    const marker = `sdk-${Date.now()}`

    const tb = createToolBridge({ state: new MemoryStateStore() })
    tb.registerTool(
      'tools/echo',
      {
        List: (): ToolSpec[] => [
          { name: 'echo', description: 'echo back', inputSchema: { type: 'object' } },
        ],
        Get: (): ToolSpec => ({ name: 'echo' }),
        Call: (_name, args): ToolResult => ({ content: { echoed: args.text, marker } }),
      },
      { description: 'SDK e2e echo' },
    )

    const conn = tb.connect(BASE_URL, SK, { deviceId })
    try {
      const mounted = await conn.ready
      expect(mounted).toBe(mountPath)
      expect(conn.state).toBe('ready')

      // 远程树出现该工具节点(ready 已确认代注册完成;KV 读到即毕)。
      const nodePath = `${mountPath}/tools/echo`
      const help = await remote(`${nodePath}/~help`)
      expect(help.status).toBe(200)
      const model = (await help.json()) as { cmds: Array<{ name: string }> }
      expect(model.cmds.map((c) => c.name)).toContain('echo')

      // 经远程 HTTP 调用 → HTTP→WS 帧转发 → 本地函数结果回传。
      const call = await remote(nodePath, {
        method: 'POST',
        body: JSON.stringify({ tool: 'echo', arguments: { text: 'hello from remote' } }),
      })
      expect(call.status).toBe(200)
      expect(await call.json()).toEqual({ echoed: 'hello from remote', marker })
    } finally {
      conn.close()
      await conn.closed
      // teardown:子节点在前(§2.4d 同 SK 删除;失败仅告警,残骸有 24h 自动回收兜底)。
      for (const p of [`${mountPath}/tools/echo`, `${mountPath}/tools`, mountPath]) {
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
  })
})
