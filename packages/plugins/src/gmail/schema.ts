/**
 * Gmail 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const searchThreadsInput = z.strictObject({
  query: z.string().describe('Gmail search query.'),
  maxResults: z.int().min(1).max(500).describe('Maximum number of results to return.').optional(),
}).describe('The input payload for this action.')

export const searchThreadsOutput = z.strictObject({
  threads: z.array(z.looseObject({
    threadId: z.string().min(1).describe('Gmail thread ID.'),
    historyId: z.string().describe('Mailbox history checkpoint ID.').nullable().optional(),
    snippet: z.string().describe('Thread snippet.').optional(),
    messages: z.array(z.looseObject({
      messageId: z.string().min(1).describe('Gmail message ID.'),
      threadId: z.string().min(1).describe('Gmail thread ID.'),
      labelIds: z.array(z.string().min(1)).describe('Gmail label IDs.'),
      subject: z.string().describe('Message subject.'),
      sender: z.string().describe('Message sender.'),
      to: z.string().describe('Message recipients.'),
      messageTimestamp: z.string().describe('Message timestamp.'),
      preview: z.looseObject({}).describe('Gmail API object.').optional(),
      payload: z.looseObject({}).describe('Gmail API object.').nullable().optional(),
      messageText: z.string().describe('Extracted message body text.').optional(),
      attachmentList: z.array(z.looseObject({}).describe('Gmail API object.')).describe('Message attachments.').optional(),
      raw: z.string().describe('Raw RFC 2822 message when requested.').optional(),
    }).describe('Normalized Gmail message.')).describe('Messages in the thread.').optional(),
  }).describe('Gmail thread.')).describe('Matching thread summaries.'),
}).describe('Thread search result.')

export const listThreadsInput = z.strictObject({
  query: z.string().describe('Gmail search query.').optional(),
  verbose: z.boolean().describe('Hydrate each thread.').optional(),
  maxResults: z.int().min(1).max(500).describe('Maximum number of results to return.').optional(),
  pageToken: z.string().describe('Opaque pagination token returned by Gmail.').optional(),
}).describe('The input payload for this action.')

export const listThreadsOutput = z.strictObject({
  threads: z.array(z.looseObject({
    threadId: z.string().min(1).describe('Gmail thread ID.'),
    historyId: z.string().describe('Mailbox history checkpoint ID.').nullable().optional(),
    snippet: z.string().describe('Thread snippet.').optional(),
    messages: z.array(z.looseObject({
      messageId: z.string().min(1).describe('Gmail message ID.'),
      threadId: z.string().min(1).describe('Gmail thread ID.'),
      labelIds: z.array(z.string().min(1)).describe('Gmail label IDs.'),
      subject: z.string().describe('Message subject.'),
      sender: z.string().describe('Message sender.'),
      to: z.string().describe('Message recipients.'),
      messageTimestamp: z.string().describe('Message timestamp.'),
      preview: z.looseObject({}).describe('Gmail API object.').optional(),
      payload: z.looseObject({}).describe('Gmail API object.').nullable().optional(),
      messageText: z.string().describe('Extracted message body text.').optional(),
      attachmentList: z.array(z.looseObject({}).describe('Gmail API object.')).describe('Message attachments.').optional(),
      raw: z.string().describe('Raw RFC 2822 message when requested.').optional(),
    }).describe('Normalized Gmail message.')).describe('Messages in the thread.').optional(),
  }).describe('Gmail thread.')).describe('Returned threads.'),
  nextPageToken: z.string().describe('Opaque pagination token returned by Gmail.').nullable().optional(),
  resultSizeEstimate: z.int().describe('Approximate result count.').optional(),
}).describe('Thread list result.')

export const fetchEmailsInput = z.strictObject({
  query: z.string().describe('Gmail search query.').optional(),
  labelIds: z.array(z.string().min(1)).describe('Gmail label IDs.').optional(),
  includeSpamTrash: z.boolean().describe('Whether to include Spam and Trash.').optional(),
  detail: z.enum(['ids', 'summary', 'full']).default('summary').describe('Message detail level.').optional(),
  maxResults: z.int().min(1).max(500).describe('Maximum number of results to return.').optional(),
  pageToken: z.string().describe('Opaque pagination token returned by Gmail.').optional(),
}).describe('The input payload for this action.')

export const fetchEmailsOutput = z.strictObject({
  messages: z.array(z.union([z.looseObject({
    messageId: z.string().min(1).describe('Gmail message ID.'),
    threadId: z.string().min(1).describe('Gmail thread ID.'),
    labelIds: z.array(z.string().min(1)).describe('Gmail label IDs.'),
    subject: z.string().describe('Message subject.'),
    sender: z.string().describe('Message sender.'),
    to: z.string().describe('Message recipients.'),
    messageTimestamp: z.string().describe('Message timestamp.'),
  }).describe('Normalized Gmail message summary.'), z.looseObject({
    messageId: z.string().min(1).describe('Gmail message ID.'),
    threadId: z.string().min(1).describe('Gmail thread ID.'),
    labelIds: z.array(z.string().min(1)).describe('Gmail label IDs.'),
    subject: z.string().describe('Message subject.'),
    sender: z.string().describe('Message sender.'),
    to: z.string().describe('Message recipients.'),
    messageTimestamp: z.string().describe('Message timestamp.'),
    preview: z.looseObject({}).describe('Gmail API object.').optional(),
    payload: z.looseObject({}).describe('Gmail API object.').nullable().optional(),
    messageText: z.string().describe('Extracted message body text.').optional(),
    attachmentList: z.array(z.looseObject({}).describe('Gmail API object.')).describe('Message attachments.').optional(),
    raw: z.string().describe('Raw RFC 2822 message when requested.').optional(),
  }).describe('Normalized Gmail message.'), z.looseObject({}).describe('Gmail API object.')])).describe('Returned messages.'),
  nextPageToken: z.string().describe('Opaque pagination token returned by Gmail.').nullable().optional(),
  resultSizeEstimate: z.int().describe('Approximate result count.').optional(),
}).describe('Message list result.')

export const getMessageInput = z.strictObject({
  messageId: z.string().min(1).describe('Gmail message ID.'),
}).describe('The input payload for this action.')

export const getMessageOutput = z.strictObject({
  messageId: z.string().min(1).describe('Gmail message ID.'),
  threadId: z.string().min(1).describe('Gmail thread ID.'),
  subject: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  date: z.string().optional(),
  body: z.string().optional(),
}).describe('Simplified Gmail message.')

export const fetchMessageByMessageIdInput = z.strictObject({
  messageId: z.string().min(1).describe('Gmail message ID.'),
  format: z.enum(['minimal', 'full', 'raw', 'metadata']).describe('Gmail response format to request.').optional(),
}).describe('The input payload for this action.')

export const fetchMessageByMessageIdOutput = z.looseObject({
  messageId: z.string().min(1).describe('Gmail message ID.'),
  threadId: z.string().min(1).describe('Gmail thread ID.'),
  labelIds: z.array(z.string().min(1)).describe('Gmail label IDs.'),
  subject: z.string().describe('Message subject.'),
  sender: z.string().describe('Message sender.'),
  to: z.string().describe('Message recipients.'),
  messageTimestamp: z.string().describe('Message timestamp.'),
  preview: z.looseObject({}).describe('Gmail API object.').optional(),
  payload: z.looseObject({}).describe('Gmail API object.').nullable().optional(),
  messageText: z.string().describe('Extracted message body text.').optional(),
  attachmentList: z.array(z.looseObject({}).describe('Gmail API object.')).describe('Message attachments.').optional(),
  raw: z.string().describe('Raw RFC 2822 message when requested.').optional(),
}).describe('Normalized Gmail message.')

export const fetchMessageByThreadIdInput = z.strictObject({
  threadId: z.string().min(1).describe('Gmail thread ID.'),
}).describe('The input payload for this action.')

export const fetchMessageByThreadIdOutput = z.looseObject({
  threadId: z.string().min(1).describe('Gmail thread ID.'),
  historyId: z.string().describe('Mailbox history checkpoint ID.').nullable().optional(),
  snippet: z.string().describe('Thread snippet.').optional(),
  messages: z.array(z.looseObject({
    messageId: z.string().min(1).describe('Gmail message ID.'),
    threadId: z.string().min(1).describe('Gmail thread ID.'),
    labelIds: z.array(z.string().min(1)).describe('Gmail label IDs.'),
    subject: z.string().describe('Message subject.'),
    sender: z.string().describe('Message sender.'),
    to: z.string().describe('Message recipients.'),
    messageTimestamp: z.string().describe('Message timestamp.'),
    preview: z.looseObject({}).describe('Gmail API object.').optional(),
    payload: z.looseObject({}).describe('Gmail API object.').nullable().optional(),
    messageText: z.string().describe('Extracted message body text.').optional(),
    attachmentList: z.array(z.looseObject({}).describe('Gmail API object.')).describe('Message attachments.').optional(),
    raw: z.string().describe('Raw RFC 2822 message when requested.').optional(),
  }).describe('Normalized Gmail message.')).describe('Messages in the thread.').optional(),
}).describe('Gmail thread.')

export const getProfileInput = z.strictObject({
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const getProfileOutput = z.strictObject({
  emailAddress: z.string(),
  messagesTotal: z.int(),
  threadsTotal: z.int(),
  historyId: z.string(),
}).describe('Gmail profile.')

export const sendEmailInput = z.strictObject({
  recipientEmail: z.string().describe('Primary recipient email address.').optional(),
  to: z.string().describe('Primary recipient email address.').optional(),
  extraRecipients: z.array(z.string()).describe('Additional To recipients.').optional(),
  cc: z.union([z.string(), z.array(z.string())]).describe('Cc recipients.').optional(),
  bcc: z.union([z.string(), z.array(z.string())]).describe('Bcc recipients.').optional(),
  subject: z.string().describe('Email subject line.').optional(),
  body: z.string().describe('Email body content.').optional(),
  messageBody: z.string().describe('Reply or draft body content.').optional(),
  isHtml: z.boolean().describe('Whether the body is HTML.').optional(),
  fromEmail: z.string().describe('Verified Gmail send-as alias.').optional(),
}).describe('The input payload for this action.')

export const sendEmailOutput = z.strictObject({
  messageId: z.string().min(1).describe('Gmail message ID.'),
}).describe('Sent message result.')

export const replyEmailInput = z.strictObject({
  threadId: z.string().min(1).describe('Gmail thread ID.'),
  messageId: z.string().min(1).describe('Gmail message ID.'),
  body: z.string().describe('Reply body.'),
}).describe('The input payload for this action.')

export const replyEmailOutput = z.strictObject({
  messageId: z.string().min(1).describe('Gmail message ID.'),
}).describe('Reply result.')

export const replyToThreadInput = z.strictObject({
  threadId: z.string().min(1).describe('Gmail thread ID.'),
  recipientEmail: z.string().describe('Primary recipient email address.').optional(),
  to: z.string().describe('Primary recipient email address.').optional(),
  extraRecipients: z.array(z.string()).describe('Additional To recipients.').optional(),
  cc: z.union([z.string(), z.array(z.string())]).describe('Cc recipients.').optional(),
  bcc: z.union([z.string(), z.array(z.string())]).describe('Bcc recipients.').optional(),
  subject: z.string().describe('Email subject line.').optional(),
  body: z.string().describe('Email body content.').optional(),
  messageBody: z.string().describe('Reply or draft body content.').optional(),
  isHtml: z.boolean().describe('Whether the body is HTML.').optional(),
  fromEmail: z.string().describe('Verified Gmail send-as alias.').optional(),
}).describe('The input payload for this action.')

export const replyToThreadOutput = z.strictObject({
  messageId: z.string().min(1).describe('Gmail message ID.'),
  threadId: z.string().min(1).describe('Gmail thread ID.').optional(),
}).describe('Thread reply result.')

export const createDraftInput = z.strictObject({
  to: z.string(),
  subject: z.string(),
  body: z.string(),
  cc: z.union([z.string(), z.array(z.string())]).optional(),
}).describe('The input payload for this action.')

export const createDraftOutput = z.strictObject({
  draftId: z.string().min(1).describe('Gmail draft ID.'),
}).describe('Created draft result.')

export const createEmailDraftInput = z.strictObject({
  recipientEmail: z.string().describe('Primary recipient email address.').optional(),
  to: z.string().describe('Primary recipient email address.').optional(),
  extraRecipients: z.array(z.string()).describe('Additional To recipients.').optional(),
  cc: z.union([z.string(), z.array(z.string())]).describe('Cc recipients.').optional(),
  bcc: z.union([z.string(), z.array(z.string())]).describe('Bcc recipients.').optional(),
  subject: z.string().describe('Email subject line.').optional(),
  body: z.string().describe('Email body content.').optional(),
  messageBody: z.string().describe('Reply or draft body content.').optional(),
  isHtml: z.boolean().describe('Whether the body is HTML.').optional(),
  fromEmail: z.string().describe('Verified Gmail send-as alias.').optional(),
  threadId: z.string().min(1).describe('Gmail thread ID.').optional(),
}).describe('The input payload for this action.')

export const createEmailDraftOutput = z.strictObject({
  draftId: z.string().min(1).describe('Gmail draft ID.'),
  messageId: z.string().min(1).describe('Gmail message ID.').optional(),
  threadId: z.string().min(1).describe('Gmail thread ID.').optional(),
}).describe('Created draft.')

export const listDraftsInput = z.strictObject({
  verbose: z.boolean().describe('Hydrate each draft.').optional(),
  maxResults: z.int().min(1).max(500).describe('Maximum number of results to return.').optional(),
  pageToken: z.string().describe('Opaque pagination token returned by Gmail.').optional(),
}).describe('The input payload for this action.')

export const listDraftsOutput = z.strictObject({
  drafts: z.array(z.looseObject({
    id: z.string().min(1).describe('Gmail draft ID.'),
    message: z.looseObject({
      messageId: z.string().min(1).describe('Gmail message ID.'),
      threadId: z.string().min(1).describe('Gmail thread ID.'),
      labelIds: z.array(z.string().min(1)).describe('Gmail label IDs.'),
      subject: z.string().describe('Message subject.'),
      sender: z.string().describe('Message sender.'),
      to: z.string().describe('Message recipients.'),
      messageTimestamp: z.string().describe('Message timestamp.'),
      preview: z.looseObject({}).describe('Gmail API object.').optional(),
      payload: z.looseObject({}).describe('Gmail API object.').nullable().optional(),
      messageText: z.string().describe('Extracted message body text.').optional(),
      attachmentList: z.array(z.looseObject({}).describe('Gmail API object.')).describe('Message attachments.').optional(),
      raw: z.string().describe('Raw RFC 2822 message when requested.').optional(),
    }).describe('Normalized Gmail message.'),
  }).describe('Gmail draft.')),
  nextPageToken: z.string().describe('Opaque pagination token returned by Gmail.').nullable().optional(),
}).describe('Draft list result.')

export const getDraftInput = z.strictObject({
  draftId: z.string().min(1).describe('Gmail draft ID.'),
  format: z.enum(['minimal', 'full', 'raw', 'metadata']).describe('Gmail response format to request.').optional(),
}).describe('The input payload for this action.')

export const getDraftOutput = z.looseObject({
  id: z.string().min(1).describe('Gmail draft ID.'),
  message: z.looseObject({
    messageId: z.string().min(1).describe('Gmail message ID.'),
    threadId: z.string().min(1).describe('Gmail thread ID.'),
    labelIds: z.array(z.string().min(1)).describe('Gmail label IDs.'),
    subject: z.string().describe('Message subject.'),
    sender: z.string().describe('Message sender.'),
    to: z.string().describe('Message recipients.'),
    messageTimestamp: z.string().describe('Message timestamp.'),
    preview: z.looseObject({}).describe('Gmail API object.').optional(),
    payload: z.looseObject({}).describe('Gmail API object.').nullable().optional(),
    messageText: z.string().describe('Extracted message body text.').optional(),
    attachmentList: z.array(z.looseObject({}).describe('Gmail API object.')).describe('Message attachments.').optional(),
    raw: z.string().describe('Raw RFC 2822 message when requested.').optional(),
  }).describe('Normalized Gmail message.'),
}).describe('Gmail draft.')

export const updateDraftInput = z.strictObject({
  draftId: z.string().min(1).describe('Gmail draft ID.'),
  recipientEmail: z.string().describe('Primary recipient email address.').optional(),
  to: z.string().describe('Primary recipient email address.').optional(),
  extraRecipients: z.array(z.string()).describe('Additional To recipients.').optional(),
  cc: z.union([z.string(), z.array(z.string())]).describe('Cc recipients.').optional(),
  bcc: z.union([z.string(), z.array(z.string())]).describe('Bcc recipients.').optional(),
  subject: z.string().describe('Email subject line.').optional(),
  body: z.string().describe('Email body content.').optional(),
  messageBody: z.string().describe('Reply or draft body content.').optional(),
  isHtml: z.boolean().describe('Whether the body is HTML.').optional(),
  fromEmail: z.string().describe('Verified Gmail send-as alias.').optional(),
  threadId: z.string().min(1).describe('Gmail thread ID.').optional(),
}).describe('The input payload for this action.')

export const updateDraftOutput = z.strictObject({
  draftId: z.string().min(1).describe('Gmail draft ID.'),
  messageId: z.string().min(1).describe('Gmail message ID.').optional(),
  threadId: z.string().min(1).describe('Gmail thread ID.').optional(),
}).describe('Updated draft.')

export const sendDraftInput = z.strictObject({
  draftId: z.string().min(1).describe('Gmail draft ID.'),
}).describe('The input payload for this action.')

export const sendDraftOutput = z.strictObject({
  messageId: z.string().min(1).describe('Gmail message ID.'),
  threadId: z.string().min(1).describe('Gmail thread ID.').nullable().optional(),
}).describe('Sent draft result.')

export const deleteDraftInput = z.strictObject({
  draftId: z.string().min(1).describe('Gmail draft ID.'),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const deleteDraftOutput = z.strictObject({
  success: z.boolean().describe('Whether the operation completed successfully.'),
}).describe('Operation result.')

export const listLabelsInput = z.strictObject({
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const listLabelsOutput = z.strictObject({
  labels: z.array(z.looseObject({
    id: z.string().min(1).describe('Gmail label ID.'),
    name: z.string().describe('Label display name.'),
    type: z.string().describe('Label type.'),
    messageListVisibility: z.enum(['show', 'hide']).describe('Whether messages with this label appear in the message list.').optional(),
    labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).describe('Whether the label appears in the label list.').optional(),
    color: z.strictObject({
      textColor: z.string().describe('Hex text color.').optional(),
      backgroundColor: z.string().describe('Hex background color.').optional(),
    }).describe('Gmail label color.').optional(),
  }).describe('Gmail label.')),
}).describe('Label list.')

export const getLabelInput = z.strictObject({
  labelId: z.string().min(1).describe('Gmail label ID.'),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const getLabelOutput = z.looseObject({
  id: z.string().min(1).describe('Gmail label ID.'),
  name: z.string().describe('Label display name.'),
  type: z.string().describe('Label type.'),
  messageListVisibility: z.enum(['show', 'hide']).describe('Whether messages with this label appear in the message list.').optional(),
  labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).describe('Whether the label appears in the label list.').optional(),
  color: z.strictObject({
    textColor: z.string().describe('Hex text color.').optional(),
    backgroundColor: z.string().describe('Hex background color.').optional(),
  }).describe('Gmail label color.').optional(),
}).describe('Gmail label.')

export const createLabelInput = z.strictObject({
  name: z.string().min(1).describe('Display name for the new label.'),
  labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).optional(),
  messageListVisibility: z.enum(['show', 'hide']).optional(),
  color: z.strictObject({
    textColor: z.string().describe('Hex text color.').optional(),
    backgroundColor: z.string().describe('Hex background color.').optional(),
  }).describe('Gmail label color.').optional(),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const createLabelOutput = z.looseObject({
  id: z.string().min(1).describe('Gmail label ID.'),
  name: z.string().describe('Label display name.'),
  type: z.string().describe('Label type.'),
  messageListVisibility: z.enum(['show', 'hide']).describe('Whether messages with this label appear in the message list.').optional(),
  labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).describe('Whether the label appears in the label list.').optional(),
  color: z.strictObject({
    textColor: z.string().describe('Hex text color.').optional(),
    backgroundColor: z.string().describe('Hex background color.').optional(),
  }).describe('Gmail label color.').optional(),
}).describe('Gmail label.')

export const patchLabelInput = z.strictObject({
  labelId: z.string().min(1).describe('Gmail label ID.'),
  name: z.string().describe('Updated display name for the label.').optional(),
  labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).optional(),
  messageListVisibility: z.enum(['show', 'hide']).optional(),
  color: z.strictObject({
    textColor: z.string().describe('Hex text color.').optional(),
    backgroundColor: z.string().describe('Hex background color.').optional(),
  }).describe('Gmail label color.').optional(),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const patchLabelOutput = z.looseObject({
  id: z.string().min(1).describe('Gmail label ID.'),
  name: z.string().describe('Label display name.'),
  type: z.string().describe('Label type.'),
  messageListVisibility: z.enum(['show', 'hide']).describe('Whether messages with this label appear in the message list.').optional(),
  labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).describe('Whether the label appears in the label list.').optional(),
  color: z.strictObject({
    textColor: z.string().describe('Hex text color.').optional(),
    backgroundColor: z.string().describe('Hex background color.').optional(),
  }).describe('Gmail label color.').optional(),
}).describe('Gmail label.')

export const updateLabelInput = z.strictObject({
  labelId: z.string().min(1).describe('Gmail label ID.'),
  name: z.string().describe('Updated display name for the label.').optional(),
  labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).optional(),
  messageListVisibility: z.enum(['show', 'hide']).optional(),
  color: z.strictObject({
    textColor: z.string().describe('Hex text color.').optional(),
    backgroundColor: z.string().describe('Hex background color.').optional(),
  }).describe('Gmail label color.').optional(),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const updateLabelOutput = z.looseObject({
  id: z.string().min(1).describe('Gmail label ID.'),
  name: z.string().describe('Label display name.'),
  type: z.string().describe('Label type.'),
  messageListVisibility: z.enum(['show', 'hide']).describe('Whether messages with this label appear in the message list.').optional(),
  labelListVisibility: z.enum(['labelShow', 'labelShowIfUnread', 'labelHide']).describe('Whether the label appears in the label list.').optional(),
  color: z.strictObject({
    textColor: z.string().describe('Hex text color.').optional(),
    backgroundColor: z.string().describe('Hex background color.').optional(),
  }).describe('Gmail label color.').optional(),
}).describe('Gmail label.')

export const deleteLabelInput = z.strictObject({
  labelId: z.string().min(1).describe('Gmail label ID.'),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const deleteLabelOutput = z.strictObject({
  success: z.boolean().describe('Whether the operation completed successfully.'),
}).describe('Operation result.')

export const addLabelToEmailInput = z.strictObject({
  messageId: z.string().min(1).describe('Gmail message ID.'),
  addLabelIds: z.array(z.string().min(1)).describe('Gmail label IDs.').optional(),
  removeLabelIds: z.array(z.string().min(1)).describe('Gmail label IDs.').optional(),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const addLabelToEmailOutput = z.looseObject({
  messageId: z.string().min(1).describe('Gmail message ID.'),
  threadId: z.string().min(1).describe('Gmail thread ID.'),
  labelIds: z.array(z.string().min(1)).describe('Gmail label IDs.'),
  subject: z.string().describe('Message subject.'),
  sender: z.string().describe('Message sender.'),
  to: z.string().describe('Message recipients.'),
  messageTimestamp: z.string().describe('Message timestamp.'),
  preview: z.looseObject({}).describe('Gmail API object.').optional(),
  payload: z.looseObject({}).describe('Gmail API object.').nullable().optional(),
  messageText: z.string().describe('Extracted message body text.').optional(),
  attachmentList: z.array(z.looseObject({}).describe('Gmail API object.')).describe('Message attachments.').optional(),
  raw: z.string().describe('Raw RFC 2822 message when requested.').optional(),
}).describe('Normalized Gmail message.')

export const batchModifyMessagesInput = z.strictObject({
  messageIds: z.array(z.string().min(1).describe('Gmail message ID.')).describe('Message IDs to modify.'),
  addLabelIds: z.array(z.string().min(1)).describe('Gmail label IDs.').optional(),
  removeLabelIds: z.array(z.string().min(1)).describe('Gmail label IDs.').optional(),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const batchModifyMessagesOutput = z.strictObject({
  success: z.boolean().describe('Whether the operation completed successfully.'),
}).describe('Operation result.')

export const moveToTrashInput = z.strictObject({
  messageId: z.string().min(1).describe('Gmail message ID.'),
  addLabelIds: z.array(z.string().min(1)).describe('Gmail label IDs.').optional(),
  removeLabelIds: z.array(z.string().min(1)).describe('Gmail label IDs.').optional(),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const moveToTrashOutput = z.looseObject({
  messageId: z.string().min(1).describe('Gmail message ID.'),
  threadId: z.string().min(1).describe('Gmail thread ID.'),
  labelIds: z.array(z.string().min(1)).describe('Gmail label IDs.'),
  subject: z.string().describe('Message subject.'),
  sender: z.string().describe('Message sender.'),
  to: z.string().describe('Message recipients.'),
  messageTimestamp: z.string().describe('Message timestamp.'),
  preview: z.looseObject({}).describe('Gmail API object.').optional(),
  payload: z.looseObject({}).describe('Gmail API object.').nullable().optional(),
  messageText: z.string().describe('Extracted message body text.').optional(),
  attachmentList: z.array(z.looseObject({}).describe('Gmail API object.')).describe('Message attachments.').optional(),
  raw: z.string().describe('Raw RFC 2822 message when requested.').optional(),
}).describe('Normalized Gmail message.')

export const untrashMessageInput = z.strictObject({
  messageId: z.string().min(1).describe('Gmail message ID.'),
  addLabelIds: z.array(z.string().min(1)).describe('Gmail label IDs.').optional(),
  removeLabelIds: z.array(z.string().min(1)).describe('Gmail label IDs.').optional(),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const untrashMessageOutput = z.looseObject({
  messageId: z.string().min(1).describe('Gmail message ID.'),
  threadId: z.string().min(1).describe('Gmail thread ID.'),
  labelIds: z.array(z.string().min(1)).describe('Gmail label IDs.'),
  subject: z.string().describe('Message subject.'),
  sender: z.string().describe('Message sender.'),
  to: z.string().describe('Message recipients.'),
  messageTimestamp: z.string().describe('Message timestamp.'),
  preview: z.looseObject({}).describe('Gmail API object.').optional(),
  payload: z.looseObject({}).describe('Gmail API object.').nullable().optional(),
  messageText: z.string().describe('Extracted message body text.').optional(),
  attachmentList: z.array(z.looseObject({}).describe('Gmail API object.')).describe('Message attachments.').optional(),
  raw: z.string().describe('Raw RFC 2822 message when requested.').optional(),
}).describe('Normalized Gmail message.')

export const modifyThreadLabelsInput = z.strictObject({
  threadId: z.string().min(1).describe('Gmail thread ID.'),
  addLabelIds: z.array(z.string().min(1)).describe('Gmail label IDs.').optional(),
  removeLabelIds: z.array(z.string().min(1)).describe('Gmail label IDs.').optional(),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const modifyThreadLabelsOutput = z.looseObject({
  threadId: z.string().min(1).describe('Gmail thread ID.'),
  historyId: z.string().describe('Mailbox history checkpoint ID.').nullable().optional(),
  snippet: z.string().describe('Thread snippet.').optional(),
  messages: z.array(z.looseObject({
    messageId: z.string().min(1).describe('Gmail message ID.'),
    threadId: z.string().min(1).describe('Gmail thread ID.'),
    labelIds: z.array(z.string().min(1)).describe('Gmail label IDs.'),
    subject: z.string().describe('Message subject.'),
    sender: z.string().describe('Message sender.'),
    to: z.string().describe('Message recipients.'),
    messageTimestamp: z.string().describe('Message timestamp.'),
    preview: z.looseObject({}).describe('Gmail API object.').optional(),
    payload: z.looseObject({}).describe('Gmail API object.').nullable().optional(),
    messageText: z.string().describe('Extracted message body text.').optional(),
    attachmentList: z.array(z.looseObject({}).describe('Gmail API object.')).describe('Message attachments.').optional(),
    raw: z.string().describe('Raw RFC 2822 message when requested.').optional(),
  }).describe('Normalized Gmail message.')).describe('Messages in the thread.').optional(),
}).describe('Gmail thread.')

export const moveThreadToTrashInput = z.strictObject({
  threadId: z.string().min(1).describe('Gmail thread ID.'),
  addLabelIds: z.array(z.string().min(1)).describe('Gmail label IDs.').optional(),
  removeLabelIds: z.array(z.string().min(1)).describe('Gmail label IDs.').optional(),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const moveThreadToTrashOutput = z.looseObject({
  threadId: z.string().min(1).describe('Gmail thread ID.'),
  historyId: z.string().describe('Mailbox history checkpoint ID.').nullable().optional(),
  snippet: z.string().describe('Thread snippet.').optional(),
  messages: z.array(z.looseObject({
    messageId: z.string().min(1).describe('Gmail message ID.'),
    threadId: z.string().min(1).describe('Gmail thread ID.'),
    labelIds: z.array(z.string().min(1)).describe('Gmail label IDs.'),
    subject: z.string().describe('Message subject.'),
    sender: z.string().describe('Message sender.'),
    to: z.string().describe('Message recipients.'),
    messageTimestamp: z.string().describe('Message timestamp.'),
    preview: z.looseObject({}).describe('Gmail API object.').optional(),
    payload: z.looseObject({}).describe('Gmail API object.').nullable().optional(),
    messageText: z.string().describe('Extracted message body text.').optional(),
    attachmentList: z.array(z.looseObject({}).describe('Gmail API object.')).describe('Message attachments.').optional(),
    raw: z.string().describe('Raw RFC 2822 message when requested.').optional(),
  }).describe('Normalized Gmail message.')).describe('Messages in the thread.').optional(),
}).describe('Gmail thread.')

export const untrashThreadInput = z.strictObject({
  threadId: z.string().min(1).describe('Gmail thread ID.'),
  addLabelIds: z.array(z.string().min(1)).describe('Gmail label IDs.').optional(),
  removeLabelIds: z.array(z.string().min(1)).describe('Gmail label IDs.').optional(),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const untrashThreadOutput = z.looseObject({
  threadId: z.string().min(1).describe('Gmail thread ID.'),
  historyId: z.string().describe('Mailbox history checkpoint ID.').nullable().optional(),
  snippet: z.string().describe('Thread snippet.').optional(),
  messages: z.array(z.looseObject({
    messageId: z.string().min(1).describe('Gmail message ID.'),
    threadId: z.string().min(1).describe('Gmail thread ID.'),
    labelIds: z.array(z.string().min(1)).describe('Gmail label IDs.'),
    subject: z.string().describe('Message subject.'),
    sender: z.string().describe('Message sender.'),
    to: z.string().describe('Message recipients.'),
    messageTimestamp: z.string().describe('Message timestamp.'),
    preview: z.looseObject({}).describe('Gmail API object.').optional(),
    payload: z.looseObject({}).describe('Gmail API object.').nullable().optional(),
    messageText: z.string().describe('Extracted message body text.').optional(),
    attachmentList: z.array(z.looseObject({}).describe('Gmail API object.')).describe('Message attachments.').optional(),
    raw: z.string().describe('Raw RFC 2822 message when requested.').optional(),
  }).describe('Normalized Gmail message.')).describe('Messages in the thread.').optional(),
}).describe('Gmail thread.')

export const listHistoryInput = z.strictObject({
  startHistoryId: z.string().min(1).describe('History checkpoint.'),
  pageToken: z.string().describe('Opaque pagination token returned by Gmail.').optional(),
  maxResults: z.int().min(1).max(500).describe('Maximum number of results to return.').optional(),
  labelId: z.string().min(1).describe('Gmail label ID.').optional(),
  historyTypes: z.array(z.string()).describe('History event types to include.').optional(),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const listHistoryOutput = z.strictObject({
  history: z.array(z.looseObject({}).describe('Gmail API object.')),
  historyId: z.string(),
  nextPageToken: z.string().describe('Opaque pagination token returned by Gmail.').nullable().optional(),
}).describe('Mailbox history result.')

export const listFiltersInput = z.strictObject({
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const listFiltersOutput = z.strictObject({
  filters: z.array(z.looseObject({
    id: z.string().min(1).describe('Gmail filter ID.'),
    criteria: z.looseObject({}).describe('Gmail API object.').optional(),
    action: z.looseObject({}).describe('Gmail API object.').optional(),
  }).describe('Gmail filter.')),
}).describe('Filter list.')

export const getFilterInput = z.strictObject({
  filterId: z.string().min(1).describe('Gmail filter ID.'),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const getFilterOutput = z.looseObject({
  id: z.string().min(1).describe('Gmail filter ID.'),
  criteria: z.looseObject({}).describe('Gmail API object.').optional(),
  action: z.looseObject({}).describe('Gmail API object.').optional(),
}).describe('Gmail filter.')

export const createFilterInput = z.strictObject({
  criteria: z.looseObject({}).describe('Gmail API object.'),
  action: z.looseObject({}).describe('Gmail API object.'),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const createFilterOutput = z.looseObject({
  id: z.string().min(1).describe('Gmail filter ID.'),
  criteria: z.looseObject({}).describe('Gmail API object.').optional(),
  action: z.looseObject({}).describe('Gmail API object.').optional(),
}).describe('Gmail filter.')

export const deleteFilterInput = z.strictObject({
  filterId: z.string().min(1).describe('Gmail filter ID.'),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const deleteFilterOutput = z.strictObject({
  success: z.boolean().describe('Whether the operation completed successfully.'),
}).describe('Operation result.')

export const getLanguageSettingsInput = z.strictObject({
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const getLanguageSettingsOutput = z.looseObject({}).describe('Gmail API object.')

export const updateLanguageSettingsInput = z.strictObject({
  displayLanguage: z.string().min(1).describe('Language code.'),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const updateLanguageSettingsOutput = z.looseObject({}).describe('Gmail API object.')

export const getVacationSettingsInput = z.strictObject({
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const getVacationSettingsOutput = z.looseObject({}).describe('Gmail API object.')

export const updateVacationSettingsInput = z.strictObject({
  enableAutoReply: z.boolean().optional(),
  responseSubject: z.string().optional(),
  responseBodyPlainText: z.string().optional(),
  responseBodyHtml: z.string().optional(),
  restrictToContacts: z.boolean().optional(),
  restrictToDomain: z.boolean().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const updateVacationSettingsOutput = z.looseObject({}).describe('Gmail API object.')

export const getAutoForwardingInput = z.strictObject({
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const getAutoForwardingOutput = z.looseObject({}).describe('Gmail API object.')

export const listForwardingAddressesInput = z.strictObject({
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const listForwardingAddressesOutput = z.looseObject({}).describe('Gmail API object.')

export const settingsGetImapInput = z.strictObject({
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const settingsGetImapOutput = z.looseObject({}).describe('Gmail API object.')

export const settingsGetPopInput = z.strictObject({
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const settingsGetPopOutput = z.looseObject({}).describe('Gmail API object.')

export const stopWatchInput = z.strictObject({
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const stopWatchOutput = z.strictObject({
  success: z.boolean().describe('Whether the operation completed successfully.'),
}).describe('Operation result.')

export const updateImapSettingsInput = z.strictObject({
  enabled: z.boolean().optional(),
  autoExpunge: z.boolean().optional(),
  expungeBehavior: z.string().optional(),
  maxFolderSize: z.int().optional(),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const updateImapSettingsOutput = z.looseObject({}).describe('Gmail API object.')

export const updatePopSettingsInput = z.strictObject({
  accessWindow: z.string().optional(),
  disposition: z.string().optional(),
  userId: z.string().describe('Gmail user ID. Omit to use the connected mailbox.').optional(),
}).describe('The input payload for this action.')

export const updatePopSettingsOutput = z.looseObject({}).describe('Gmail API object.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const gmailActions = {
  search_threads: {
    description: 'Search Gmail threads by query and return lightweight thread summaries. Spam and trash stay excluded unless explicitly targeted in the query.',
    effect: 'read',
    inputSchema: searchThreadsInput,
    outputSchema: z.toJSONSchema(searchThreadsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_threads: {
    description: 'List Gmail threads with optional query filtering and pagination.',
    effect: 'read',
    inputSchema: listThreadsInput,
    outputSchema: z.toJSONSchema(listThreadsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  fetch_emails: {
    description: 'List Gmail messages with optional query, label, and pagination filters. Use detail to choose IDs, summaries, or full messages.',
    effect: 'read',
    inputSchema: fetchEmailsInput,
    outputSchema: z.toJSONSchema(fetchEmailsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_message: {
    description: 'Get a Gmail message by message ID with a simplified normalized output.',
    effect: 'read',
    inputSchema: getMessageInput,
    outputSchema: z.toJSONSchema(getMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  fetch_message_by_message_id: {
    description: 'Fetch a Gmail message by message ID with a controllable response format.',
    effect: 'read',
    inputSchema: fetchMessageByMessageIdInput,
    outputSchema: z.toJSONSchema(fetchMessageByMessageIdOutput, { io: 'output', unrepresentable: 'any' }),
  },
  fetch_message_by_thread_id: {
    description: 'Fetch all messages in a Gmail thread.',
    effect: 'read',
    inputSchema: fetchMessageByThreadIdInput,
    outputSchema: z.toJSONSchema(fetchMessageByThreadIdOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_profile: {
    description: 'Get the connected Gmail profile, including mailbox totals and the current historyId.',
    effect: 'read',
    inputSchema: getProfileInput,
    outputSchema: z.toJSONSchema(getProfileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_email: {
    description: 'Send an email from the connected Gmail account.',
    effect: 'write',
    inputSchema: sendEmailInput,
    outputSchema: z.toJSONSchema(sendEmailOutput, { io: 'output', unrepresentable: 'any' }),
  },
  reply_email: {
    description: 'Reply to an existing Gmail thread using the original message\'s reply headers.',
    effect: 'write',
    inputSchema: replyEmailInput,
    outputSchema: z.toJSONSchema(replyEmailOutput, { io: 'output', unrepresentable: 'any' }),
  },
  reply_to_thread: {
    description: 'Reply to an existing Gmail thread while preserving Gmail threading.',
    effect: 'write',
    inputSchema: replyToThreadInput,
    outputSchema: z.toJSONSchema(replyToThreadOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_draft: {
    description: 'Create a Gmail draft with a simplified input and output shape.',
    effect: 'write',
    inputSchema: createDraftInput,
    outputSchema: z.toJSONSchema(createDraftOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_email_draft: {
    description: 'Create a Gmail draft with recipients, subject, body, and optional threading.',
    effect: 'write',
    inputSchema: createEmailDraftInput,
    outputSchema: z.toJSONSchema(createEmailDraftOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_drafts: {
    description: 'List Gmail drafts with pagination.',
    effect: 'read',
    inputSchema: listDraftsInput,
    outputSchema: z.toJSONSchema(listDraftsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_draft: {
    description: 'Get a Gmail draft by draft ID.',
    effect: 'read',
    inputSchema: getDraftInput,
    outputSchema: z.toJSONSchema(getDraftOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_draft: {
    description: 'Update an existing Gmail draft in place.',
    effect: 'write',
    inputSchema: updateDraftInput,
    outputSchema: z.toJSONSchema(updateDraftOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_draft: {
    description: 'Send an existing Gmail draft as-is.',
    effect: 'write',
    inputSchema: sendDraftInput,
    outputSchema: z.toJSONSchema(sendDraftOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_draft: {
    description: 'Permanently delete a Gmail draft by draft ID.',
    effect: 'destructive',
    inputSchema: deleteDraftInput,
    outputSchema: z.toJSONSchema(deleteDraftOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_labels: {
    description: 'List all system and user-created Gmail labels.',
    effect: 'read',
    inputSchema: listLabelsInput,
    outputSchema: z.toJSONSchema(listLabelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_label: {
    description: 'Get details for a Gmail label.',
    effect: 'read',
    inputSchema: getLabelInput,
    outputSchema: z.toJSONSchema(getLabelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_label: {
    description: 'Create a new Gmail label and return its internal label ID.',
    effect: 'write',
    inputSchema: createLabelInput,
    outputSchema: z.toJSONSchema(createLabelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  patch_label: {
    description: 'Patch a user-created Gmail label.',
    effect: 'write',
    inputSchema: patchLabelInput,
    outputSchema: z.toJSONSchema(patchLabelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_label: {
    description: 'Update an existing Gmail label.',
    effect: 'write',
    inputSchema: updateLabelInput,
    outputSchema: z.toJSONSchema(updateLabelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_label: {
    description: 'Permanently delete a user-created Gmail label.',
    effect: 'destructive',
    inputSchema: deleteLabelInput,
    outputSchema: z.toJSONSchema(deleteLabelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_label_to_email: {
    description: 'Add and/or remove labels on a single Gmail message.',
    effect: 'write',
    inputSchema: addLabelToEmailInput,
    outputSchema: z.toJSONSchema(addLabelToEmailOutput, { io: 'output', unrepresentable: 'any' }),
  },
  batch_modify_messages: {
    description: 'Add and/or remove labels on up to 1,000 Gmail messages.',
    effect: 'write',
    inputSchema: batchModifyMessagesInput,
    outputSchema: z.toJSONSchema(batchModifyMessagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  move_to_trash: {
    description: 'Move a Gmail message to trash.',
    effect: 'write',
    inputSchema: moveToTrashInput,
    outputSchema: z.toJSONSchema(moveToTrashOutput, { io: 'output', unrepresentable: 'any' }),
  },
  untrash_message: {
    description: 'Restore a previously trashed Gmail message.',
    effect: 'write',
    inputSchema: untrashMessageInput,
    outputSchema: z.toJSONSchema(untrashMessageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  modify_thread_labels: {
    description: 'Add and/or remove labels on every message in a Gmail thread.',
    effect: 'write',
    inputSchema: modifyThreadLabelsInput,
    outputSchema: z.toJSONSchema(modifyThreadLabelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  move_thread_to_trash: {
    description: 'Move an entire Gmail thread to trash.',
    effect: 'write',
    inputSchema: moveThreadToTrashInput,
    outputSchema: z.toJSONSchema(moveThreadToTrashOutput, { io: 'output', unrepresentable: 'any' }),
  },
  untrash_thread: {
    description: 'Restore a previously trashed Gmail thread.',
    effect: 'write',
    inputSchema: untrashThreadInput,
    outputSchema: z.toJSONSchema(untrashThreadOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_history: {
    description: 'List Gmail mailbox change history after a known startHistoryId.',
    effect: 'read',
    inputSchema: listHistoryInput,
    outputSchema: z.toJSONSchema(listHistoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_filters: {
    description: 'List Gmail filters for the mailbox.',
    effect: 'read',
    inputSchema: listFiltersInput,
    outputSchema: z.toJSONSchema(listFiltersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_filter: {
    description: 'Get a Gmail filter by filter ID.',
    effect: 'read',
    inputSchema: getFilterInput,
    outputSchema: z.toJSONSchema(getFilterOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_filter: {
    description: 'Create a Gmail filter with matching criteria and resulting actions.',
    effect: 'write',
    inputSchema: createFilterInput,
    outputSchema: z.toJSONSchema(createFilterOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_filter: {
    description: 'Permanently delete a Gmail filter by filter ID.',
    effect: 'destructive',
    inputSchema: deleteFilterInput,
    outputSchema: z.toJSONSchema(deleteFilterOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_language_settings: {
    description: 'Get the Gmail display language settings.',
    effect: 'read',
    inputSchema: getLanguageSettingsInput,
    outputSchema: z.toJSONSchema(getLanguageSettingsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_language_settings: {
    description: 'Update the Gmail display language settings.',
    effect: 'write',
    inputSchema: updateLanguageSettingsInput,
    outputSchema: z.toJSONSchema(updateLanguageSettingsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_vacation_settings: {
    description: 'Get the Gmail vacation responder settings.',
    effect: 'read',
    inputSchema: getVacationSettingsInput,
    outputSchema: z.toJSONSchema(getVacationSettingsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_vacation_settings: {
    description: 'Update the Gmail vacation responder settings.',
    effect: 'write',
    inputSchema: updateVacationSettingsInput,
    outputSchema: z.toJSONSchema(updateVacationSettingsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_auto_forwarding: {
    description: 'Get the current Gmail auto-forwarding configuration.',
    effect: 'read',
    inputSchema: getAutoForwardingInput,
    outputSchema: z.toJSONSchema(getAutoForwardingOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_forwarding_addresses: {
    description: 'List registered forwarding addresses.',
    effect: 'read',
    inputSchema: listForwardingAddressesInput,
    outputSchema: z.toJSONSchema(listForwardingAddressesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  settings_get_imap: {
    description: 'Get the Gmail IMAP settings.',
    effect: 'write',
    inputSchema: settingsGetImapInput,
    outputSchema: z.toJSONSchema(settingsGetImapOutput, { io: 'output', unrepresentable: 'any' }),
  },
  settings_get_pop: {
    description: 'Get the Gmail POP settings.',
    effect: 'write',
    inputSchema: settingsGetPopInput,
    outputSchema: z.toJSONSchema(settingsGetPopOutput, { io: 'output', unrepresentable: 'any' }),
  },
  stop_watch: {
    description: 'Stop Gmail push watch notifications for the mailbox.',
    effect: 'write',
    inputSchema: stopWatchInput,
    outputSchema: z.toJSONSchema(stopWatchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_imap_settings: {
    description: 'Update the Gmail IMAP settings.',
    effect: 'write',
    inputSchema: updateImapSettingsInput,
    outputSchema: z.toJSONSchema(updateImapSettingsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_pop_settings: {
    description: 'Update the Gmail POP settings.',
    effect: 'write',
    inputSchema: updatePopSettingsInput,
    outputSchema: z.toJSONSchema(updatePopSettingsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
