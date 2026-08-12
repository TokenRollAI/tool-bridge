/**
 * Getform —— 从 open-connector 迁移的 provider(api_key,2 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 不配 credentialProbe:上游的 credentialValidators 只做**格式校验**(判 apiKey 非空),
 * 压根不打网络;两个 action 又都要必填 formId,拿不到一个"空转"的只读调用。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { listSubmissions, submitForm } from './api'
import { getformActions } from './schema'

export type { ProviderEnv as Env }

export function createGetformPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Getform',
    actions: getformActions,
    handlers: {
      submit_form: submitForm,
      list_submissions: listSubmissions,
    },
  })
}

export default createGetformPlugin()
