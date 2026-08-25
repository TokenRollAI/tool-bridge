/**
 * builtin 模块 "status" → 网关健康与摘要(挂载为 system/status 节点)。
 *
 * status 的 cmd 集合无集中规范定义——本模块的 cmd `get`
 * 与返回字段为当前实现约定。scope=read:能读到
 * 该节点即可查健康摘要,不要求 admin(区别于其他 system/* 管理面)。
 */

import { z } from 'zod/v4'
import type { BuiltinModule } from './types'
import { BuiltinCommandRegistry } from './commandRegistry'

const DESCRIPTION = 'Gateway health and summary (readable without admin)'

/** status 摘要;version 与 nodeCount 经构造注入的 getter 求值。 */
export interface StatusSummary {
  healthy: boolean
  nodeCount: number
  version: string
}

export interface StatusDeps {
  nodeCount: () => Promise<number>
  version: () => string
}

const COMMANDS = new BuiltinCommandRegistry<StatusDeps>('status', DESCRIPTION)
  .register(
    'get',
    {
      h: 'health summary: gateway version and node count; no arguments',
      inputSchema: z.strictObject({}),
      returns: '{ healthy, version, nodeCount }',
      scope: 'read',
    },
    async (_input, { deps }) => {
      const summary: StatusSummary = {
        healthy: true,
        version: deps.version(),
        nodeCount: await deps.nodeCount(),
      }
      return summary
    },
  )

export function createStatusModule(deps: StatusDeps): BuiltinModule {
  return COMMANDS.module(deps)
}
