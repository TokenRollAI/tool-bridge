/**
 * Gmail 消息的 MIME 编解码与出参整形。
 *
 * 迁移自 open-connector `src/providers/gmail/message.ts`,逻辑本体保留,只把 `Buffer` 换成
 * Web 标准的 `atob`/`btoa` —— 插件按 Web 标准运行时写(Worker / Deno / Bun / Node),
 * `Buffer` 不是各家都有的那个。
 *
 * 三处容易迁丢的细节:
 * - **`parseAddressList` 是个小状态机**:`"Doe, John" <j@x.com>, b@y.com` 里引号内与尖括号内的
 *   逗号不是分隔符。用 `split(',')` 会把一个收件人切成两个,发出去就是两个不存在的地址。
 * - **`messageTimestamp` 双来源**:优先 `internalDate`(毫秒时间戳字符串),解不出来才退回
 *   `Date` 头;两个都不行给空串,而不是当前时间 —— 编不出来的时间比没有时间更糟。
 * - **`extractBodyContent` 深度优先**:multipart 里第一个**非空**的 text/plain 或 text/html
 *   才算正文;`parts` 递归返回空串时要继续找下一个,不能就此收工。
 */

export interface GmailAttachmentSummary {
  attachmentId: string | null
  filename: string
  mimeType: string
  size: number
}

export interface GmailMessageHeader {
  name: string
  value: string
}

export interface GmailMessagePart {
  body?: {
    attachmentId?: string
    data?: string
    size?: number
  }
  filename?: string
  headers?: GmailMessageHeader[]
  mimeType?: string
  parts?: GmailMessagePart[]
}

export interface GmailMessageResource {
  historyId?: string
  id: string
  internalDate?: string
  labelIds?: string[]
  payload?: GmailMessagePart
  raw?: string
  snippet?: string
  threadId: string
}

export interface GmailDraftResource {
  id: string
  message: GmailMessageResource
}

export interface GmailThreadResource {
  historyId?: string
  id: string
  messages?: GmailMessageResource[]
  snippet?: string
}

export interface GmailMessageSummary {
  labelIds: string[]
  messageId: string
  messageTimestamp: string
  sender: string
  subject: string
  threadId: string
  to: string
}

export interface MimeMessageInput {
  bcc?: string[]
  body?: string
  cc?: string[]
  from?: string
  inReplyTo?: string
  isHtml?: boolean
  references?: string
  subject?: string
  to: string[]
}

export interface NormalizedGmailMessage extends GmailMessageSummary {
  attachmentList: GmailAttachmentSummary[]
  messageText: string
  payload: GmailMessagePart | null
  preview: { body: string, subject: string }
  raw?: string
}

/** UTF-8 文本 → 标准 base64(带填充)。 */
function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** UTF-8 文本 → base64url(**无填充**,与上游 `toString('base64url')` 一致)。 */
function encodeBase64Url(value: string): string {
  return encodeBase64(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * base64url → UTF-8 文本。解不出来给空串:上游用 `Buffer.from(…, 'base64url')`,那个实现对
 * 坏输入是"尽力而为、不抛",`atob` 会抛,故这里补一层兜底 —— 一封正文编坏了的邮件不该让
 * 整次调用失败。
 */
function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    return ''
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  // 非 fatal:与 Buffer 的 toString('utf8') 一样,坏字节替换成 U+FFFD 而不是抛。
  return new TextDecoder().decode(bytes)
}

function joinAddresses(addresses: string[]): string {
  return addresses.filter(Boolean).join(', ')
}

function headerLine(name: string, value?: string): string {
  return value ? `${name}: ${value}` : ''
}

/** 纯 ASCII 的 subject 原样发;含非 ASCII 走 RFC 2047 的 B 编码。 */
function encodeSubject(subject: string): string {
  return [...subject].every(char => char.charCodeAt(0) <= 0x7F)
    ? subject
    : `=?UTF-8?B?${encodeBase64(subject)}?=`
}

function normalizeReplySubject(subject: string): string {
  if (!subject) return 'Re:'
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`
}

function toMessageTimestamp(internalDate?: string, fallbackDate?: string): string {
  if (internalDate) {
    const parsed = Number(internalDate)
    if (Number.isFinite(parsed)) {
      const date = new Date(parsed)
      if (!Number.isNaN(date.getTime())) return date.toISOString()
    }
  }
  if (fallbackDate) {
    const parsed = new Date(fallbackDate)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return ''
}

function collectAttachments(payload: GmailMessagePart | null): GmailAttachmentSummary[] {
  if (!payload) return []

  const attachments: GmailAttachmentSummary[] = []
  if (payload.filename) {
    attachments.push({
      attachmentId: payload.body?.attachmentId ?? null,
      filename: payload.filename,
      mimeType: payload.mimeType ?? 'application/octet-stream',
      size: payload.body?.size ?? 0,
    })
  }
  for (const part of payload.parts ?? []) attachments.push(...collectAttachments(part))
  return attachments
}

/**
 * 收件人地址表切分。引号内与尖括号内的逗号**不是**分隔符 —— display name 里带逗号
 * (`"Doe, John" <j@x.com>`)是完全合法的写法。
 */
export function parseAddressList(value: string): string[] {
  const addresses: string[] = []
  let current = ''
  let inQuotes = false
  let angleDepth = 0
  let escaped = false

  for (const char of value) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      current += char
      if (inQuotes) escaped = true
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      current += char
      continue
    }
    if (!inQuotes) {
      if (char === '<') {
        angleDepth += 1
      } else if (char === '>' && angleDepth > 0) {
        angleDepth -= 1
      } else if (char === ',' && angleDepth === 0) {
        const address = current.trim()
        if (address) addresses.push(address)
        current = ''
        continue
      }
    }
    current += char
  }

  const address = current.trim()
  if (address) addresses.push(address)
  return addresses
}

export function firstAddress(value: string): string {
  return parseAddressList(value)[0] ?? ''
}

export function readHeader(headers: GmailMessageHeader[], name: string): string {
  return headers.find(header => header.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

/** 深度优先找第一个非空正文:text/plain 与 text/html 都算,前者优先只因它通常排在前面。 */
export function extractBodyContent(payload: GmailMessagePart | null): { body: string, isHtml: boolean } {
  if (!payload) return { body: '', isHtml: false }

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return { body: decodeBase64Url(payload.body.data), isHtml: false }
  }
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return { body: decodeBase64Url(payload.body.data), isHtml: true }
  }
  for (const part of payload.parts ?? []) {
    const content = extractBodyContent(part)
    // 空串不算找到:multipart/alternative 里常有一个空的 text/plain 占位。
    if (content.body) return content
  }
  if (payload.body?.data && (!payload.mimeType || payload.mimeType.startsWith('text/'))) {
    return { body: decodeBase64Url(payload.body.data), isHtml: payload.mimeType === 'text/html' }
  }
  return { body: '', isHtml: false }
}

/** Gmail 的 thread id 在某些返回里带 `thread-f:` / `msg-f:` 前缀,打接口时要剥掉。 */
export function normalizeThreadId(value: unknown): string {
  return String(value ?? '').replace(/^thread-f:/i, '').replace(/^msg-f:/i, '').trim()
}

export function normalizeMessageId(value: unknown): string {
  return String(value ?? '').trim()
}

export function summarizeGmailMessage(resource: GmailMessageResource): GmailMessageSummary {
  const headers = resource.payload?.headers ?? []
  return {
    messageId: resource.id,
    threadId: resource.threadId,
    labelIds: resource.labelIds ?? [],
    subject: readHeader(headers, 'Subject'),
    sender: readHeader(headers, 'From'),
    to: readHeader(headers, 'To'),
    messageTimestamp: toMessageTimestamp(resource.internalDate, readHeader(headers, 'Date')),
  }
}

export function normalizeGmailMessage(resource: GmailMessageResource): NormalizedGmailMessage {
  const payload = resource.payload ?? null
  const summary = summarizeGmailMessage(resource)
  const messageText = extractBodyContent(payload).body

  return {
    ...summary,
    preview: {
      subject: summary.subject,
      // Gmail 自己的 snippet 优先(它已经做过 HTML 剥离);没有才从正文截 200 字。
      body: resource.snippet ?? messageText.slice(0, 200),
    },
    payload,
    messageText,
    attachmentList: collectAttachments(payload),
    ...(resource.raw ? { raw: resource.raw } : {}),
  }
}

/** 回复用的四个头:Re: 前缀只加一次,收件人优先 Reply-To,线程锚点缺 Message-ID 时退回消息 id。 */
export function resolveReplyHeaders(resource: GmailMessageResource): {
  inReplyTo: string
  references: string
  subject: string
  to: string
} {
  const headers = resource.payload?.headers ?? []
  return {
    subject: normalizeReplySubject(readHeader(headers, 'Subject')),
    to: firstAddress(readHeader(headers, 'Reply-To')) || firstAddress(readHeader(headers, 'From')),
    references: readHeader(headers, 'References') || readHeader(headers, 'Message-ID') || resource.id,
    inReplyTo: readHeader(headers, 'Message-ID') || resource.id,
  }
}

/** 组一封 RFC 2822 邮件并按 Gmail 要求编成 base64url(空值的头整行不发)。 */
export function encodeMimeMessage(input: MimeMessageInput): string {
  const headers = [
    headerLine('From', joinAddresses(input.from ? [input.from] : [])),
    headerLine('To', joinAddresses(input.to)),
    headerLine('Cc', joinAddresses(input.cc ?? [])),
    headerLine('Bcc', joinAddresses(input.bcc ?? [])),
    headerLine('Subject', encodeSubject(input.subject ?? '')),
    headerLine('In-Reply-To', input.inReplyTo),
    headerLine('References', input.references),
    'MIME-Version: 1.0',
    `Content-Type: ${input.isHtml ? 'text/html' : 'text/plain'}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean)

  return encodeBase64Url(`${headers.join('\r\n')}\r\n\r\n${encodeBase64(input.body ?? '')}`)
}

function optionalAddressList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  const stringValue = String(value ?? '').trim()
  return stringValue ? [stringValue] : []
}

/**
 * 三个入参字段汇成一份 To 表:`to` / `recipientEmail` / `extraRecipients`。上游同时收这三个
 * 是历史包袱(不同来源的 action 各用一个名字),语义是**并集**而不是"取第一个有值的"。
 */
export function buildRecipients(input: {
  bcc?: string | string[]
  cc?: string | string[]
  extraRecipients?: string[]
  recipientEmail?: string | string[]
  to?: string | string[]
}): { bcc: string[], cc: string[], to: string[] } {
  return {
    to: [
      ...optionalAddressList(input.to),
      ...optionalAddressList(input.recipientEmail),
      ...optionalAddressList(input.extraRecipients),
    ],
    cc: optionalAddressList(input.cc),
    bcc: optionalAddressList(input.bcc),
  }
}
