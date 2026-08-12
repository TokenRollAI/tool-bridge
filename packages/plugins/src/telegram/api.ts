/**
 * Telegram Bot API 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/telegram/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * 四处上游细节决定了这里的形状:
 * - **bot token 拼在 URL 的路径段里**(`https://api.telegram.org/bot<TOKEN>/<method>`)——
 *   Bot API 没有 header 形态,换成 header 会 404/401,迁移没有选择余地。后果是凭证会出现在
 *   出站 URL 上,可能落进网关访问日志、上游日志与任何中间代理:**挂载前要确认部署侧对 URL
 *   的脱敏策略**。`assertBotToken()` 因此必须保留 —— token 里混进 `/`、`?`、`#` 或空白就能
 *   改写路径,把一次 sendMessage 变成打任意别的端点。
 * - **失败常以 HTTP 200 + `{ok:false, description, error_code}` 返回**(信封式错误)。只看
 *   HTTP 状态会把失败当成功返回,故先看 `ok`,再按 `error_code` 归一,拿不到码才退回 HTTP 状态。
 * - 响应不是 JSON(网关的 HTML 错误页)时,上游把整体当成一条 `ok:false` 信封处理,而不是
 *   报"响应不是 JSON" —— 那时按状态归一比报解析失败准。
 * - `reply_markup` / `scope` 这类字段既收对象也收 JSON 字符串,要在本地解码成对象再发。
 *
 * 与上游的有意偏离:上游 `buildTelegramError` 把 404/409 一律压成 400、并在"校验凭证"阶段把
 * 401 压成 400。这里交回公共的 `upstreamError` 统一归一(404 → not_found、409 → conflict、
 * 401 → permission_denied),口径与其余迁移产物一致;凭证探针走的是正常调用路径,没有单独的
 * 校验阶段可言。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  answerCallbackQueryInput,
  approveChatJoinRequestInput,
  banChatMemberInput,
  copyMessageInput,
  copyMessagesInput,
  createChatInviteLinkInput,
  declineChatJoinRequestInput,
  deleteBusinessMessagesInput,
  deleteMessageInput,
  deleteMessagesInput,
  deleteWebhookInput,
  editChatInviteLinkInput,
  editMessageTextInput,
  exportChatInviteLinkInput,
  forwardMessageInput,
  forwardMessagesInput,
  getBusinessConnectionInput,
  getChatAdministratorsInput,
  getChatInput,
  getChatMemberInput,
  getChatMembersCountInput,
  getUpdatesInput,
  pinChatMessageInput,
  promoteChatMemberInput,
  readBusinessMessageInput,
  restrictChatMemberInput,
  revokeChatInviteLinkInput,
  sendAnimationInput,
  sendAudioInput,
  sendChatActionInput,
  sendContactInput,
  sendDiceInput,
  sendDocumentInput,
  sendLocationInput,
  sendMediaGroupInput,
  sendMessageInput,
  sendPhotoInput,
  sendPollInput,
  sendVenueInput,
  sendVideoInput,
  sendVoiceInput,
  setChatPermissionsInput,
  setMessageReactionInput,
  setMyCommandsInput,
  setWebhookInput,
  unbanChatMemberInput,
  unpinAllChatMessagesInput,
  unpinChatMessageInput,
} from './schema'
import { assertPublicHttpUrl, guardedFetch } from '../_runtime/guardedFetch'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'telegram'
const API_BASE = 'https://api.telegram.org'
/** 上游 `telegramDefaultRequestTimeoutMs`:getUpdates 的长轮询最长 50 秒,但单次请求卡死不能无限等。 */
const REQUEST_TIMEOUT_MS = 30_000

type Json = Record<string, unknown>
/** 发给 Bot API 的请求体;值为 `undefined` 的键在发出前会被丢掉。 */
type Body = Record<string, unknown>

/** 上游 `optionalString`:去空白后仍非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 上游 `optionalNumber`:只认有限数,字符串数字不做隐式转换。 */
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 上游 `optionalBoolean`:只认真布尔值。 */
function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

/** 契约说好是对象;不是就是上游破了契约,不是调用方的错。 */
function asRecord(value: unknown): Json {
  const result = record(value)
  if (result === undefined) {
    throw new TBError('unavailable', 'Telegram 返回了非预期的对象负载', { retryable: true })
  }
  return result
}

/** 上游 `compactTelegramBody`:丢掉值为 undefined 的键(`null` 要留住,它对 Bot API 有意义)。 */
function compact(value: Body): Body {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined))
}

/**
 * token 会成为 URL 的一个路径段,所以它不能带路径分隔符或查询/片段起始符 ——
 * 否则一个畸形 token 就能把请求打到别的端点上去。空 token 由 `requireApiKey` 先拦下。
 */
function assertBotToken(botToken: string): void {
  if (botToken.length === 0 || /[/?#\s]/u.test(botToken)) {
    throw new TBError('invalid_argument', 'telegram bot token is malformed')
  }
}

function methodUrl(botToken: string, method: string): string {
  assertBotToken(botToken)
  return `${API_BASE}/bot${botToken}/${method}`
}

/**
 * 读响应体。非 JSON(网关的 HTML 错误页)按上游口径整体折成一条 `ok:false` 信封,
 * 让下面的归一逻辑只有一条路径。
 */
async function readEnvelope(response: Response): Promise<Json> {
  if ((response.headers.get('content-type') ?? '').includes('application/json')) {
    return await response.json().then(value => record(value) ?? {}).catch(() => ({}))
  }
  const body = await response.text().catch(() => '')
  return {
    ok: false,
    description: body === '' ? `telegram request failed with ${response.status}` : body,
    error_code: response.status,
  }
}

/**
 * 信封 → TBError。`error_code` 比 HTTP 状态准(信封式错误的 HTTP 状态可能是 200);
 * 两者都拿不到时说明响应不符合契约,归 unavailable 让调用方重试。
 */
function telegramError(response: Response, payload: Json, method: string): TBError {
  const code = num(payload.error_code) ?? (response.ok ? undefined : response.status)
  const status = code ?? 502
  const description = text(payload.description) ?? `telegram ${method} request failed with ${status}`
  if (status === 429) {
    // Telegram 把建议等待时间放在 parameters.retry_after,丢了它调用方只能盲目重试。
    const retryAfter = num(record(payload.parameters)?.retry_after)
    return upstreamError(429, retryAfter === undefined ? description : `${description} Retry after ${retryAfter} seconds.`)
  }
  return upstreamError(status, description)
}

async function request(ctx: ProviderContext, method: string, body?: Body): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const url = methodUrl(requireApiKey(ctx, SERVICE), method)
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await guardedFetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      signal: timeoutSignal,
    })
  } catch (error) {
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 500,
    // 把"上游不通/出网被拦"说成插件自身故障。
    if (error instanceof TBError) throw error
    if (timeoutSignal.aborted) {
      throw upstreamError(504, `telegram ${method} 请求超时(${REQUEST_TIMEOUT_MS / 1000} 秒)`)
    }
    throw upstreamError(502, `telegram ${method} 请求失败: ${error instanceof Error ? error.message : '未知错误'}`)
  }

  const payload = await readEnvelope(response)
  // 信封式错误:HTTP 200 也可能是失败,`ok` 才是判据。
  if (!response.ok || payload.ok !== true) throw telegramError(response, payload, method)
  if (payload.result === undefined) {
    throw new TBError('unavailable', `telegram ${method} response did not include result`, { retryable: true })
  }
  return payload.result
}

/** 只关心"成功与否"的 action 共用这条:上游返回 `true`,我们对外报 `{success:true}`。 */
async function booleanAction(ctx: ProviderContext, method: string, body: Body): Promise<Json> {
  await request(ctx, method, body)
  return { success: true }
}

/** 上游 `normalizeJsonLikeInput`:reply_markup / scope 既收对象也收 JSON 字符串。 */
function jsonLike(value: unknown): Json | undefined {
  if (typeof value === 'string') {
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new TBError('invalid_argument', 'invalid JSON string input')
    }
    const result = record(parsed)
    if (result === undefined) throw new TBError('invalid_argument', 'JSON string input must decode to an object')
    return result
  }
  return record(value)
}

/** 用户填的 URL 会被 Telegram 主动回访(webhook / 媒体拉取),先过一遍出站可达性判定。 */
function publicUrl(value: unknown): string | undefined {
  const candidate = text(value)
  if (candidate === undefined) return undefined
  return assertPublicHttpUrl(candidate).toString()
}

/**
 * 媒体字段既可以是 file_id 也可以是公网 URL:看起来像 URL 的才过出站校验,
 * 否则原样透传(file_id 不是 URL,拿去解析只会误伤)。
 */
function urlOrFileId(value: unknown): unknown {
  const candidate = text(value)
  if (candidate === undefined || !/^https?:\/\//iu.test(candidate)) return value
  return publicUrl(candidate)
}

function normalizeUser(value: Json): Json {
  return {
    id: Number(value.id),
    isBot: Boolean(value.is_bot),
    firstName: String(value.first_name ?? ''),
    username: text(value.username),
    languageCode: text(value.language_code),
    canJoinGroups: bool(value.can_join_groups),
    canReadAllGroupMessages: bool(value.can_read_all_group_messages),
    supportsInlineQueries: bool(value.supports_inline_queries),
    canConnectToBusiness: bool(value.can_connect_to_business),
    hasMainWebApp: bool(value.has_main_web_app),
  }
}

function normalizeChat(value: Json): Json {
  return {
    id: Number(value.id),
    type: String(value.type ?? ''),
    title: text(value.title),
    username: text(value.username),
    firstName: text(value.first_name),
    lastName: text(value.last_name),
    isForum: bool(value.is_forum),
  }
}

function normalizePhotoSize(value: Json): Json {
  return {
    fileId: String(value.file_id ?? ''),
    fileUniqueId: String(value.file_unique_id ?? ''),
    width: Number(value.width),
    height: Number(value.height),
    fileSize: num(value.file_size),
  }
}

function normalizeDocument(value: Json): Json {
  return {
    fileId: String(value.file_id ?? ''),
    fileUniqueId: String(value.file_unique_id ?? ''),
    fileName: text(value.file_name),
    mimeType: text(value.mime_type),
    fileSize: num(value.file_size),
  }
}

function normalizeVideoQuality(value: Json): Json {
  return {
    fileId: String(value.file_id ?? ''),
    fileUniqueId: String(value.file_unique_id ?? ''),
    width: Number(value.width),
    height: Number(value.height),
    codec: String(value.codec ?? ''),
    fileSize: num(value.file_size),
  }
}

function normalizeVideo(value: Json): Json {
  return {
    fileId: String(value.file_id ?? ''),
    fileUniqueId: String(value.file_unique_id ?? ''),
    width: Number(value.width),
    height: Number(value.height),
    duration: Number(value.duration),
    thumbnail: value.thumbnail ? normalizePhotoSize(asRecord(value.thumbnail)) : undefined,
    cover: Array.isArray(value.cover) ? value.cover.map(item => normalizePhotoSize(asRecord(item))) : undefined,
    startTimestamp: num(value.start_timestamp),
    qualities: Array.isArray(value.qualities)
      ? value.qualities.map(item => normalizeVideoQuality(asRecord(item)))
      : undefined,
    fileName: text(value.file_name),
    mimeType: text(value.mime_type),
    fileSize: num(value.file_size),
  }
}

function normalizeAudio(value: Json): Json {
  return {
    fileId: String(value.file_id ?? ''),
    fileUniqueId: String(value.file_unique_id ?? ''),
    duration: Number(value.duration),
    performer: text(value.performer),
    title: text(value.title),
    fileName: text(value.file_name),
    mimeType: text(value.mime_type),
    fileSize: num(value.file_size),
    thumbnail: value.thumbnail ? normalizePhotoSize(asRecord(value.thumbnail)) : undefined,
  }
}

function normalizeVoice(value: Json): Json {
  return {
    fileId: String(value.file_id ?? ''),
    fileUniqueId: String(value.file_unique_id ?? ''),
    duration: Number(value.duration),
    mimeType: text(value.mime_type),
    fileSize: num(value.file_size),
  }
}

function normalizeAnimation(value: Json): Json {
  return {
    fileId: String(value.file_id ?? ''),
    fileUniqueId: String(value.file_unique_id ?? ''),
    width: Number(value.width),
    height: Number(value.height),
    duration: Number(value.duration),
    thumbnail: value.thumbnail ? normalizePhotoSize(asRecord(value.thumbnail)) : undefined,
    fileName: text(value.file_name),
    mimeType: text(value.mime_type),
    fileSize: num(value.file_size),
  }
}

function normalizeContact(value: Json): Json {
  return {
    phoneNumber: String(value.phone_number ?? ''),
    firstName: String(value.first_name ?? ''),
    lastName: text(value.last_name),
    userId: num(value.user_id),
    vcard: text(value.vcard),
  }
}

function normalizeLocation(value: Json): Json {
  return {
    latitude: Number(value.latitude),
    longitude: Number(value.longitude),
    horizontalAccuracy: num(value.horizontal_accuracy),
    livePeriod: num(value.live_period),
    heading: num(value.heading),
    proximityAlertRadius: num(value.proximity_alert_radius),
  }
}

function normalizeVenue(value: Json): Json {
  return {
    location: normalizeLocation(asRecord(value.location)),
    title: String(value.title ?? ''),
    address: String(value.address ?? ''),
    foursquareId: text(value.foursquare_id),
    foursquareType: text(value.foursquare_type),
    googlePlaceId: text(value.google_place_id),
    googlePlaceType: text(value.google_place_type),
  }
}

function normalizeDice(value: Json): Json {
  return {
    emoji: String(value.emoji ?? ''),
    value: Number(value.value),
  }
}

function normalizePoll(value: Json): Json {
  return {
    id: String(value.id ?? ''),
    question: String(value.question ?? ''),
    options: Array.isArray(value.options)
      ? value.options.map(option => ({
          text: String(asRecord(option).text ?? ''),
          voterCount: Number(asRecord(option).voter_count ?? 0),
        }))
      : [],
    totalVoterCount: Number(value.total_voter_count ?? 0),
    isClosed: Boolean(value.is_closed),
    isAnonymous: Boolean(value.is_anonymous),
    type: value.type === 'quiz' ? 'quiz' : 'regular',
    allowsMultipleAnswers: Boolean(value.allows_multiple_answers),
    closeDate: num(value.close_date),
    openPeriod: num(value.open_period),
    explanation: text(value.explanation),
    correctOptionId: num(value.correct_option_id),
  }
}

function normalizeMessage(value: Json): Json {
  return {
    messageId: Number(value.message_id),
    date: Number(value.date),
    chat: normalizeChat(asRecord(value.chat)),
    from: value.from ? normalizeUser(asRecord(value.from)) : undefined,
    senderChat: value.sender_chat ? normalizeChat(asRecord(value.sender_chat)) : undefined,
    text: text(value.text),
    caption: text(value.caption),
    photo: Array.isArray(value.photo) ? value.photo.map(item => normalizePhotoSize(asRecord(item))) : undefined,
    document: value.document ? normalizeDocument(asRecord(value.document)) : undefined,
    location: value.location ? normalizeLocation(asRecord(value.location)) : undefined,
    poll: value.poll ? normalizePoll(asRecord(value.poll)) : undefined,
    entities: Array.isArray(value.entities) ? value.entities.map(item => asRecord(item)) : undefined,
    captionEntities: Array.isArray(value.caption_entities)
      ? value.caption_entities.map(item => asRecord(item))
      : undefined,
    forwardDate: num(value.forward_date),
    forwardFrom: value.forward_from ? normalizeUser(asRecord(value.forward_from)) : undefined,
    forwardFromChat: value.forward_from_chat ? normalizeChat(asRecord(value.forward_from_chat)) : undefined,
    forwardFromMessageId: num(value.forward_from_message_id),
    forwardSignature: text(value.forward_signature),
    forwardSenderName: text(value.forward_sender_name),
    linkPreviewOptions: value.link_preview_options ? asRecord(value.link_preview_options) : undefined,
    businessConnectionId: text(value.business_connection_id),
    video: value.video ? normalizeVideo(asRecord(value.video)) : undefined,
    audio: value.audio ? normalizeAudio(asRecord(value.audio)) : undefined,
    voice: value.voice ? normalizeVoice(asRecord(value.voice)) : undefined,
    animation: value.animation ? normalizeAnimation(asRecord(value.animation)) : undefined,
    contact: value.contact ? normalizeContact(asRecord(value.contact)) : undefined,
    venue: value.venue ? normalizeVenue(asRecord(value.venue)) : undefined,
    dice: value.dice ? normalizeDice(asRecord(value.dice)) : undefined,
  }
}

function normalizeBusinessBotRights(value: Json): Json {
  return {
    canReply: bool(value.can_reply),
    canReadMessages: bool(value.can_read_messages),
    canDeleteSentMessages: bool(value.can_delete_sent_messages),
    canDeleteAllMessages: bool(value.can_delete_all_messages),
    canEditName: bool(value.can_edit_name),
    canEditBio: bool(value.can_edit_bio),
    canEditProfilePhoto: bool(value.can_edit_profile_photo),
    canEditUsername: bool(value.can_edit_username),
    canChangeGiftSettings: bool(value.can_change_gift_settings),
    canViewGiftsAndStars: bool(value.can_view_gifts_and_stars),
    canConvertGiftsToStars: bool(value.can_convert_gifts_to_stars),
    canTransferAndUpgradeGifts: bool(value.can_transfer_and_upgrade_gifts),
    canTransferStars: bool(value.can_transfer_stars),
    canManageStories: bool(value.can_manage_stories),
  }
}

function normalizeBusinessConnection(value: Json): Json {
  return {
    id: String(value.id ?? ''),
    user: normalizeUser(asRecord(value.user)),
    userChatId: Number(value.user_chat_id),
    date: Number(value.date),
    rights: value.rights ? normalizeBusinessBotRights(asRecord(value.rights)) : undefined,
    isEnabled: Boolean(value.is_enabled),
  }
}

function normalizeBusinessMessagesDeleted(value: Json): Json {
  return {
    businessConnectionId: String(value.business_connection_id ?? ''),
    chat: normalizeChat(asRecord(value.chat)),
    messageIds: Array.isArray(value.message_ids) ? value.message_ids.map(id => Number(id)) : [],
  }
}

function normalizeUpdate(value: Json): Json {
  return {
    updateId: Number(value.update_id),
    message: value.message ? normalizeMessage(asRecord(value.message)) : undefined,
    editedMessage: value.edited_message ? normalizeMessage(asRecord(value.edited_message)) : undefined,
    channelPost: value.channel_post ? normalizeMessage(asRecord(value.channel_post)) : undefined,
    editedChannelPost: value.edited_channel_post ? normalizeMessage(asRecord(value.edited_channel_post)) : undefined,
    callbackQuery: value.callback_query ? asRecord(value.callback_query) : undefined,
    businessConnection: value.business_connection
      ? normalizeBusinessConnection(asRecord(value.business_connection))
      : undefined,
    businessMessage: value.business_message ? normalizeMessage(asRecord(value.business_message)) : undefined,
    editedBusinessMessage: value.edited_business_message
      ? normalizeMessage(asRecord(value.edited_business_message))
      : undefined,
    deletedBusinessMessages: value.deleted_business_messages
      ? normalizeBusinessMessagesDeleted(asRecord(value.deleted_business_messages))
      : undefined,
  }
}

function normalizeWebhookInfo(value: Json): Json {
  return {
    url: String(value.url ?? ''),
    hasCustomCertificate: Boolean(value.has_custom_certificate),
    pendingUpdateCount: Number(value.pending_update_count ?? 0),
    ipAddress: text(value.ip_address),
    lastErrorDate: num(value.last_error_date),
    lastErrorMessage: text(value.last_error_message),
    lastSynchronizationErrorDate: num(value.last_synchronization_error_date),
    maxConnections: num(value.max_connections),
    allowedUpdates: Array.isArray(value.allowed_updates) ? value.allowed_updates.map(item => String(item)) : undefined,
  }
}

function normalizeChatMember(value: Json): Json {
  return {
    status: String(value.status ?? ''),
    user: normalizeUser(asRecord(value.user)),
    customTitle: text(value.custom_title),
    isAnonymous: bool(value.is_anonymous),
    untilDate: num(value.until_date),
    canBeEdited: bool(value.can_be_edited),
    canChangeInfo: bool(value.can_change_info),
    canManageChat: bool(value.can_manage_chat),
    canInviteUsers: bool(value.can_invite_users),
    canPinMessages: bool(value.can_pin_messages),
    canEditMessages: bool(value.can_edit_messages),
    canPostMessages: bool(value.can_post_messages),
    canDeleteMessages: bool(value.can_delete_messages),
    canPromoteMembers: bool(value.can_promote_members),
    canRestrictMembers: bool(value.can_restrict_members),
    canManageVideoChats: bool(value.can_manage_video_chats),
    canManageTopics: bool(value.can_manage_topics),
  }
}

/** 入参用 camelCase 声明权限,Bot API 收 snake_case;没给的权限保持"不改动"而不是发 false。 */
function normalizeChatPermissions(value: unknown): Json {
  const permissions = asRecord(value)
  return compact({
    can_send_messages: permissions.canSendMessages,
    can_send_audios: permissions.canSendAudios,
    can_send_documents: permissions.canSendDocuments,
    can_send_photos: permissions.canSendPhotos,
    can_send_videos: permissions.canSendVideos,
    can_send_video_notes: permissions.canSendVideoNotes,
    can_send_voice_notes: permissions.canSendVoiceNotes,
    can_send_polls: permissions.canSendPolls,
    can_send_other_messages: permissions.canSendOtherMessages,
    can_add_web_page_previews: permissions.canAddWebPagePreviews,
    can_change_info: permissions.canChangeInfo,
    can_invite_users: permissions.canInviteUsers,
    can_pin_messages: permissions.canPinMessages,
    can_manage_topics: permissions.canManageTopics,
  })
}

function normalizeChatInviteLink(value: Json): Json {
  return {
    inviteLink: String(value.invite_link ?? ''),
    creator: normalizeUser(asRecord(value.creator)),
    createsJoinRequest: Boolean(value.creates_join_request),
    isPrimary: Boolean(value.is_primary),
    isRevoked: Boolean(value.is_revoked),
    name: text(value.name),
    expireDate: num(value.expire_date),
    memberLimit: num(value.member_limit),
    pendingJoinRequestCount: num(value.pending_join_request_count),
    subscriptionPeriod: num(value.subscription_period),
    subscriptionPrice: num(value.subscription_price),
  }
}

/**
 * copyMessages / forwardMessages 要求 message_ids 严格递增 —— schema 只能表达"1~100 个整数",
 * 表达不了顺序约束,故留在这里。不先拦下就是一次必然失败的上游调用。
 */
function assertIncreasingMessageIds(value: number[]): void {
  const increasing = value.every((id, index) => index === 0 || value[index - 1]! < id)
  if (!increasing) throw new TBError('invalid_argument', 'messageIds must be in strictly increasing order')
}

/** 上游 34.3% 的 action 没有 required 声明,edit_message_text 的目标二选一也在 schema 之外。 */
function assertEditMessageTarget(input: z.infer<typeof editMessageTextInput>): void {
  const hasInlineTarget = input.inlineMessageId != null
  const hasChatTarget = input.chatId != null || input.messageId != null
  if (hasInlineTarget && hasChatTarget) {
    throw new TBError('invalid_argument', 'edit_message_text accepts either inlineMessageId or chatId/messageId')
  }
  if (!hasInlineTarget && !(input.chatId != null && input.messageId != null)) {
    throw new TBError('invalid_argument', 'edit_message_text requires inlineMessageId or chatId with messageId')
  }
}

export async function getMe(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return normalizeUser(asRecord(await request(ctx, 'getMe')))
}

export async function getWebhookInfo(_input: unknown, ctx: ProviderContext): Promise<Json> {
  return normalizeWebhookInfo(asRecord(await request(ctx, 'getWebhookInfo')))
}

/** 契约说好是数组;不是就是上游破了契约。 */
function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new TBError('unavailable', 'Telegram 返回了非预期的数组负载', { retryable: true })
  }
  return value
}

export async function getUpdates(input: z.infer<typeof getUpdatesInput>, ctx: ProviderContext): Promise<Json> {
  const result = await request(ctx, 'getUpdates', compact({
    offset: input.offset,
    limit: input.limit,
    timeout: input.timeout,
    allowed_updates: input.allowedUpdates,
  }))
  return { updates: asArray(result).map(update => normalizeUpdate(asRecord(update))) }
}

export async function sendMessage(input: z.infer<typeof sendMessageInput>, ctx: ProviderContext): Promise<Json> {
  const result = await request(ctx, 'sendMessage', compact({
    business_connection_id: input.businessConnectionId,
    chat_id: input.chatId,
    text: input.text,
    parse_mode: input.parseMode,
    disable_notification: input.disableNotification,
    protect_content: input.protectContent,
    message_thread_id: input.messageThreadId,
    // Bot API 已经把 reply_to_message_id / disable_web_page_preview 换成了嵌套对象,
    // 入参保留扁平写法是为了好用,转换只能在这里做。
    reply_parameters: input.replyToMessageId != null ? { message_id: input.replyToMessageId } : undefined,
    link_preview_options: input.disableWebPagePreview === true ? { is_disabled: true } : undefined,
  }))
  return normalizeMessage(asRecord(result))
}

export async function copyMessage(input: z.infer<typeof copyMessageInput>, ctx: ProviderContext): Promise<Json> {
  const result = asRecord(await request(ctx, 'copyMessage', compact({
    chat_id: input.chatId,
    from_chat_id: input.fromChatId,
    message_id: input.messageId,
    message_thread_id: input.messageThreadId,
    caption: input.caption,
    parse_mode: input.parseMode,
    show_caption_above_media: input.showCaptionAboveMedia,
    disable_notification: input.disableNotification,
    protect_content: input.protectContent,
  })))
  return { messageId: Number(result.message_id) }
}

/** copyMessages 与 forwardMessages 只差一个 remove_caption。 */
async function transferMessages(
  ctx: ProviderContext,
  method: 'copyMessages' | 'forwardMessages',
  input: z.infer<typeof copyMessagesInput> | z.infer<typeof forwardMessagesInput>,
): Promise<Json> {
  assertIncreasingMessageIds(input.messageIds)
  const result = await request(ctx, method, compact({
    chat_id: input.chatId,
    from_chat_id: input.fromChatId,
    message_ids: input.messageIds,
    message_thread_id: input.messageThreadId,
    disable_notification: input.disableNotification,
    protect_content: input.protectContent,
    remove_caption: method === 'copyMessages' ? (input as z.infer<typeof copyMessagesInput>).removeCaption : undefined,
  }))
  return { messageIds: asArray(result).map(message => Number(asRecord(message).message_id)) }
}

export function copyMessages(input: z.infer<typeof copyMessagesInput>, ctx: ProviderContext): Promise<Json> {
  return transferMessages(ctx, 'copyMessages', input)
}

export function forwardMessages(input: z.infer<typeof forwardMessagesInput>, ctx: ProviderContext): Promise<Json> {
  return transferMessages(ctx, 'forwardMessages', input)
}

export function deleteMessages(input: z.infer<typeof deleteMessagesInput>, ctx: ProviderContext): Promise<Json> {
  return booleanAction(ctx, 'deleteMessages', {
    chat_id: input.chatId,
    message_ids: input.messageIds,
  })
}

export function setMessageReaction(
  input: z.infer<typeof setMessageReactionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return booleanAction(ctx, 'setMessageReaction', compact({
    chat_id: input.chatId,
    message_id: input.messageId,
    reaction: input.reaction,
    is_big: input.isBig,
  }))
}

export function sendChatAction(input: z.infer<typeof sendChatActionInput>, ctx: ProviderContext): Promise<Json> {
  return booleanAction(ctx, 'sendChatAction', compact({
    business_connection_id: input.businessConnectionId,
    chat_id: input.chatId,
    message_thread_id: input.messageThreadId,
    action: input.action,
  }))
}

type MediaInput
  = | z.infer<typeof sendAnimationInput>
    | z.infer<typeof sendAudioInput>
    | z.infer<typeof sendVideoInput>
    | z.infer<typeof sendVoiceInput>

/** 四个 sendXxx 媒体 action 共用一个请求体形状,只有媒体字段名不同;没有的字段由 compact 丢掉。 */
async function sendMedia(
  ctx: ProviderContext,
  method: 'sendAnimation' | 'sendAudio' | 'sendVideo' | 'sendVoice',
  field: 'animation' | 'audio' | 'video' | 'voice',
  input: MediaInput,
): Promise<Json> {
  const source = input as Record<string, unknown>
  const result = await request(ctx, method, compact({
    business_connection_id: input.businessConnectionId,
    chat_id: input.chatId,
    message_thread_id: input.messageThreadId,
    [field]: urlOrFileId(source[field]),
    caption: source.caption,
    parse_mode: source.parseMode,
    duration: source.duration,
    width: source.width,
    height: source.height,
    performer: source.performer,
    title: source.title,
    cover: urlOrFileId(source.cover),
    start_timestamp: source.startTimestamp,
    show_caption_above_media: source.showCaptionAboveMedia,
    has_spoiler: source.hasSpoiler,
    supports_streaming: source.supportsStreaming,
    disable_notification: input.disableNotification,
    protect_content: input.protectContent,
  }))
  return normalizeMessage(asRecord(result))
}

export function sendVideo(input: z.infer<typeof sendVideoInput>, ctx: ProviderContext): Promise<Json> {
  return sendMedia(ctx, 'sendVideo', 'video', input)
}

export function sendAudio(input: z.infer<typeof sendAudioInput>, ctx: ProviderContext): Promise<Json> {
  return sendMedia(ctx, 'sendAudio', 'audio', input)
}

export function sendVoice(input: z.infer<typeof sendVoiceInput>, ctx: ProviderContext): Promise<Json> {
  return sendMedia(ctx, 'sendVoice', 'voice', input)
}

export function sendAnimation(input: z.infer<typeof sendAnimationInput>, ctx: ProviderContext): Promise<Json> {
  return sendMedia(ctx, 'sendAnimation', 'animation', input)
}

export async function sendMediaGroup(
  input: z.infer<typeof sendMediaGroupInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const result = await request(ctx, 'sendMediaGroup', compact({
    business_connection_id: input.businessConnectionId,
    chat_id: input.chatId,
    message_thread_id: input.messageThreadId,
    media: input.media,
    disable_notification: input.disableNotification,
    protect_content: input.protectContent,
  }))
  return { messages: asArray(result).map(message => normalizeMessage(asRecord(message))) }
}

/** sendContact / sendVenue / sendDice:投递选项一样,只有中间那几个业务字段不同。 */
async function sendStructuredMessage(
  ctx: ProviderContext,
  method: 'sendContact' | 'sendDice' | 'sendVenue',
  fields: Body,
  input: z.infer<typeof sendContactInput> | z.infer<typeof sendDiceInput> | z.infer<typeof sendVenueInput>,
): Promise<Json> {
  const result = await request(ctx, method, compact({
    business_connection_id: input.businessConnectionId,
    chat_id: input.chatId,
    message_thread_id: input.messageThreadId,
    ...fields,
    disable_notification: input.disableNotification,
    protect_content: input.protectContent,
  }))
  return normalizeMessage(asRecord(result))
}

export function sendContact(input: z.infer<typeof sendContactInput>, ctx: ProviderContext): Promise<Json> {
  return sendStructuredMessage(ctx, 'sendContact', {
    phone_number: input.phoneNumber,
    first_name: input.firstName,
    last_name: input.lastName,
    vcard: input.vcard,
  }, input)
}

export function sendVenue(input: z.infer<typeof sendVenueInput>, ctx: ProviderContext): Promise<Json> {
  return sendStructuredMessage(ctx, 'sendVenue', {
    latitude: input.latitude,
    longitude: input.longitude,
    title: input.title,
    address: input.address,
    foursquare_id: input.foursquareId,
    foursquare_type: input.foursquareType,
    google_place_id: input.googlePlaceId,
    google_place_type: input.googlePlaceType,
  }, input)
}

export function sendDice(input: z.infer<typeof sendDiceInput>, ctx: ProviderContext): Promise<Json> {
  return sendStructuredMessage(ctx, 'sendDice', { emoji: input.emoji }, input)
}

export async function getBusinessConnection(
  input: z.infer<typeof getBusinessConnectionInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const result = await request(ctx, 'getBusinessConnection', {
    business_connection_id: input.businessConnectionId,
  })
  return normalizeBusinessConnection(asRecord(result))
}

export function readBusinessMessage(
  input: z.infer<typeof readBusinessMessageInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return booleanAction(ctx, 'readBusinessMessage', {
    business_connection_id: input.businessConnectionId,
    chat_id: input.chatId,
    message_id: input.messageId,
  })
}

export function deleteBusinessMessages(
  input: z.infer<typeof deleteBusinessMessagesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return booleanAction(ctx, 'deleteBusinessMessages', {
    business_connection_id: input.businessConnectionId,
    message_ids: input.messageIds,
  })
}

export async function editMessageText(
  input: z.infer<typeof editMessageTextInput>,
  ctx: ProviderContext,
): Promise<Json> {
  assertEditMessageTarget(input)
  const result = await request(ctx, 'editMessageText', compact({
    chat_id: input.chatId,
    message_id: input.messageId,
    inline_message_id: input.inlineMessageId,
    text: input.text,
    parse_mode: input.parseMode,
    link_preview_options: input.disableWebPagePreview === true ? { is_disabled: true } : undefined,
  }))
  // 编辑 inline message 时 Bot API 只回 `true`(没有可回传的 message 对象)。
  if (result === true) {
    return { edited: true, message: null, inlineMessageId: text(input.inlineMessageId) ?? null }
  }
  return { edited: true, message: normalizeMessage(asRecord(result)), inlineMessageId: null }
}

export async function sendPhoto(input: z.infer<typeof sendPhotoInput>, ctx: ProviderContext): Promise<Json> {
  const result = await request(ctx, 'sendPhoto', compact({
    chat_id: input.chatId,
    photo: urlOrFileId(input.photo),
    caption: input.caption,
    parse_mode: input.parseMode,
    disable_notification: input.disableNotification,
    protect_content: input.protectContent,
    message_thread_id: input.messageThreadId,
    reply_parameters: input.replyToMessageId != null ? { message_id: input.replyToMessageId } : undefined,
  }))
  return normalizeMessage(asRecord(result))
}

export async function sendDocument(input: z.infer<typeof sendDocumentInput>, ctx: ProviderContext): Promise<Json> {
  const result = await request(ctx, 'sendDocument', compact({
    chat_id: input.chatId,
    document: urlOrFileId(input.document),
    caption: input.caption,
    parse_mode: input.parseMode,
    thumbnail: urlOrFileId(input.thumbnail),
    reply_markup: jsonLike(input.replyMarkup),
    reply_to_message_id: input.replyToMessageId,
    disable_notification: input.disableNotification,
    disable_content_type_detection: input.disableContentTypeDetection,
  }))
  return normalizeMessage(asRecord(result))
}

export async function sendPoll(input: z.infer<typeof sendPollInput>, ctx: ProviderContext): Promise<Json> {
  // 两条 schema 表达不了的约束:Bot API 会拒,先拦下省一次必然失败的出站。
  if (input.openPeriod != null && input.closeDate != null) {
    throw new TBError('invalid_argument', 'send_poll accepts only one of openPeriod or closeDate')
  }
  if (input.type === 'quiz' && input.correctOptionId == null) {
    throw new TBError('invalid_argument', 'send_poll quiz polls require correctOptionId')
  }
  const result = await request(ctx, 'sendPoll', compact({
    chat_id: input.chatId,
    question: input.question,
    options: input.options,
    type: input.type,
    is_anonymous: input.isAnonymous,
    allows_multiple_answers: input.allowsMultipleAnswers,
    correct_option_id: input.correctOptionId,
    explanation: input.explanation,
    explanation_parse_mode: input.explanationParseMode,
    open_period: input.openPeriod,
    close_date: input.closeDate,
    is_closed: input.isClosed,
    disable_notification: input.disableNotification,
    reply_to_message_id: input.replyToMessageId,
    reply_markup: jsonLike(input.replyMarkup),
  }))
  return normalizeMessage(asRecord(result))
}

export async function getChat(input: z.infer<typeof getChatInput>, ctx: ProviderContext): Promise<Json> {
  return normalizeChat(asRecord(await request(ctx, 'getChat', { chat_id: input.chatId })))
}

export async function getChatMember(input: z.infer<typeof getChatMemberInput>, ctx: ProviderContext): Promise<Json> {
  const result = await request(ctx, 'getChatMember', { chat_id: input.chatId, user_id: input.userId })
  return normalizeChatMember(asRecord(result))
}

export async function getChatAdministrators(
  input: z.infer<typeof getChatAdministratorsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const result = await request(ctx, 'getChatAdministrators', { chat_id: input.chatId })
  return { administrators: asArray(result).map(member => normalizeChatMember(asRecord(member))) }
}

export async function getChatMembersCount(
  input: z.infer<typeof getChatMembersCountInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // 上游方法名是 getChatMemberCount(单数 Member),action 名是复数 —— 别跟着 action 名改。
  const result = await request(ctx, 'getChatMemberCount', { chat_id: input.chatId })
  const count = num(result)
  if (count === undefined) {
    throw new TBError('unavailable', 'Telegram 的成员数不是一个数字', { retryable: true })
  }
  return { memberCount: count }
}

export function banChatMember(input: z.infer<typeof banChatMemberInput>, ctx: ProviderContext): Promise<Json> {
  return booleanAction(ctx, 'banChatMember', compact({
    chat_id: input.chatId,
    user_id: input.userId,
    until_date: input.untilDate,
    revoke_messages: input.revokeMessages,
  }))
}

export function unbanChatMember(input: z.infer<typeof unbanChatMemberInput>, ctx: ProviderContext): Promise<Json> {
  return booleanAction(ctx, 'unbanChatMember', compact({
    chat_id: input.chatId,
    user_id: input.userId,
    only_if_banned: input.onlyIfBanned,
  }))
}

export function restrictChatMember(
  input: z.infer<typeof restrictChatMemberInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return booleanAction(ctx, 'restrictChatMember', compact({
    chat_id: input.chatId,
    user_id: input.userId,
    permissions: normalizeChatPermissions(input.permissions),
    use_independent_chat_permissions: input.useIndependentChatPermissions,
    until_date: input.untilDate,
  }))
}

export function promoteChatMember(
  input: z.infer<typeof promoteChatMemberInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return booleanAction(ctx, 'promoteChatMember', compact({
    chat_id: input.chatId,
    user_id: input.userId,
    is_anonymous: input.isAnonymous,
    can_manage_chat: input.canManageChat,
    can_delete_messages: input.canDeleteMessages,
    can_manage_video_chats: input.canManageVideoChats,
    can_restrict_members: input.canRestrictMembers,
    can_promote_members: input.canPromoteMembers,
    can_change_info: input.canChangeInfo,
    can_invite_users: input.canInviteUsers,
    can_post_stories: input.canPostStories,
    can_edit_stories: input.canEditStories,
    can_delete_stories: input.canDeleteStories,
    can_post_messages: input.canPostMessages,
    can_edit_messages: input.canEditMessages,
    can_pin_messages: input.canPinMessages,
    can_manage_topics: input.canManageTopics,
    can_manage_direct_messages: input.canManageDirectMessages,
    can_manage_tags: input.canManageTags,
  }))
}

export function setChatPermissions(
  input: z.infer<typeof setChatPermissionsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return booleanAction(ctx, 'setChatPermissions', compact({
    chat_id: input.chatId,
    permissions: normalizeChatPermissions(input.permissions),
    use_independent_chat_permissions: input.useIndependentChatPermissions,
  }))
}

export function pinChatMessage(input: z.infer<typeof pinChatMessageInput>, ctx: ProviderContext): Promise<Json> {
  return booleanAction(ctx, 'pinChatMessage', compact({
    business_connection_id: input.businessConnectionId,
    chat_id: input.chatId,
    message_id: input.messageId,
    disable_notification: input.disableNotification,
  }))
}

export function unpinChatMessage(input: z.infer<typeof unpinChatMessageInput>, ctx: ProviderContext): Promise<Json> {
  return booleanAction(ctx, 'unpinChatMessage', compact({
    business_connection_id: input.businessConnectionId,
    chat_id: input.chatId,
    message_id: input.messageId,
  }))
}

export function unpinAllChatMessages(
  input: z.infer<typeof unpinAllChatMessagesInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return booleanAction(ctx, 'unpinAllChatMessages', { chat_id: input.chatId })
}

export function approveChatJoinRequest(
  input: z.infer<typeof approveChatJoinRequestInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return booleanAction(ctx, 'approveChatJoinRequest', { chat_id: input.chatId, user_id: input.userId })
}

export function declineChatJoinRequest(
  input: z.infer<typeof declineChatJoinRequestInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return booleanAction(ctx, 'declineChatJoinRequest', { chat_id: input.chatId, user_id: input.userId })
}

export function deleteMessage(input: z.infer<typeof deleteMessageInput>, ctx: ProviderContext): Promise<Json> {
  return booleanAction(ctx, 'deleteMessage', { chat_id: input.chatId, message_id: input.messageId })
}

export async function forwardMessage(input: z.infer<typeof forwardMessageInput>, ctx: ProviderContext): Promise<Json> {
  const result = await request(ctx, 'forwardMessage', compact({
    chat_id: input.chatId,
    from_chat_id: input.fromChatId,
    message_id: input.messageId,
    disable_notification: input.disableNotification,
  }))
  return normalizeMessage(asRecord(result))
}

export async function sendLocation(input: z.infer<typeof sendLocationInput>, ctx: ProviderContext): Promise<Json> {
  const result = await request(ctx, 'sendLocation', compact({
    chat_id: input.chatId,
    latitude: input.latitude,
    longitude: input.longitude,
    horizontal_accuracy: input.horizontalAccuracy,
    live_period: input.livePeriod,
    heading: input.heading,
    proximity_alert_radius: input.proximityAlertRadius,
    disable_notification: input.disableNotification,
    reply_to_message_id: input.replyToMessageId,
    reply_markup: jsonLike(input.replyMarkup),
  }))
  return normalizeMessage(asRecord(result))
}

export async function exportChatInviteLink(
  input: z.infer<typeof exportChatInviteLinkInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const result = await request(ctx, 'exportChatInviteLink', { chat_id: input.chatId })
  if (typeof result !== 'string') {
    throw new TBError('unavailable', 'Telegram 的邀请链接不是一个字符串', { retryable: true })
  }
  return { inviteLink: result }
}

async function mutateChatInviteLink(
  ctx: ProviderContext,
  method: 'createChatInviteLink' | 'editChatInviteLink' | 'revokeChatInviteLink',
  input:
    | z.infer<typeof createChatInviteLinkInput>
    | z.infer<typeof editChatInviteLinkInput>
    | z.infer<typeof revokeChatInviteLinkInput>,
): Promise<Json> {
  const source = input as Record<string, unknown>
  // 带审批的链接不能同时设人数上限:Bot API 会拒,先拦下。
  if (source.memberLimit != null && source.createsJoinRequest === true) {
    throw new TBError('invalid_argument', 'memberLimit cannot be combined with createsJoinRequest')
  }
  const result = await request(ctx, method, compact({
    chat_id: input.chatId,
    invite_link: source.inviteLink,
    name: source.name,
    expire_date: source.expireDate,
    member_limit: source.memberLimit,
    creates_join_request: source.createsJoinRequest,
  }))
  return normalizeChatInviteLink(asRecord(result))
}

export function createChatInviteLink(
  input: z.infer<typeof createChatInviteLinkInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return mutateChatInviteLink(ctx, 'createChatInviteLink', input)
}

export function editChatInviteLink(
  input: z.infer<typeof editChatInviteLinkInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return mutateChatInviteLink(ctx, 'editChatInviteLink', input)
}

export function revokeChatInviteLink(
  input: z.infer<typeof revokeChatInviteLinkInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return mutateChatInviteLink(ctx, 'revokeChatInviteLink', input)
}

export function answerCallbackQuery(
  input: z.infer<typeof answerCallbackQueryInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return booleanAction(ctx, 'answerCallbackQuery', compact({
    callback_query_id: input.callbackQueryId,
    text: input.text,
    show_alert: input.showAlert,
    url: publicUrl(input.url),
    cache_time: input.cacheTime,
  }))
}

export function setMyCommands(input: z.infer<typeof setMyCommandsInput>, ctx: ProviderContext): Promise<Json> {
  return booleanAction(ctx, 'setMyCommands', compact({
    commands: input.commands,
    scope: jsonLike(input.scope),
    language_code: input.languageCode,
  }))
}

export function setWebhook(input: z.infer<typeof setWebhookInput>, ctx: ProviderContext): Promise<Json> {
  return booleanAction(ctx, 'setWebhook', compact({
    // Telegram 会主动回访这个地址,故它同样要过出站可达性判定(填内网地址等于让上游探我们的内网)。
    url: publicUrl(input.url),
    secret_token: input.secretToken,
    max_connections: input.maxConnections,
    allowed_updates: input.allowedUpdates,
    drop_pending_updates: input.dropPendingUpdates,
  }))
}

export function deleteWebhook(input: z.infer<typeof deleteWebhookInput>, ctx: ProviderContext): Promise<Json> {
  return booleanAction(ctx, 'deleteWebhook', compact({ drop_pending_updates: input.dropPendingUpdates }))
}
