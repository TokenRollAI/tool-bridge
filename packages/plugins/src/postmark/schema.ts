/**
 * Postmark 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getServerInput = z.strictObject({})

export const getServerOutput = z.looseObject({}).describe('Additional upstream fields returned by Postmark.')

export const sendEmailInput = z.strictObject({
  From: z.string().min(1).describe('Sender email address or full formatted sender string accepted by Postmark.'),
  To: z.string().min(1).describe('Recipient email address string. Multiple recipients are comma separated.'),
  Cc: z.string().describe('Cc recipient email address string.').optional(),
  Bcc: z.string().describe('Bcc recipient email address string.').optional(),
  Tag: z.string().describe('Email tag used for categorization and analytics.').optional(),
  ReplyTo: z.string().describe('Reply-To email address override.').optional(),
  Headers: z.array(z.strictObject({
    Name: z.string().min(1).describe('Custom header name.').optional(),
    Value: z.string().describe('Custom header value.').optional(),
  })).describe('Custom headers to include on the email.').optional(),
  TrackOpens: z.boolean().describe('Whether open tracking is enabled.').optional(),
  TrackLinks: z.enum(['None', 'HtmlAndText', 'HtmlOnly', 'TextOnly']).describe('Link tracking mode recognized by the official Postmark API.').optional(),
  Attachments: z.array(z.strictObject({
    Name: z.string().min(1).describe('Attachment file name.'),
    Content: z.string().min(1).describe('Base64-encoded attachment content.'),
    ContentType: z.string().min(1).describe('Attachment MIME type.'),
    ContentID: z.string().min(1).describe('Optional content ID for inline attachments.').optional(),
  })).describe('Attachments to include on the email.').optional(),
  Metadata: z.record(z.string(), z.string().describe('Metadata value.')).describe('Custom metadata key-value pairs attached to the message.').optional(),
  MessageStream: z.string().describe('Message stream ID to use when sending the email.').optional(),
  Subject: z.string().min(1).describe('Email subject line.'),
  HtmlBody: z.string().describe('HTML body content of the email.').optional(),
  TextBody: z.string().describe('Plain-text body content of the email.').optional(),
})

export const sendEmailOutput = z.looseObject({}).describe('Postmark message submission result.')

export const sendEmailWithTemplateInput = z.strictObject({
  TemplateId: z.int().min(1).describe('Template ID to use when rendering this message.').optional(),
  TemplateAlias: z.string().min(1).describe('Template alias to use when rendering this message.').optional(),
  TemplateModel: z.looseObject({}).describe('Additional upstream fields returned by Postmark.'),
  InlineCss: z.boolean().describe('Whether CSS blocks should be inlined into rendered HTML content.').optional(),
  From: z.string().min(1).describe('Sender email address or full formatted sender string accepted by Postmark.'),
  To: z.string().min(1).describe('Recipient email address string. Multiple recipients are comma separated.'),
  Cc: z.string().describe('Cc recipient email address string.').optional(),
  Bcc: z.string().describe('Bcc recipient email address string.').optional(),
  Tag: z.string().describe('Email tag used for categorization and analytics.').optional(),
  ReplyTo: z.string().describe('Reply-To email address override.').optional(),
  Headers: z.array(z.strictObject({
    Name: z.string().min(1).describe('Custom header name.').optional(),
    Value: z.string().describe('Custom header value.').optional(),
  })).describe('Custom headers to include on the email.').optional(),
  TrackOpens: z.boolean().describe('Whether open tracking is enabled.').optional(),
  TrackLinks: z.enum(['None', 'HtmlAndText', 'HtmlOnly', 'TextOnly']).describe('Link tracking mode recognized by the official Postmark API.').optional(),
  Attachments: z.array(z.strictObject({
    Name: z.string().min(1).describe('Attachment file name.'),
    Content: z.string().min(1).describe('Base64-encoded attachment content.'),
    ContentType: z.string().min(1).describe('Attachment MIME type.'),
    ContentID: z.string().min(1).describe('Optional content ID for inline attachments.').optional(),
  })).describe('Attachments to include on the email.').optional(),
  Metadata: z.record(z.string(), z.string().describe('Metadata value.')).describe('Custom metadata key-value pairs attached to the message.').optional(),
  MessageStream: z.string().describe('Message stream ID to use when sending the email.').optional(),
})

export const sendEmailWithTemplateOutput = z.looseObject({}).describe('Postmark message submission result.')

export const sendBatchWithTemplatesInput = z.strictObject({
  Messages: z.array(z.strictObject({
    TemplateId: z.int().min(1).describe('Template ID to use when rendering this message.').optional(),
    TemplateAlias: z.string().min(1).describe('Template alias to use when rendering this message.').optional(),
    TemplateModel: z.looseObject({}).describe('Additional upstream fields returned by Postmark.'),
    InlineCss: z.boolean().describe('Whether CSS blocks should be inlined into rendered HTML content.').optional(),
    From: z.string().min(1).describe('Sender email address or full formatted sender string accepted by Postmark.'),
    To: z.string().min(1).describe('Recipient email address string. Multiple recipients are comma separated.'),
    Cc: z.string().describe('Cc recipient email address string.').optional(),
    Bcc: z.string().describe('Bcc recipient email address string.').optional(),
    Tag: z.string().describe('Email tag used for categorization and analytics.').optional(),
    ReplyTo: z.string().describe('Reply-To email address override.').optional(),
    Headers: z.array(z.strictObject({
      Name: z.string().min(1).describe('Custom header name.').optional(),
      Value: z.string().describe('Custom header value.').optional(),
    })).describe('Custom headers to include on the email.').optional(),
    TrackOpens: z.boolean().describe('Whether open tracking is enabled.').optional(),
    TrackLinks: z.enum(['None', 'HtmlAndText', 'HtmlOnly', 'TextOnly']).describe('Link tracking mode recognized by the official Postmark API.').optional(),
    Attachments: z.array(z.strictObject({
      Name: z.string().min(1).describe('Attachment file name.'),
      Content: z.string().min(1).describe('Base64-encoded attachment content.'),
      ContentType: z.string().min(1).describe('Attachment MIME type.'),
      ContentID: z.string().min(1).describe('Optional content ID for inline attachments.').optional(),
    })).describe('Attachments to include on the email.').optional(),
    Metadata: z.record(z.string(), z.string().describe('Metadata value.')).describe('Custom metadata key-value pairs attached to the message.').optional(),
    MessageStream: z.string().describe('Message stream ID to use when sending the email.').optional(),
  })).min(1).max(500).describe('Templated messages to send in this batch request.').optional(),
})

export const sendBatchWithTemplatesOutput = z.array(z.looseObject({}).describe('Postmark message submission result.')).describe('Per-message results returned by Postmark batch template sending.')

export const searchOutboundMessagesInput = z.strictObject({
  count: z.int().min(1).max(500).describe('Number of results to return per request.').optional(),
  offset: z.int().min(0).describe('Number of results to skip before returning the current page.').optional(),
  recipient: z.string().describe('Filter by the user who was receiving the email.').optional(),
  fromemail: z.string().describe('Filter by the sender email address.').optional(),
  tag: z.string().describe('Filter by message tag.').optional(),
  status: z.enum(['queued', 'sent', 'processed']).describe('Outbound message status filter accepted by Postmark search.').optional(),
  todate: z.string().describe('Filter messages up to this datetime, inclusive.').optional(),
  fromdate: z.string().describe('Filter messages starting from this datetime, inclusive.').optional(),
  subject: z.string().describe('Filter by email subject.').optional(),
  messagestream: z.string().describe('Filter by message stream ID.').optional(),
  metadata: z.record(z.string(), z.string().describe('Metadata value.')).describe('Metadata filters mapped to Postmark metadata_<key> query parameters for outbound search.').optional(),
})

export const searchOutboundMessagesOutput = z.strictObject({
  TotalCount: z.int().describe('Total number of messages that matched the search.').optional(),
  Messages: z.array(z.looseObject({}).describe('Additional upstream fields returned by Postmark.')).describe('Outbound messages returned by the search.').optional(),
})

export const getOutboundMessageDetailsInput = z.strictObject({
  messageId: z.string().min(1).describe('Outbound message ID returned by Postmark.').optional(),
})

export const getOutboundMessageDetailsOutput = z.looseObject({}).describe('Additional upstream fields returned by Postmark.')

export const getBouncesInput = z.strictObject({
  count: z.int().min(1).max(500).describe('Number of results to return per request.').optional(),
  offset: z.int().min(0).describe('Number of results to skip before returning the current page.').optional(),
  type: z.string().describe('Filter by bounce type.').optional(),
  inactive: z.boolean().describe('Whether to return only inactive bounces.').optional(),
  emailFilter: z.string().describe('Filter by bounced email address.').optional(),
  messageID: z.string().describe('Filter by outbound message ID.').optional(),
  mailboxHash: z.string().describe('Filter by the mailbox hash portion of the address.').optional(),
  tag: z.string().describe('Filter by tag.').optional(),
  todate: z.string().describe('Only include bounces before this datetime.').optional(),
  fromdate: z.string().describe('Only include bounces after this datetime.').optional(),
})

export const getBouncesOutput = z.strictObject({
  TotalCount: z.int().describe('Total number of bounces that matched the filter.').optional(),
  Bounces: z.array(z.looseObject({}).describe('Additional upstream fields returned by Postmark.')).describe('Bounces returned by Postmark.').optional(),
})

export const listTemplatesInput = z.strictObject({
  count: z.int().min(1).max(500).describe('Number of results to return per request.').optional(),
  offset: z.int().min(0).describe('Number of results to skip before returning the current page.').optional(),
  TemplateType: z.enum(['Standard', 'Layout']).describe('Template type recognized by the official Postmark API.').optional(),
  LayoutTemplate: z.string().describe('Filter by layout template alias.').optional(),
})

export const listTemplatesOutput = z.strictObject({
  TotalCount: z.int().describe('Total number of templates.').optional(),
  Templates: z.array(z.looseObject({}).describe('Additional upstream fields returned by Postmark.')).describe('Templates returned by Postmark.').optional(),
})

export const getTemplateInput = z.strictObject({
  templateIdOrAlias: z.union([z.int().min(1).describe('Template ID.'), z.string().min(1).describe('Template alias.')]).describe('Template ID or template alias accepted by the Postmark path parameter.').optional(),
})

export const getTemplateOutput = z.looseObject({}).describe('Additional upstream fields returned by Postmark.')

export const createTemplateInput = z.strictObject({
  Name: z.string().min(1).describe('Template name.'),
  Subject: z.string().describe('Subject content for the template. Required for standard templates.').optional(),
  HtmlBody: z.string().describe('HTML body content of the template.').optional(),
  TextBody: z.string().describe('Plain-text body content of the template.').optional(),
  TemplateType: z.enum(['Standard', 'Layout']).describe('Template type recognized by the official Postmark API.').optional(),
  Alias: z.string().describe('Optional alias that identifies the template within the server.').optional(),
  LayoutTemplate: z.string().describe('Optional layout template alias used by a standard template.').optional(),
})

export const createTemplateOutput = z.looseObject({}).describe('Additional upstream fields returned by Postmark.')

export const editTemplateInput = z.strictObject({
  templateIdOrAlias: z.union([z.int().min(1).describe('Template ID.'), z.string().min(1).describe('Template alias.')]).describe('Template ID or template alias accepted by the Postmark path parameter.'),
  Name: z.string().min(1).describe('Updated template name.'),
  Subject: z.string().describe('Updated template subject content when the template is standard.').optional(),
  HtmlBody: z.string().describe('Updated HTML body content.').optional(),
  TextBody: z.string().describe('Updated plain-text body content.').optional(),
  Alias: z.string().describe('Updated alias that identifies the template within the server.').optional(),
  LayoutTemplate: z.string().describe('Updated layout template alias for a standard template.').optional(),
})

export const editTemplateOutput = z.looseObject({}).describe('Additional upstream fields returned by Postmark.')

export const validateTemplateInput = z.strictObject({
  Subject: z.string().describe('Subject content to validate against Postmark template syntax.').optional(),
  HtmlBody: z.string().describe('HTML body content to validate.').optional(),
  TextBody: z.string().describe('Plain-text body content to validate.').optional(),
  TestRenderModel: z.looseObject({}).describe('Additional upstream fields returned by Postmark.'),
  InlineCssForHtmlTestRender: z.boolean().describe('Whether CSS blocks should be inlined when rendering HTML test output.').optional(),
  TemplateType: z.enum(['Standard', 'Layout']).describe('Template type recognized by the official Postmark API.').optional(),
  LayoutTemplate: z.string().describe('Optional layout template alias used while validating a standard template.').optional(),
})

export const validateTemplateOutput = z.looseObject({}).describe('Additional upstream fields returned by Postmark.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const postmarkActions = {
  get_server: {
    description: 'Get the current Postmark server configuration for the connected server token.',
    effect: 'read',
    inputSchema: getServerInput,
    outputSchema: z.toJSONSchema(getServerOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_email: {
    description: 'Send a transactional email through the current Postmark server.',
    effect: 'write',
    inputSchema: sendEmailInput,
    outputSchema: z.toJSONSchema(sendEmailOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_email_with_template: {
    description: 'Send a single templated email through the current Postmark server.',
    effect: 'write',
    inputSchema: sendEmailWithTemplateInput,
    outputSchema: z.toJSONSchema(sendEmailWithTemplateOutput, { io: 'output', unrepresentable: 'any' }),
  },
  send_batch_with_templates: {
    description: 'Send up to 500 templated emails in a single Postmark batch request.',
    effect: 'write',
    inputSchema: sendBatchWithTemplatesInput,
    outputSchema: z.toJSONSchema(sendBatchWithTemplatesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_outbound_messages: {
    description: 'Search outbound Postmark messages with filters and pagination.',
    effect: 'read',
    inputSchema: searchOutboundMessagesInput,
    outputSchema: z.toJSONSchema(searchOutboundMessagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_outbound_message_details: {
    description: 'Get detailed content and events for one outbound Postmark message.',
    effect: 'read',
    inputSchema: getOutboundMessageDetailsInput,
    outputSchema: z.toJSONSchema(getOutboundMessageDetailsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_bounces: {
    description: 'Get Postmark bounces for the current server with optional filters.',
    effect: 'read',
    inputSchema: getBouncesInput,
    outputSchema: z.toJSONSchema(getBouncesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_templates: {
    description: 'List Postmark templates for the current server.',
    effect: 'read',
    inputSchema: listTemplatesInput,
    outputSchema: z.toJSONSchema(listTemplatesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_template: {
    description: 'Get one Postmark template by template ID or alias.',
    effect: 'read',
    inputSchema: getTemplateInput,
    outputSchema: z.toJSONSchema(getTemplateOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_template: {
    description: 'Create a Postmark template.',
    effect: 'write',
    inputSchema: createTemplateInput,
    outputSchema: z.toJSONSchema(createTemplateOutput, { io: 'output', unrepresentable: 'any' }),
  },
  edit_template: {
    description: 'Edit an existing Postmark template.',
    effect: 'write',
    inputSchema: editTemplateInput,
    outputSchema: z.toJSONSchema(editTemplateOutput, { io: 'output', unrepresentable: 'any' }),
  },
  validate_template: {
    description: 'Validate Postmark template content and render test output.',
    effect: 'write',
    inputSchema: validateTemplateInput,
    outputSchema: z.toJSONSchema(validateTemplateOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
