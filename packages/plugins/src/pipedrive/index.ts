/**
 * Pipedrive —— 从 open-connector 迁移的 provider(27 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * handler 表由 `api.ts` 的操作表展开,不在这里逐个列 27 行 —— 装配期的键集合闸门照样
 * 会拿它与 `pipedriveActions` 比对,漏一个多一个都当场炸。
 *
 * `credentialProbe: 'list_pipelines'` —— effect 为 read、入参无必填字段(looseObject),
 * 且 pipeline 数量通常是个位数,是这 27 个里最便宜的一次只读往返。上游的
 * `credentialValidators` 打的是 `GET /v1/users/me`,那个端点没有对应的 action。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { pipedriveActions } from './schema'
import { pipedriveHandlers } from './api'

export type { ProviderEnv as Env }

export function createPipedrivePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Pipedrive',
    actions: pipedriveActions,
    credentialProbe: 'list_pipelines',
    handlers: pipedriveHandlers,
  })
}

export default createPipedrivePlugin()
