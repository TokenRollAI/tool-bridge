/**
 * Crustdata —— 从 open-connector 迁移的 provider(api_key,4 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 不设 credentialProbe:两个 read action 里,identify_companies 必须给一个标识符数组
 * (上游 validator 是硬编码 `domains:['openai.com']` 去试的),search_companies 会真的
 * 消耗查询额度。拿不到一个"空转"的只读调用,宁可不探。
 */

import { autocompleteCompanies, enrichCompanies, identifyCompanies, searchCompanies } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { crustdataActions } from './schema'

export type { ProviderEnv as Env }

export function createCrustdataPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Crustdata',
    actions: crustdataActions,
    handlers: {
      identify_companies: identifyCompanies,
      enrich_companies: enrichCompanies,
      search_companies: searchCompanies,
      autocomplete_companies: autocompleteCompanies,
    },
  })
}

export default createCrustdataPlugin()
