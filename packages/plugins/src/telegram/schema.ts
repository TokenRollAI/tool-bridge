/**
 * Telegram Bot 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getMeInput = z.strictObject({}).describe('Action input.')

export const getMeOutput = z.looseObject({}).describe('A Telegram user or bot record.')

export const getWebhookInfoInput = z.strictObject({}).describe('Action input.')

export const getWebhookInfoOutput = z.looseObject({}).describe('Telegram webhook status information.')

export const getUpdatesInput = z.strictObject({
  offset: z.int().describe('The update ID offset to start polling from.').optional(),
  limit: z.int().min(1).max(100).describe('The maximum number of updates to return.').optional(),
  timeout: z.int().min(0).max(50).describe('The long-polling timeout in seconds.').optional(),
  allowedUpdates: z.array(z.string().min(1)).describe('The update types to receive.').optional(),
}).describe('Action input.')

export const getUpdatesOutput = z.strictObject({
  updates: z.array(z.looseObject({}).describe('A Telegram update payload.')).describe('The updates returned by Telegram.'),
}).describe('Action output.')

export const sendMessageInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  text: z.string().min(1).max(4096).describe('The text of the message to send.'),
  businessConnectionId: z.string().min(1).describe('The unique identifier of the Telegram business connection.').optional(),
  parseMode: z.enum(['Markdown', 'MarkdownV2', 'HTML']).describe('The parse mode used for message entities.').optional(),
  disableNotification: z.boolean().describe('Whether to send the message silently.').optional(),
  protectContent: z.boolean().describe('Whether to protect the sent message from forwarding and saving.').optional(),
  disableWebPagePreview: z.boolean().describe('Whether to disable link previews in the message.').optional(),
  messageThreadId: z.int().min(1).describe('The forum topic ID for the target message thread.').optional(),
  replyToMessageId: z.int().min(1).describe('The message ID to reply to.').optional(),
}).describe('Action input.')

export const sendMessageOutput = z.looseObject({}).describe('A normalized Telegram message record.')

export const copyMessageInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  fromChatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  messageId: z.int().min(1).describe('A Telegram message identifier.'),
  messageThreadId: z.int().min(1).describe('The target forum topic identifier.').optional(),
  caption: z.string().max(1024).describe('A replacement media caption.').optional(),
  parseMode: z.enum(['Markdown', 'MarkdownV2', 'HTML']).describe('The parse mode used for message entities.').optional(),
  showCaptionAboveMedia: z.boolean().describe('Whether to show the replacement caption above the media.').optional(),
  disableNotification: z.boolean().describe('Whether to copy the message silently.').optional(),
  protectContent: z.boolean().describe('Whether to protect the copied message from forwarding and saving.').optional(),
}).describe('Action input.')

export const copyMessageOutput = z.strictObject({
  messageId: z.int().min(1).describe('A Telegram message identifier.'),
}).describe('Action output.')

export const copyMessagesInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  fromChatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  messageIds: z.array(z.int().min(1).describe('A Telegram message identifier.')).min(1).max(100).describe('The identifiers of 1-100 Telegram messages.'),
  messageThreadId: z.int().min(1).describe('The target forum topic identifier.').optional(),
  disableNotification: z.boolean().describe('Whether to deliver the messages silently.').optional(),
  protectContent: z.boolean().describe('Whether to protect the messages from forwarding and saving.').optional(),
  removeCaption: z.boolean().describe('Whether to remove captions from copied messages.').optional(),
}).describe('Action input.')

export const copyMessagesOutput = z.strictObject({
  messageIds: z.array(z.int().min(1).describe('A Telegram message identifier.')).describe('The returned message identifiers.'),
}).describe('Action output.')

export const forwardMessagesInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  fromChatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  messageIds: z.array(z.int().min(1).describe('A Telegram message identifier.')).min(1).max(100).describe('The identifiers of 1-100 Telegram messages.'),
  messageThreadId: z.int().min(1).describe('The target forum topic identifier.').optional(),
  disableNotification: z.boolean().describe('Whether to deliver the messages silently.').optional(),
  protectContent: z.boolean().describe('Whether to protect the messages from forwarding and saving.').optional(),
}).describe('Action input.')

export const forwardMessagesOutput = z.strictObject({
  messageIds: z.array(z.int().min(1).describe('A Telegram message identifier.')).describe('The returned message identifiers.'),
}).describe('Action output.')

export const deleteMessagesInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  messageIds: z.array(z.int().min(1).describe('A Telegram message identifier.')).min(1).max(100).describe('The identifiers of 1-100 Telegram messages.'),
}).describe('Action input.')

export const deleteMessagesOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const setMessageReactionInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  messageId: z.int().min(1).describe('A Telegram message identifier.'),
  reaction: z.array(z.looseObject({}).describe('A Telegram ReactionType object.')).max(1).describe('The reaction types to set; an empty array removes the reaction.').optional(),
  isBig: z.boolean().describe('Whether to display a large reaction animation.').optional(),
}).describe('Action input.')

export const setMessageReactionOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const sendChatActionInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  action: z.enum(['typing', 'upload_photo', 'record_video', 'upload_video', 'record_voice', 'upload_voice', 'upload_document', 'choose_sticker', 'find_location', 'record_video_note', 'upload_video_note']).describe('The activity status to broadcast.'),
  businessConnectionId: z.string().min(1).describe('The unique identifier of the Telegram business connection.').optional(),
  messageThreadId: z.int().min(1).describe('The target forum topic identifier.').optional(),
}).describe('Action input.')

export const sendChatActionOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const sendVideoInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  video: z.string().min(1).describe('The HTTP URL or Telegram file_id of the MPEG-4 video to send.'),
  businessConnectionId: z.string().min(1).describe('The unique identifier of the Telegram business connection.').optional(),
  caption: z.string().max(1024).describe('The media caption.').optional(),
  parseMode: z.enum(['Markdown', 'MarkdownV2', 'HTML']).describe('The parse mode used for message entities.').optional(),
  duration: z.int().min(0).describe('The media duration in seconds.').optional(),
  width: z.int().min(1).describe('The video width.').optional(),
  height: z.int().min(1).describe('The video height.').optional(),
  cover: z.string().min(1).describe('The HTTP URL or Telegram file_id of the video cover.').optional(),
  startTimestamp: z.int().min(0).describe('The start timestamp shown for the video.').optional(),
  showCaptionAboveMedia: z.boolean().describe('Whether to show the caption above the video.').optional(),
  hasSpoiler: z.boolean().describe('Whether to cover the video with a spoiler animation.').optional(),
  supportsStreaming: z.boolean().describe('Whether the video supports streaming.').optional(),
  messageThreadId: z.int().min(1).describe('The target forum topic identifier.').optional(),
  disableNotification: z.boolean().describe('Whether to send the media silently.').optional(),
  protectContent: z.boolean().describe('Whether to protect the media from forwarding and saving.').optional(),
}).describe('Action input.')

export const sendVideoOutput = z.looseObject({}).describe('A normalized Telegram message record.')

export const sendAudioInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  audio: z.string().min(1).describe('The HTTP URL or Telegram file_id of the MP3 or M4A audio to send.'),
  businessConnectionId: z.string().min(1).describe('The unique identifier of the Telegram business connection.').optional(),
  caption: z.string().max(1024).describe('The media caption.').optional(),
  parseMode: z.enum(['Markdown', 'MarkdownV2', 'HTML']).describe('The parse mode used for message entities.').optional(),
  duration: z.int().min(0).describe('The media duration in seconds.').optional(),
  performer: z.string().describe('The audio performer.').optional(),
  title: z.string().describe('The audio track name.').optional(),
  messageThreadId: z.int().min(1).describe('The target forum topic identifier.').optional(),
  disableNotification: z.boolean().describe('Whether to send the media silently.').optional(),
  protectContent: z.boolean().describe('Whether to protect the media from forwarding and saving.').optional(),
}).describe('Action input.')

export const sendAudioOutput = z.looseObject({}).describe('A normalized Telegram message record.')

export const sendVoiceInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  voice: z.string().min(1).describe('The HTTP URL or Telegram file_id of the OGG, MP3, or M4A voice message.'),
  businessConnectionId: z.string().min(1).describe('The unique identifier of the Telegram business connection.').optional(),
  caption: z.string().max(1024).describe('The media caption.').optional(),
  parseMode: z.enum(['Markdown', 'MarkdownV2', 'HTML']).describe('The parse mode used for message entities.').optional(),
  duration: z.int().min(0).describe('The media duration in seconds.').optional(),
  messageThreadId: z.int().min(1).describe('The target forum topic identifier.').optional(),
  disableNotification: z.boolean().describe('Whether to send the media silently.').optional(),
  protectContent: z.boolean().describe('Whether to protect the media from forwarding and saving.').optional(),
}).describe('Action input.')

export const sendVoiceOutput = z.looseObject({}).describe('A normalized Telegram message record.')

export const sendAnimationInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  animation: z.string().min(1).describe('The HTTP URL or Telegram file_id of the GIF or silent MPEG-4 animation.'),
  businessConnectionId: z.string().min(1).describe('The unique identifier of the Telegram business connection.').optional(),
  caption: z.string().max(1024).describe('The media caption.').optional(),
  parseMode: z.enum(['Markdown', 'MarkdownV2', 'HTML']).describe('The parse mode used for message entities.').optional(),
  duration: z.int().min(0).describe('The media duration in seconds.').optional(),
  width: z.int().min(1).describe('The animation width.').optional(),
  height: z.int().min(1).describe('The animation height.').optional(),
  showCaptionAboveMedia: z.boolean().describe('Whether to show the caption above the animation.').optional(),
  hasSpoiler: z.boolean().describe('Whether to cover the animation with a spoiler animation.').optional(),
  messageThreadId: z.int().min(1).describe('The target forum topic identifier.').optional(),
  disableNotification: z.boolean().describe('Whether to send the media silently.').optional(),
  protectContent: z.boolean().describe('Whether to protect the media from forwarding and saving.').optional(),
}).describe('Action input.')

export const sendAnimationOutput = z.looseObject({}).describe('A normalized Telegram message record.')

export const sendMediaGroupInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  media: z.array(z.looseObject({
    type: z.enum(['photo', 'video', 'audio', 'document']).describe('The media type.'),
    media: z.string().min(1).describe('The HTTP URL or Telegram file_id of the media.'),
  }).describe('A Telegram InputMedia object.')).min(2).max(10).describe('The InputMedia objects in the album.'),
  businessConnectionId: z.string().min(1).describe('The unique identifier of the Telegram business connection.').optional(),
  messageThreadId: z.int().min(1).describe('The target forum topic identifier.').optional(),
  disableNotification: z.boolean().describe('Whether to send the album silently.').optional(),
  protectContent: z.boolean().describe('Whether to protect the album from forwarding and saving.').optional(),
}).describe('Action input.')

export const sendMediaGroupOutput = z.strictObject({
  messages: z.array(z.looseObject({}).describe('A normalized Telegram message record.')).describe('The sent media messages.'),
}).describe('Action output.')

export const sendContactInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  phoneNumber: z.string().min(1).describe('The contact phone number.'),
  firstName: z.string().min(1).describe('The contact first name.'),
  lastName: z.string().describe('The contact last name.').optional(),
  vcard: z.string().max(2048).describe('Additional contact data in vCard format.').optional(),
  businessConnectionId: z.string().min(1).describe('The unique identifier of the Telegram business connection.').optional(),
  messageThreadId: z.int().min(1).describe('The target forum topic identifier.').optional(),
  disableNotification: z.boolean().describe('Whether to send the contact silently.').optional(),
  protectContent: z.boolean().describe('Whether to protect the contact from forwarding and saving.').optional(),
}).describe('Action input.')

export const sendContactOutput = z.looseObject({}).describe('A normalized Telegram message record.')

export const sendVenueInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  latitude: z.number().min(-90).max(90).describe('The venue latitude.'),
  longitude: z.number().min(-180).max(180).describe('The venue longitude.'),
  title: z.string().min(1).describe('The venue name.'),
  address: z.string().min(1).describe('The venue address.'),
  foursquareId: z.string().describe('The Foursquare place identifier.').optional(),
  foursquareType: z.string().describe('The Foursquare place type.').optional(),
  googlePlaceId: z.string().describe('The Google Places identifier.').optional(),
  googlePlaceType: z.string().describe('The Google Places type.').optional(),
  businessConnectionId: z.string().min(1).describe('The unique identifier of the Telegram business connection.').optional(),
  messageThreadId: z.int().min(1).describe('The target forum topic identifier.').optional(),
  disableNotification: z.boolean().describe('Whether to send the venue silently.').optional(),
  protectContent: z.boolean().describe('Whether to protect the venue from forwarding and saving.').optional(),
}).describe('Action input.')

export const sendVenueOutput = z.looseObject({}).describe('A normalized Telegram message record.')

export const sendDiceInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  emoji: z.enum(['🎲', '🎯', '🏀', '⚽', '🎳', '🎰']).describe('The dice animation emoji.').optional(),
  businessConnectionId: z.string().min(1).describe('The unique identifier of the Telegram business connection.').optional(),
  messageThreadId: z.int().min(1).describe('The target forum topic identifier.').optional(),
  disableNotification: z.boolean().describe('Whether to send the animation silently.').optional(),
  protectContent: z.boolean().describe('Whether to protect the animation from forwarding.').optional(),
}).describe('Action input.')

export const sendDiceOutput = z.looseObject({}).describe('A normalized Telegram message record.')

export const getBusinessConnectionInput = z.strictObject({
  businessConnectionId: z.string().min(1).describe('The unique identifier of the Telegram business connection.'),
}).describe('Action input.')

export const getBusinessConnectionOutput = z.looseObject({}).describe('A Telegram business connection record.')

export const readBusinessMessageInput = z.strictObject({
  businessConnectionId: z.string().min(1).describe('The unique identifier of the Telegram business connection.'),
  chatId: z.int().describe('The identifier of the active private chat.'),
  messageId: z.int().min(1).describe('A Telegram message identifier.'),
}).describe('Action input.')

export const readBusinessMessageOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const deleteBusinessMessagesInput = z.strictObject({
  businessConnectionId: z.string().min(1).describe('The unique identifier of the Telegram business connection.'),
  messageIds: z.array(z.int().min(1).describe('A Telegram message identifier.')).min(1).max(100).describe('The identifiers of 1-100 Telegram messages.'),
}).describe('Action input.')

export const deleteBusinessMessagesOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const editMessageTextInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.').optional(),
  messageId: z.int().min(1).describe('The message ID to edit.').optional(),
  inlineMessageId: z.string().min(1).describe('The inline message ID to edit.').optional(),
  text: z.string().min(1).max(4096).describe('The new message text.'),
  parseMode: z.enum(['Markdown', 'MarkdownV2', 'HTML']).describe('The parse mode used for message entities.').optional(),
  disableWebPagePreview: z.boolean().describe('Whether to disable link previews in the edited message.').optional(),
}).describe('Action input.')

export const editMessageTextOutput = z.strictObject({
  edited: z.literal(true).describe('Whether the message edit succeeded.'),
  message: z.looseObject({}).describe('A normalized Telegram message record.').nullable(),
  inlineMessageId: z.string().describe('The inline message ID when editing an inline message.').nullable(),
}).describe('Action output.')

export const sendPhotoInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  photo: z.string().min(1).describe('The photo URL or existing Telegram file_id to send.'),
  caption: z.string().max(1024).describe('The caption for the photo.').optional(),
  parseMode: z.enum(['Markdown', 'MarkdownV2', 'HTML']).describe('The parse mode used for message entities.').optional(),
  disableNotification: z.boolean().describe('Whether to send the photo silently.').optional(),
  protectContent: z.boolean().describe('Whether to protect the photo from forwarding and saving.').optional(),
  messageThreadId: z.int().min(1).describe('The forum topic ID for the target message thread.').optional(),
  replyToMessageId: z.int().min(1).describe('The message ID to reply to.').optional(),
}).describe('Action input.')

export const sendPhotoOutput = z.looseObject({}).describe('A normalized Telegram message record.')

export const sendDocumentInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  document: z.string().min(1).describe('The document URL or existing Telegram file_id to send.'),
  caption: z.string().max(1024).describe('The caption for the document.').optional(),
  parseMode: z.enum(['Markdown', 'MarkdownV2', 'HTML']).describe('The parse mode used for message entities.').optional(),
  thumbnail: z.string().min(1).describe('An optional thumbnail URL or file identifier.').optional(),
  replyMarkup: z.union([z.string().min(1).describe('A JSON-serialized object string.'), z.looseObject({}).describe('A Telegram reply markup object.')]).describe('A Telegram reply markup object or JSON object string.').optional(),
  replyToMessageId: z.int().min(1).describe('The message ID to reply to.').optional(),
  disableNotification: z.boolean().describe('Whether to send the document silently.').optional(),
  disableContentTypeDetection: z.boolean().describe('Whether to disable server-side content type detection.').optional(),
}).describe('Action input.')

export const sendDocumentOutput = z.looseObject({}).describe('A normalized Telegram message record.')

export const sendPollInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  question: z.string().min(1).max(300).describe('The question shown at the top of the poll.'),
  options: z.array(z.string().min(1).max(100)).min(2).max(10).describe('The answer options available in the poll.'),
  type: z.enum(['regular', 'quiz']).describe('The type of poll to send.').optional(),
  isAnonymous: z.boolean().describe('Whether the poll should be anonymous.').optional(),
  allowsMultipleAnswers: z.boolean().describe('Whether users can choose multiple answers.').optional(),
  correctOptionId: z.int().min(0).describe('The zero-based index of the correct option for quiz polls.').optional(),
  explanation: z.string().max(200).describe('The explanation shown for quiz polls.').optional(),
  explanationParseMode: z.enum(['Markdown', 'MarkdownV2', 'HTML']).describe('The parse mode used for message entities.').optional(),
  openPeriod: z.int().min(5).max(600).describe('The number of seconds the poll should stay open.').optional(),
  closeDate: z.int().describe('The Unix timestamp when the poll should close.').optional(),
  isClosed: z.boolean().describe('Whether the poll should be sent already closed.').optional(),
  disableNotification: z.boolean().describe('Whether to send the poll silently.').optional(),
  replyToMessageId: z.int().min(1).describe('The message ID to reply to.').optional(),
  replyMarkup: z.union([z.string().min(1).describe('A JSON-serialized object string.'), z.looseObject({}).describe('A Telegram reply markup object.')]).describe('A Telegram reply markup object or JSON object string.').optional(),
}).describe('Action input.')

export const sendPollOutput = z.looseObject({}).describe('A normalized Telegram message record.')

export const getChatInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
}).describe('Action input.')

export const getChatOutput = z.looseObject({}).describe('A Telegram chat record.')

export const getChatMemberInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  userId: z.int().describe('The user ID of the chat member to fetch.'),
}).describe('Action input.')

export const getChatMemberOutput = z.looseObject({}).describe('A Telegram chat member record.')

export const getChatAdministratorsInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
}).describe('Action input.')

export const getChatAdministratorsOutput = z.strictObject({
  administrators: z.array(z.looseObject({}).describe('A Telegram chat member record.')).describe('The administrators visible to the bot in the chat.'),
}).describe('Action output.')

export const getChatMembersCountInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
}).describe('Action input.')

export const getChatMembersCountOutput = z.strictObject({
  memberCount: z.int().describe('The number of members currently in the chat.'),
}).describe('Action output.')

export const banChatMemberInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  userId: z.int().describe('The target user identifier.'),
  untilDate: z.int().describe('The Unix timestamp when the ban ends.').optional(),
  revokeMessages: z.boolean().describe('Whether to delete all messages from the banned user.').optional(),
}).describe('Action input.')

export const banChatMemberOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const unbanChatMemberInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  userId: z.int().describe('The target user identifier.'),
  onlyIfBanned: z.boolean().describe('Whether to do nothing when the user is not currently banned.').optional(),
}).describe('Action input.')

export const unbanChatMemberOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const restrictChatMemberInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  userId: z.int().describe('The target user identifier.'),
  permissions: z.strictObject({
    canSendMessages: z.boolean().describe('Whether users may send text messages, contacts, giveaways, and locations.').optional(),
    canSendAudios: z.boolean().describe('Whether users may send audio files.').optional(),
    canSendDocuments: z.boolean().describe('Whether users may send documents.').optional(),
    canSendPhotos: z.boolean().describe('Whether users may send photos.').optional(),
    canSendVideos: z.boolean().describe('Whether users may send videos.').optional(),
    canSendVideoNotes: z.boolean().describe('Whether users may send video notes.').optional(),
    canSendVoiceNotes: z.boolean().describe('Whether users may send voice notes.').optional(),
    canSendPolls: z.boolean().describe('Whether users may send polls.').optional(),
    canSendOtherMessages: z.boolean().describe('Whether users may send animations, games, stickers, and other media.').optional(),
    canAddWebPagePreviews: z.boolean().describe('Whether users may add web page previews.').optional(),
    canChangeInfo: z.boolean().describe('Whether users may change chat information.').optional(),
    canInviteUsers: z.boolean().describe('Whether users may invite new users.').optional(),
    canPinMessages: z.boolean().describe('Whether users may pin messages.').optional(),
    canManageTopics: z.boolean().describe('Whether users may create and manage forum topics.').optional(),
  }).describe('Action input.'),
  useIndependentChatPermissions: z.boolean().describe('Whether each media permission is applied independently.').optional(),
  untilDate: z.int().describe('The Unix timestamp when the restrictions end.').optional(),
}).describe('Action input.')

export const restrictChatMemberOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const promoteChatMemberInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  userId: z.int().describe('The target user identifier.'),
  isAnonymous: z.boolean().describe('Whether the administrator is hidden.').optional(),
  canManageChat: z.boolean().describe('Whether the administrator can access general chat management features.').optional(),
  canDeleteMessages: z.boolean().describe('Whether the administrator can delete other users\' messages.').optional(),
  canManageVideoChats: z.boolean().describe('Whether the administrator can manage video chats.').optional(),
  canRestrictMembers: z.boolean().describe('Whether the administrator can restrict or ban members.').optional(),
  canPromoteMembers: z.boolean().describe('Whether the administrator can appoint other administrators.').optional(),
  canChangeInfo: z.boolean().describe('Whether the administrator can change chat information.').optional(),
  canInviteUsers: z.boolean().describe('Whether the administrator can invite users.').optional(),
  canPostStories: z.boolean().describe('Whether the administrator can post stories.').optional(),
  canEditStories: z.boolean().describe('Whether the administrator can edit stories.').optional(),
  canDeleteStories: z.boolean().describe('Whether the administrator can delete stories.').optional(),
  canPostMessages: z.boolean().describe('Whether the administrator can post channel messages.').optional(),
  canEditMessages: z.boolean().describe('Whether the administrator can edit channel messages.').optional(),
  canPinMessages: z.boolean().describe('Whether the administrator can pin messages.').optional(),
  canManageTopics: z.boolean().describe('Whether the administrator can manage forum topics.').optional(),
  canManageDirectMessages: z.boolean().describe('Whether the administrator can manage channel direct messages.').optional(),
  canManageTags: z.boolean().describe('Whether the administrator can manage member tags.').optional(),
}).describe('Action input.')

export const promoteChatMemberOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const setChatPermissionsInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  permissions: z.strictObject({
    canSendMessages: z.boolean().describe('Whether users may send text messages, contacts, giveaways, and locations.').optional(),
    canSendAudios: z.boolean().describe('Whether users may send audio files.').optional(),
    canSendDocuments: z.boolean().describe('Whether users may send documents.').optional(),
    canSendPhotos: z.boolean().describe('Whether users may send photos.').optional(),
    canSendVideos: z.boolean().describe('Whether users may send videos.').optional(),
    canSendVideoNotes: z.boolean().describe('Whether users may send video notes.').optional(),
    canSendVoiceNotes: z.boolean().describe('Whether users may send voice notes.').optional(),
    canSendPolls: z.boolean().describe('Whether users may send polls.').optional(),
    canSendOtherMessages: z.boolean().describe('Whether users may send animations, games, stickers, and other media.').optional(),
    canAddWebPagePreviews: z.boolean().describe('Whether users may add web page previews.').optional(),
    canChangeInfo: z.boolean().describe('Whether users may change chat information.').optional(),
    canInviteUsers: z.boolean().describe('Whether users may invite new users.').optional(),
    canPinMessages: z.boolean().describe('Whether users may pin messages.').optional(),
    canManageTopics: z.boolean().describe('Whether users may create and manage forum topics.').optional(),
  }).describe('Action input.'),
  useIndependentChatPermissions: z.boolean().describe('Whether each media permission is applied independently.').optional(),
}).describe('Action input.')

export const setChatPermissionsOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const pinChatMessageInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  messageId: z.int().min(1).describe('A Telegram message identifier.'),
  businessConnectionId: z.string().min(1).describe('The unique identifier of the Telegram business connection.').optional(),
  disableNotification: z.boolean().describe('Whether to suppress the pin notification.').optional(),
}).describe('Action input.')

export const pinChatMessageOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const unpinChatMessageInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  messageId: z.int().min(1).describe('A Telegram message identifier.').optional(),
  businessConnectionId: z.string().min(1).describe('The unique identifier of the Telegram business connection.').optional(),
}).describe('Action input.')

export const unpinChatMessageOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const unpinAllChatMessagesInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
}).describe('Action input.')

export const unpinAllChatMessagesOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const approveChatJoinRequestInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  userId: z.int().describe('The user identifier from the join request.'),
}).describe('Action input.')

export const approveChatJoinRequestOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const declineChatJoinRequestInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  userId: z.int().describe('The user identifier from the join request.'),
}).describe('Action input.')

export const declineChatJoinRequestOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const deleteMessageInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  messageId: z.int().min(1).describe('The message ID to delete.'),
}).describe('Action input.')

export const deleteMessageOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const forwardMessageInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  fromChatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  messageId: z.int().min(1).describe('The source message ID to forward.'),
  disableNotification: z.boolean().describe('Whether to forward the message silently.').optional(),
}).describe('Action input.')

export const forwardMessageOutput = z.looseObject({}).describe('A normalized Telegram message record.')

export const sendLocationInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  latitude: z.number().min(-90).max(90).describe('The latitude of the location.'),
  longitude: z.number().min(-180).max(180).describe('The longitude of the location.'),
  horizontalAccuracy: z.number().min(0).max(1500).describe('The radius of uncertainty for the location, in meters.').optional(),
  livePeriod: z.int().min(60).max(86400).describe('The live location update period in seconds.').optional(),
  heading: z.int().min(1).max(360).describe('The direction in which the user is moving, in degrees.').optional(),
  proximityAlertRadius: z.int().min(1).max(100000).describe('The distance in meters for proximity alerts.').optional(),
  disableNotification: z.boolean().describe('Whether to send the location silently.').optional(),
  replyToMessageId: z.int().min(1).describe('The message ID to reply to.').optional(),
  replyMarkup: z.union([z.string().min(1).describe('A JSON-serialized object string.'), z.looseObject({}).describe('A Telegram reply markup object.')]).describe('A Telegram reply markup object or JSON object string.').optional(),
}).describe('Action input.')

export const sendLocationOutput = z.looseObject({}).describe('A normalized Telegram message record.')

export const exportChatInviteLinkInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
}).describe('Action input.')

export const exportChatInviteLinkOutput = z.strictObject({
  inviteLink: z.string().describe('The exported invite link for the chat.'),
}).describe('Action output.')

export const createChatInviteLinkInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  name: z.string().max(32).describe('The invite link name.').optional(),
  expireDate: z.int().describe('The Unix timestamp when the link expires.').optional(),
  memberLimit: z.int().min(1).max(99999).describe('The maximum number of simultaneous members using the link.').optional(),
  createsJoinRequest: z.boolean().describe('Whether users joining through the link require administrator approval.').optional(),
}).describe('Action input.')

export const createChatInviteLinkOutput = z.looseObject({}).describe('A Telegram chat invite link record.')

export const editChatInviteLinkInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  inviteLink: z.string().min(1).describe('The invite link to edit.'),
  name: z.string().max(32).describe('The invite link name.').optional(),
  expireDate: z.int().describe('The Unix timestamp when the link expires.').optional(),
  memberLimit: z.int().min(1).max(99999).describe('The maximum number of simultaneous members using the link.').optional(),
  createsJoinRequest: z.boolean().describe('Whether users joining through the link require administrator approval.').optional(),
}).describe('Action input.')

export const editChatInviteLinkOutput = z.looseObject({}).describe('A Telegram chat invite link record.')

export const revokeChatInviteLinkInput = z.strictObject({
  chatId: z.union([z.int().describe('A numeric Telegram chat identifier.'), z.string().regex(new RegExp('^-?\\d+$')).describe('A numeric Telegram chat identifier encoded as a string.'), z.string().regex(new RegExp('^@[A-Za-z0-9_]+$')).describe('A Telegram @username for a public chat or channel.')]).describe('The target Telegram chat ID or channel username.'),
  inviteLink: z.string().min(1).describe('The invite link to revoke.'),
}).describe('Action input.')

export const revokeChatInviteLinkOutput = z.looseObject({}).describe('A Telegram chat invite link record.')

export const answerCallbackQueryInput = z.strictObject({
  callbackQueryId: z.string().min(1).describe('The callback query ID to answer.'),
  text: z.string().max(200).describe('The notification text to show to the user.').optional(),
  showAlert: z.boolean().describe('Whether to show an alert instead of a notification.').optional(),
  url: z.url().describe('The URL to open for the callback query.').optional(),
  cacheTime: z.int().min(0).describe('The maximum time in seconds that the result may be cached client-side.').optional(),
}).describe('Action input.')

export const answerCallbackQueryOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const setMyCommandsInput = z.strictObject({
  commands: z.array(z.strictObject({
    command: z.string().regex(new RegExp('^[a-z0-9_]+$')).describe('The command text without the leading slash.').optional(),
    description: z.string().min(1).max(256).describe('The description shown for the bot command.').optional(),
  })).min(1).max(100).describe('The bot commands to register.'),
  scope: z.union([z.string().min(1).describe('A JSON-serialized object string.'), z.looseObject({}).describe('A Telegram reply markup object.')]).describe('A Telegram reply markup object or JSON object string.').optional(),
  languageCode: z.string().min(2).max(35).describe('The language code for localized commands.').optional(),
}).describe('Action input.')

export const setMyCommandsOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const setWebhookInput = z.strictObject({
  url: z.url().describe('The HTTPS webhook URL that Telegram should deliver updates to.'),
  secretToken: z.string().min(1).max(256).describe('The secret token Telegram should include in webhook requests.').optional(),
  maxConnections: z.int().min(1).max(100).describe('The maximum number of concurrent webhook connections.').optional(),
  allowedUpdates: z.array(z.string().min(1)).describe('The update types that should be delivered to the webhook.').optional(),
  dropPendingUpdates: z.boolean().describe('Whether to drop all pending updates before setting the webhook.').optional(),
}).describe('Action input.')

export const setWebhookOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

export const deleteWebhookInput = z.strictObject({
  dropPendingUpdates: z.boolean().describe('Whether to drop all pending updates when deleting the webhook.').optional(),
}).describe('Action input.')

export const deleteWebhookOutput = z.strictObject({
  success: z.literal(true).describe('Whether the Telegram Bot API request succeeded.'),
}).describe('A success response payload.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const telegramActions = {
  get_me: {
    description: 'Validate the bot token and return the bot profile from Telegram Bot API.',
    effect: 'read',
    inputSchema: getMeInput,
    outputSchema: z.toJSONSchema(getMeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_webhook_info: {
    description: 'Return the webhook status configured for the bot.',
    effect: 'read',
    inputSchema: getWebhookInfoInput,
    outputSchema: z.toJSONSchema(getWebhookInfoOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_updates: {
    description: 'Poll pending updates for the bot. Use this only when webhook delivery is disabled or for debugging.',
    effect: 'read',
    inputSchema: getUpdatesInput,
    outputSchema: z.toJSONSchema(getUpdatesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_message: {
    description: 'Send a text message to a chat, group, supergroup, channel, or forum topic.',
    effect: 'write',
    inputSchema: sendMessageInput,
    outputSchema: z.toJSONSchema(sendMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  copy_message: {
    description: 'Copy one message without linking back to the original message.',
    effect: 'write',
    inputSchema: copyMessageInput,
    outputSchema: z.toJSONSchema(copyMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  copy_messages: {
    description: 'Copy 1-100 messages without links to the originals while preserving album grouping.',
    effect: 'write',
    inputSchema: copyMessagesInput,
    outputSchema: z.toJSONSchema(copyMessagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  forward_messages: {
    description: 'Forward 1-100 messages while preserving links and album grouping.',
    effect: 'write',
    inputSchema: forwardMessagesInput,
    outputSchema: z.toJSONSchema(forwardMessagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_messages: {
    description: 'Delete 1-100 messages from one Telegram chat.',
    effect: 'destructive',
    inputSchema: deleteMessagesInput,
    outputSchema: z.toJSONSchema(deleteMessagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  set_message_reaction: {
    description: 'Replace the bot\'s chosen reaction on a Telegram message.',
    effect: 'write',
    inputSchema: setMessageReactionInput,
    outputSchema: z.toJSONSchema(setMessageReactionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_chat_action: {
    description: 'Show a temporary typing, upload, recording, or location activity status in a chat.',
    effect: 'write',
    inputSchema: sendChatActionInput,
    outputSchema: z.toJSONSchema(sendChatActionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_video: {
    description: 'Send an MPEG-4 video by URL or Telegram file_id.',
    effect: 'write',
    inputSchema: sendVideoInput,
    outputSchema: z.toJSONSchema(sendVideoOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_audio: {
    description: 'Send an MP3 or M4A audio track by URL or Telegram file_id.',
    effect: 'write',
    inputSchema: sendAudioInput,
    outputSchema: z.toJSONSchema(sendAudioOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_voice: {
    description: 'Send a playable voice message by URL or Telegram file_id.',
    effect: 'write',
    inputSchema: sendVoiceInput,
    outputSchema: z.toJSONSchema(sendVoiceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_animation: {
    description: 'Send a GIF or silent MPEG-4 animation by URL or Telegram file_id.',
    effect: 'write',
    inputSchema: sendAnimationInput,
    outputSchema: z.toJSONSchema(sendAnimationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_media_group: {
    description: 'Send an album containing 2-10 photos, videos, documents, or audio items.',
    effect: 'write',
    inputSchema: sendMediaGroupInput,
    outputSchema: z.toJSONSchema(sendMediaGroupOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_contact: {
    description: 'Send a phone contact to a Telegram chat.',
    effect: 'write',
    inputSchema: sendContactInput,
    outputSchema: z.toJSONSchema(sendContactOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_venue: {
    description: 'Send a venue with coordinates, title, address, and optional place identifiers.',
    effect: 'write',
    inputSchema: sendVenueInput,
    outputSchema: z.toJSONSchema(sendVenueOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_dice: {
    description: 'Send an animated dice, darts, basketball, football, bowling, or slot-machine emoji.',
    effect: 'write',
    inputSchema: sendDiceInput,
    outputSchema: z.toJSONSchema(sendDiceOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_business_connection: {
    description: 'Return the current state and granted rights of a Telegram business connection.',
    effect: 'read',
    inputSchema: getBusinessConnectionInput,
    outputSchema: z.toJSONSchema(getBusinessConnectionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  read_business_message: {
    description: 'Mark an incoming message as read on behalf of a connected Telegram business account.',
    effect: 'read',
    inputSchema: readBusinessMessageInput,
    outputSchema: z.toJSONSchema(readBusinessMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_business_messages: {
    description: 'Delete one or more messages on behalf of a connected Telegram business account.',
    effect: 'destructive',
    inputSchema: deleteBusinessMessagesInput,
    outputSchema: z.toJSONSchema(deleteBusinessMessagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  edit_message_text: {
    description: 'Edit the text of a previously sent message or an inline message.',
    effect: 'write',
    inputSchema: editMessageTextInput,
    outputSchema: z.toJSONSchema(editMessageTextOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_photo: {
    description: 'Send a photo by public URL or existing Telegram file_id.',
    effect: 'write',
    inputSchema: sendPhotoInput,
    outputSchema: z.toJSONSchema(sendPhotoOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_document: {
    description: 'Send a document by public URL or existing Telegram file_id.',
    effect: 'write',
    inputSchema: sendDocumentInput,
    outputSchema: z.toJSONSchema(sendDocumentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_poll: {
    description: 'Send a native Telegram poll to a chat.',
    effect: 'write',
    inputSchema: sendPollInput,
    outputSchema: z.toJSONSchema(sendPollOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_chat: {
    description: 'Return metadata for a chat the bot can access.',
    effect: 'read',
    inputSchema: getChatInput,
    outputSchema: z.toJSONSchema(getChatOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_chat_member: {
    description: 'Return information about one chat member.',
    effect: 'read',
    inputSchema: getChatMemberInput,
    outputSchema: z.toJSONSchema(getChatMemberOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_chat_administrators: {
    description: 'Return the chat administrators visible to the bot.',
    effect: 'read',
    inputSchema: getChatAdministratorsInput,
    outputSchema: z.toJSONSchema(getChatAdministratorsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_chat_members_count: {
    description: 'Return the number of members in a chat.',
    effect: 'read',
    inputSchema: getChatMembersCountInput,
    outputSchema: z.toJSONSchema(getChatMembersCountOutput, { io: 'output', unrepresentable: 'any' }),
  },
  ban_chat_member: {
    description: 'Ban a user from a group, supergroup, or channel.',
    effect: 'write',
    inputSchema: banChatMemberInput,
    outputSchema: z.toJSONSchema(banChatMemberOutput, { io: 'output', unrepresentable: 'any' }),
  },
  unban_chat_member: {
    description: 'Unban a user so they can join the chat again.',
    effect: 'write',
    inputSchema: unbanChatMemberInput,
    outputSchema: z.toJSONSchema(unbanChatMemberOutput, { io: 'output', unrepresentable: 'any' }),
  },
  restrict_chat_member: {
    description: 'Set temporary or permanent permissions for one supergroup member.',
    effect: 'write',
    inputSchema: restrictChatMemberInput,
    outputSchema: z.toJSONSchema(restrictChatMemberOutput, { io: 'output', unrepresentable: 'any' }),
  },
  promote_chat_member: {
    description: 'Promote, update, or demote a supergroup or channel administrator.',
    effect: 'write',
    inputSchema: promoteChatMemberInput,
    outputSchema: z.toJSONSchema(promoteChatMemberOutput, { io: 'output', unrepresentable: 'any' }),
  },
  set_chat_permissions: {
    description: 'Set default permissions for all members of a group or supergroup.',
    effect: 'write',
    inputSchema: setChatPermissionsInput,
    outputSchema: z.toJSONSchema(setChatPermissionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  pin_chat_message: {
    description: 'Pin a message in a Telegram chat.',
    effect: 'write',
    inputSchema: pinChatMessageInput,
    outputSchema: z.toJSONSchema(pinChatMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  unpin_chat_message: {
    description: 'Unpin one message, or the most recently pinned message, from a Telegram chat.',
    effect: 'write',
    inputSchema: unpinChatMessageInput,
    outputSchema: z.toJSONSchema(unpinChatMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  unpin_all_chat_messages: {
    description: 'Remove all pinned messages from a Telegram chat.',
    effect: 'write',
    inputSchema: unpinAllChatMessagesInput,
    outputSchema: z.toJSONSchema(unpinAllChatMessagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  approve_chat_join_request: {
    description: 'Approve a user\'s pending request to join a Telegram chat.',
    effect: 'write',
    inputSchema: approveChatJoinRequestInput,
    outputSchema: z.toJSONSchema(approveChatJoinRequestOutput, { io: 'output', unrepresentable: 'any' }),
  },
  decline_chat_join_request: {
    description: 'Decline a user\'s pending request to join a Telegram chat.',
    effect: 'write',
    inputSchema: declineChatJoinRequestInput,
    outputSchema: z.toJSONSchema(declineChatJoinRequestOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_message: {
    description: 'Delete a message from a chat.',
    effect: 'destructive',
    inputSchema: deleteMessageInput,
    outputSchema: z.toJSONSchema(deleteMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  forward_message: {
    description: 'Forward a message from one chat to another.',
    effect: 'write',
    inputSchema: forwardMessageInput,
    outputSchema: z.toJSONSchema(forwardMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_location: {
    description: 'Send a map location to a chat.',
    effect: 'write',
    inputSchema: sendLocationInput,
    outputSchema: z.toJSONSchema(sendLocationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  export_chat_invite_link: {
    description: 'Export the primary invite link for a Telegram chat.',
    effect: 'read',
    inputSchema: exportChatInviteLinkInput,
    outputSchema: z.toJSONSchema(exportChatInviteLinkOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_chat_invite_link: {
    description: 'Create an additional Telegram chat invite link with optional expiry or approval rules.',
    effect: 'write',
    inputSchema: createChatInviteLinkInput,
    outputSchema: z.toJSONSchema(createChatInviteLinkOutput, { io: 'output', unrepresentable: 'any' }),
  },
  edit_chat_invite_link: {
    description: 'Edit an additional Telegram chat invite link created by the bot.',
    effect: 'write',
    inputSchema: editChatInviteLinkInput,
    outputSchema: z.toJSONSchema(editChatInviteLinkOutput, { io: 'output', unrepresentable: 'any' }),
  },
  revoke_chat_invite_link: {
    description: 'Revoke a Telegram chat invite link created by the bot.',
    effect: 'destructive',
    inputSchema: revokeChatInviteLinkInput,
    outputSchema: z.toJSONSchema(revokeChatInviteLinkOutput, { io: 'output', unrepresentable: 'any' }),
  },
  answer_callback_query: {
    description: 'Answer an inline keyboard callback query.',
    effect: 'write',
    inputSchema: answerCallbackQueryInput,
    outputSchema: z.toJSONSchema(answerCallbackQueryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  set_my_commands: {
    description: 'Set the bot command list exposed in Telegram clients.',
    effect: 'write',
    inputSchema: setMyCommandsInput,
    outputSchema: z.toJSONSchema(setMyCommandsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  set_webhook: {
    description: 'Configure a webhook endpoint for update delivery.',
    effect: 'write',
    inputSchema: setWebhookInput,
    outputSchema: z.toJSONSchema(setWebhookOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_webhook: {
    description: 'Delete the configured webhook and optionally drop pending updates.',
    effect: 'destructive',
    inputSchema: deleteWebhookInput,
    outputSchema: z.toJSONSchema(deleteWebhookOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
