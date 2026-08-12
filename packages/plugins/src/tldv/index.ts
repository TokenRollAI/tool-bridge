/**
 * tl;dv —— 从 open-connector 迁移的 provider(api_key,5 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { getMeeting, getNotes, getTranscript, importMeeting, listMeetings } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { tldvActions } from './schema'

export type { ProviderEnv as Env }

export function createTldvPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'tl;dv',
    actions: tldvActions,
    // 上游 credentialValidators 就是打 /meetings?limit=1;list_meetings 是唯一只读且无必填入参的 action。
    credentialProbe: 'list_meetings',
    handlers: {
      list_meetings: listMeetings,
      get_meeting: getMeeting,
      get_transcript: getTranscript,
      get_notes: getNotes,
      import_meeting: importMeeting,
    },
  })
}

export default createTldvPlugin()
