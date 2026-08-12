/**
 * SatisMeter —— 从 open-connector 迁移的 provider(api_key,6 个只读 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 不设 credentialProbe:6 个 action 都要 projectId,没有可"空转"的调用。
 * (上游 credentialValidators 是拿一个写死的假 projectId 去探、并把 404 也当成功,
 * 这种造数不适合搬成挂载探针。)
 */

import {
  getProject,
  getSurvey,
  getSurveyStatistics,
  listProjectResponses,
  listSurveyResponses,
  listSurveys,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { satismeterActions } from './schema'

export type { ProviderEnv as Env }

export function createSatismeterPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'SatisMeter',
    actions: satismeterActions,
    handlers: {
      get_project: getProject,
      list_surveys: listSurveys,
      get_survey: getSurvey,
      list_project_responses: listProjectResponses,
      list_survey_responses: listSurveyResponses,
      get_survey_statistics: getSurveyStatistics,
    },
  })
}

export default createSatismeterPlugin()
