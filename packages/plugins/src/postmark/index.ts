/**
 * Postmark —— 从 open-connector 迁移的 provider(12 个发信/模板/统计 action)。
 *
 * `credentialProbe: 'get_server'` 满足三个条件:已注册、effect 是 read、入参是空对象;
 * 它打的 `/server` 正是上游 credentialValidator 用的那个端点,配错的 server token
 * 在挂载时就会被拒,而不是等到第一封信发不出去。
 */

import {
  createTemplate,
  editTemplate,
  getBounces,
  getOutboundMessageDetails,
  getServer,
  getTemplate,
  listTemplates,
  searchOutboundMessages,
  sendBatchWithTemplates,
  sendEmail,
  sendEmailWithTemplate,
  validateTemplate,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { postmarkActions } from './schema'

export type { ProviderEnv as Env }

export function createPostmarkPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Postmark',
    credentialProbe: 'get_server',
    actions: postmarkActions,
    handlers: {
      get_server: getServer,
      send_email: sendEmail,
      send_email_with_template: sendEmailWithTemplate,
      send_batch_with_templates: sendBatchWithTemplates,
      search_outbound_messages: searchOutboundMessages,
      get_outbound_message_details: getOutboundMessageDetails,
      get_bounces: getBounces,
      list_templates: listTemplates,
      get_template: getTemplate,
      create_template: createTemplate,
      edit_template: editTemplate,
      validate_template: validateTemplate,
    },
  })
}

export default createPostmarkPlugin()
