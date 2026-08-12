/**
 * Recruit CRM —— 从 open-connector 迁移的 provider(api_key,8 个只读 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  getCandidate,
  getCompany,
  getContact,
  getJob,
  listCandidates,
  listCompanies,
  listContacts,
  listJobs,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { recruitcrmActions } from './schema'

export type { ProviderEnv as Env }

export function createRecruitcrmPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Recruit CRM',
    actions: recruitcrmActions,
    // 上游的 credentialValidators 打的是 /candidates?limit=1;list_candidates 是它的同一个调用。
    credentialProbe: 'list_candidates',
    handlers: {
      list_candidates: listCandidates,
      get_candidate: getCandidate,
      list_contacts: listContacts,
      get_contact: getContact,
      list_companies: listCompanies,
      get_company: getCompany,
      list_jobs: listJobs,
      get_job: getJob,
    },
  })
}

export default createRecruitcrmPlugin()
