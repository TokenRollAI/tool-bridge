/**
 * E2B —— 从 open-connector 迁移的 provider(4 个沙箱管理 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * credentialProbe 选 `list_sandboxes`:上游 credentialValidators 打的正是
 * `/v2/sandboxes?limit=1`,且它 effect 为 read、无必填入参 —— 三个条件都满足。
 */

import { createSandbox, deleteSandbox, getSandbox, listSandboxes } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { e2bActions } from './schema'

export type { ProviderEnv as Env }

export function createE2bPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'E2B',
    credentialProbe: 'list_sandboxes',
    actions: e2bActions,
    handlers: {
      create_sandbox: createSandbox,
      list_sandboxes: listSandboxes,
      get_sandbox: getSandbox,
      delete_sandbox: deleteSandbox,
    },
  })
}

export default createE2bPlugin()
