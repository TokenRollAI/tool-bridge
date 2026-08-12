/**
 * Gmail —— 从 open-connector 迁移的 provider(46 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api/` 是人工改写的业务逻辑(按上游文件
 * 分组:message 编解码、消息/会话、草稿与发信、标签、邮箱级设置),本文件把两张表对起来
 * (键集合不吻合会在装配期炸)。
 *
 * **凭证走平台托管的 OAuth2**,不是 API key:下面 `oauth` 里的端点与 scope 全量抄自上游
 * `definition.ts` + `scopes.ts`。两个 `authorizationParams` 是必需的,不是可选优化:
 * - `access_type=offline` —— Google **只在**带这个参数时下发 refresh_token;少了它,access token
 *   一小时后过期就再也刷不回来,只能手工重新授权。
 * - `prompt=consent` —— 用户重新授权(换 scope、换账号)时强制再走一次同意屏,Google 才会
 *   **重新下发** refresh_token;省掉它的话第二次授权只回 access token,同样刷不了。
 *
 * client_id / client_secret 不在这里:它们是每个部署自己去 Google Cloud Console 注册的,
 * 走 authRef 指向的 secret(`clientId` + `clientSecret` 两字段)。
 *
 * 声明了 `oauth` 就**不能**再声明 `credentialProbe` 或 `credentialFields`(SDK 当场拒)——
 * 故上游 `credentialValidators.oauth2` 打的那个 `users/me/profile` 在这里没有落点,
 * 凭证是否可用由 OAuth 授权流本身证明。
 */

import {
  createFilter,
  deleteFilter,
  getAutoForwarding,
  getFilter,
  getLanguageSettings,
  getProfile,
  getVacationSettings,
  listFilters,
  listForwardingAddresses,
  listHistory,
  settingsGetImap,
  settingsGetPop,
  stopWatch,
  updateImapSettings,
  updateLanguageSettings,
  updatePopSettings,
  updateVacationSettings,
} from './api/mailbox'
import {
  addLabelToEmail,
  batchModifyMessages,
  fetchEmails,
  fetchMessageByMessageId,
  fetchMessageByThreadId,
  getMessage,
  listThreadsAction,
  modifyThreadLabels,
  moveThreadToTrash,
  moveToTrash,
  searchThreads,
  untrashMessage,
  untrashThread,
} from './api/messages'
import {
  createDraft,
  createEmailDraft,
  deleteDraft,
  getDraft,
  listDrafts,
  replyEmail,
  replyToThread,
  sendDraft,
  sendEmail,
  updateDraft,
} from './api/drafts'
import {
  createLabel,
  deleteLabel,
  getLabel,
  listLabels,
  patchLabel,
  updateLabel,
} from './api/labels'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { gmailActions } from './schema'

export type { ProviderEnv as Env }

export function createGmailPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Gmail',
    actions: gmailActions,
    oauth: {
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.labels',
        'https://www.googleapis.com/auth/gmail.settings.basic',
      ],
      clientAuth: 'client_secret_post',
      authorizationParams: { access_type: 'offline', prompt: 'consent' },
    },
    handlers: {
      search_threads: searchThreads,
      list_threads: listThreadsAction,
      fetch_emails: fetchEmails,
      get_message: getMessage,
      fetch_message_by_message_id: fetchMessageByMessageId,
      fetch_message_by_thread_id: fetchMessageByThreadId,
      get_profile: getProfile,
      send_email: sendEmail,
      reply_email: replyEmail,
      reply_to_thread: replyToThread,
      create_draft: createDraft,
      create_email_draft: createEmailDraft,
      list_drafts: listDrafts,
      get_draft: getDraft,
      update_draft: updateDraft,
      send_draft: sendDraft,
      delete_draft: deleteDraft,
      list_labels: listLabels,
      get_label: getLabel,
      create_label: createLabel,
      patch_label: patchLabel,
      update_label: updateLabel,
      delete_label: deleteLabel,
      add_label_to_email: addLabelToEmail,
      batch_modify_messages: batchModifyMessages,
      move_to_trash: moveToTrash,
      untrash_message: untrashMessage,
      modify_thread_labels: modifyThreadLabels,
      move_thread_to_trash: moveThreadToTrash,
      untrash_thread: untrashThread,
      list_history: listHistory,
      list_filters: listFilters,
      get_filter: getFilter,
      create_filter: createFilter,
      delete_filter: deleteFilter,
      get_language_settings: getLanguageSettings,
      update_language_settings: updateLanguageSettings,
      get_vacation_settings: getVacationSettings,
      update_vacation_settings: updateVacationSettings,
      get_auto_forwarding: getAutoForwarding,
      list_forwarding_addresses: listForwardingAddresses,
      settings_get_imap: settingsGetImap,
      update_imap_settings: updateImapSettings,
      settings_get_pop: settingsGetPop,
      update_pop_settings: updatePopSettings,
      stop_watch: stopWatch,
    },
  })
}

export default createGmailPlugin()
