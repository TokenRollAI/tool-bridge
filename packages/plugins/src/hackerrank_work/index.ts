/**
 * HackerRank Work —— 从 open-connector 迁移的 provider(5 个 action,全是只读查询)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getTest,
  getTestCandidate,
  listTestCandidates,
  listTests,
  searchTestCandidates,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { hackerrankWorkActions } from './schema'

export type { ProviderEnv as Env }

export function createHackerrankWorkPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'HackerRank Work',
    actions: hackerrankWorkActions,
    // 上游的 credentialValidator 打的就是 /tests(limit=1),只读且无必填入参。
    credentialProbe: 'list_tests',
    handlers: {
      list_tests: listTests,
      get_test: getTest,
      list_test_candidates: listTestCandidates,
      search_test_candidates: searchTestCandidates,
      get_test_candidate: getTestCandidate,
    },
  })
}

export default createHackerrankWorkPlugin()
