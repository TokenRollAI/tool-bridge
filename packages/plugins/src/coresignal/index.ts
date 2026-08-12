/**
 * Coresignal —— 从 open-connector 迁移的 provider(api_key,3 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 不设 credentialProbe:上游 credentialValidators 是 `format_only`(只查 key 非空,不打网),
 * 而 Coresignal 每次 search/collect 都扣 credits —— 拿挂载动作去烧配额不划算。
 */

import { collectBaseCompany, previewBaseCompanies, searchBaseCompanies } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { coresignalActions } from './schema'

export type { ProviderEnv as Env }

export function createCoresignalPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Coresignal',
    actions: coresignalActions,
    handlers: {
      search_base_companies: searchBaseCompanies,
      preview_base_companies: previewBaseCompanies,
      collect_base_company: collectBaseCompany,
    },
  })
}

export default createCoresignalPlugin()
