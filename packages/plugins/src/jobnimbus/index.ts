/**
 * JobNimbus —— 从 open-connector 迁移的 provider(api_key,8 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  createContact,
  createJob,
  getContact,
  getJob,
  listContacts,
  listJobs,
  updateContact,
  updateJob,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { jobnimbusActions } from './schema'

export type { ProviderEnv as Env }

export function createJobnimbusPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'JobNimbus',
    actions: jobnimbusActions,
    // 上游的 credentialValidators 打 /account/settings,但那不是一个 action;
    // list_contacts 是只读、无必填入参的最便宜调用,拿它当挂载时的凭证探针。
    credentialProbe: 'list_contacts',
    handlers: {
      list_contacts: listContacts,
      get_contact: getContact,
      create_contact: createContact,
      update_contact: updateContact,
      list_jobs: listJobs,
      get_job: getJob,
      create_job: createJob,
      update_job: updateJob,
    },
  })
}

export default createJobnimbusPlugin()
