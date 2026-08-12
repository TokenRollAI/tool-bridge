/**
 * Trello 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/trello/runtime.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.credentials` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * ## 凭证在 URL 里,不在请求头
 *
 * Trello 的 REST API 要求把 **`key` 与 `token` 作为 query 参数**发,换成 `Authorization`
 * 头会 401 —— 这是上游 API 的设计,照抄。**部署侧需知**:出站 URL 里带着两份明文凭证,
 * 访问日志、trace、错误上报里的 URL 都要脱敏(至少 `key` 与 `token` 两个参数名)。
 *
 * 凭证是**两个字段**(`apiKey` + `apiToken`),字段名与上游 `definition.ts` 的
 * `auth[0].fields` 一致,靠 `requireCredential` 取。
 *
 * ## 三处上游细节决定了这里的形状
 *
 * - `fields` 参数**总是发**:调用方不给就发一份该资源的默认字段表。不发的话 Trello 会回
 *   整个对象,几十个字段里只有几个进得了 outputSchema,白传一大堆。
 * - `update_list` / `update_card` 的请求体为空时**本地报错**:Trello 会照单全收并回一个
 *   没变过的对象,调用方看不出自己什么都没改。
 * - 出参统一改名裁剪(`desc` → `description`、`idList` → `listId`、`pos` → `position`),
 *   其中 `due` 的 `null` 要留住(明确的"没有截止日期",与字段缺席不同)。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  addCardAttachmentUrlInput,
  addCardCommentInput,
  addCardLabelInput,
  addCardMemberInput,
  addCheckitemInput,
  archiveCardInput,
  archiveListInput,
  createBoardInput,
  createCardInput,
  createChecklistInput,
  createListInput,
  getBoardInput,
  getCardInput,
  getMemberInput,
  listBoardCardsInput,
  listBoardLabelsInput,
  listBoardListsInput,
  listBoardMembersInput,
  listCardChecklistsInput,
  listCardCommentsInput,
  listMemberBoardsInput,
  moveCardInput,
  removeCardLabelInput,
  removeCardMemberInput,
  searchInput,
  updateCardInput,
  updateCheckitemStateInput,
  updateListInput,
} from './schema'
import { type ProviderContext, requireCredential } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'trello'
const API_BASE = 'https://api.trello.com/1'

/** 调用方不给 `fields` 时各资源发的默认字段表。 */
const DEFAULT_MEMBER_FIELDS = ['id', 'username', 'fullName']
const DEFAULT_BOARD_FIELDS = ['name', 'desc', 'url', 'shortUrl', 'closed']
const DEFAULT_CARD_FIELDS = ['name', 'desc', 'url', 'shortUrl', 'closed', 'due', 'dueComplete', 'idBoard', 'idList']

/** `key` 无效与 `token` 无效是两回事,而 Trello 只回一句同样简短的话。 */
const AUTH_HINTS: Record<string, string> = {
  'invalid key': 'Trello API key 无效:用 https://trello.com/power-ups/admin 上 Key 一栏的值,'
    + '不是 API Secret,也不是 Atlassian API token',
  'invalid token': 'Trello API token 无效:在 https://trello.com/power-ups/admin 上 API Key 旁边的'
    + ' Token 链接里生成',
}

type Json = Record<string, unknown>
type Position = number | string
type QueryValue = boolean | number | string | null | undefined

interface RequestInput {
  body?: Json
  method?: 'DELETE' | 'GET' | 'POST' | 'PUT'
  path: string
  query?: Array<[string, QueryValue]>
}

/** 上游 `readOptionalString`:去空白后仍非空才算有值。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** 出参里 `null` 与"字段缺席"是两回事:前者是上游明确说"这一项是空的"。 */
function nullableText(value: unknown): string | null | undefined {
  return value === null ? null : text(value)
}

/** 丢掉值为 undefined 的键(上游 `compactObject`);`null` 要留住。 */
function compact(input: Record<string, unknown>): Json {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

/**
 * 上游 `readRequiredString`:去空白后必须非空。
 *
 * 上游有一批 action 的 id 字段在声明里是 optional(见 schema.ts),executor 里却是必填 ——
 * schema 忠实反映上游,必填断言留在这一层。Zod 的 `min(1)` 也拦不住纯空白串。
 */
function requireInput(value: string | undefined, field: string): string {
  const result = text(value)
  if (result === undefined) throw new TBError('invalid_argument', `${field} 是必填的`)
  return result
}

/** 契约说好是对象;不是就是上游出问题,不是调用方的错。 */
function requireRecord(value: unknown, label: string): Json {
  const result = record(value)
  if (result === undefined) throw new TBError('unavailable', `${label}不是对象`, { retryable: true })
  return result
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TBError('unavailable', `${label}不是数组`, { retryable: true })
  return value
}

/** `fields` 总是发:不给就发该资源的默认字段表。 */
function fields(value: string[] | undefined, fallback: string[]): string {
  return (value ?? fallback).join(',')
}

/** 位置既收 `top`/`bottom` 也收数字;字符串形态要去空白。 */
function position(value: Position | undefined): Position | undefined {
  if (value === undefined) return undefined
  return typeof value === 'number' ? value : requireInput(value, 'position')
}

/** id 数组拼成逗号串(Trello 的 `idMembers` / `idLabels` 就收这个形态)。 */
function idList(value: string[] | undefined, field: string): string | undefined {
  if (value === undefined) return undefined
  return value.map(item => requireInput(item, field)).join(',')
}

/** Trello 的错误消息:JSON 体里找三个键,非 JSON 就是正文本身,都没有才兜底状态码。 */
function errorMessage(response: Response, body: string): string {
  const fallback = response.statusText !== '' ? response.statusText : `HTTP ${response.status}`
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) {
    return body === '' ? fallback : body
  }
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return fallback
  }
  // Trello 的 4xx 常常直接回一个 JSON 字符串字面量,比如 `"invalid token"`。
  if (typeof payload === 'string') return text(payload) ?? fallback
  const error = record(payload)
  return text(error?.message) ?? text(error?.error) ?? text(error?.detail) ?? fallback
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  const url = new URL(`${API_BASE}${input.path}`)
  // 凭证进 query —— Trello 的设计,换 header 会 401。部署侧要对这两个参数名脱敏。
  url.searchParams.set('key', requireCredential(ctx, SERVICE, 'apiKey'))
  url.searchParams.set('token', requireCredential(ctx, SERVICE, 'apiToken'))
  for (const [key, value] of input.query ?? []) {
    if (value === undefined || value === null) continue
    url.searchParams.set(key, String(value))
  }

  const hasBody = input.body !== undefined
  const headers: Record<string, string> = { accept: 'application/json' }
  if (hasBody) headers['content-type'] = 'application/json'

  const response = await guardedFetch(url.toString(), {
    method: input.method ?? 'GET',
    headers,
    body: hasBody ? JSON.stringify(input.body) : undefined,
  })

  const body = await response.text().catch(() => '')
  if (!response.ok) {
    const message = errorMessage(response, body)
    // 401/403 说明这份凭证不对;把 Trello 那句过于简短的话换成"该去哪儿拿对的值"。
    throw upstreamError(response.status, AUTH_HINTS[message] ?? message)
  }
  // 204 与空体都表示"做完了,没东西回" —— 变更类 action 走的就是这条路。
  if (response.status === 204 || body === '') return undefined
  try {
    return JSON.parse(body)
  } catch {
    throw new TBError('unavailable', 'Trello 返回了非 JSON 响应', { retryable: true })
  }
}

function normalizeMember(payload: unknown): Json {
  const member = requireRecord(payload, 'Trello 成员')
  return compact({
    id: text(member.id),
    username: text(member.username),
    fullName: text(member.fullName),
  })
}

function normalizeBoard(payload: unknown): Json {
  const board = requireRecord(payload, 'Trello 看板')
  return compact({
    id: text(board.id),
    name: text(board.name),
    description: text(board.desc),
    url: text(board.url),
    shortUrl: text(board.shortUrl),
    closed: boolean(board.closed),
  })
}

function normalizeList(payload: unknown): Json {
  const list = requireRecord(payload, 'Trello 列表')
  return compact({
    id: text(list.id),
    boardId: text(list.idBoard),
    name: text(list.name),
    closed: boolean(list.closed),
    position: number(list.pos),
  })
}

function normalizeCard(payload: unknown): Json {
  const card = requireRecord(payload, 'Trello 卡片')
  return compact({
    id: text(card.id),
    boardId: text(card.idBoard),
    listId: text(card.idList),
    name: text(card.name),
    description: text(card.desc),
    url: text(card.url),
    shortUrl: text(card.shortUrl),
    closed: boolean(card.closed),
    due: nullableText(card.due),
    dueComplete: boolean(card.dueComplete),
  })
}

function normalizeAction(payload: unknown): Json {
  const action = requireRecord(payload, 'Trello 动作')
  return compact({
    id: text(action.id),
    type: text(action.type),
    data: record(action.data),
    date: text(action.date),
  })
}

function normalizeCheckItem(payload: unknown): Json {
  const item = requireRecord(payload, 'Trello 检查项')
  return compact({
    id: text(item.id),
    name: text(item.name),
    state: text(item.state),
    position: number(item.pos),
  })
}

function normalizeChecklist(payload: unknown): Json {
  const checklist = requireRecord(payload, 'Trello 清单')
  const items = checklist.checkItems
  return compact({
    id: text(checklist.id),
    cardId: text(checklist.idCard),
    name: text(checklist.name),
    checkItems: Array.isArray(items) ? items.map(item => normalizeCheckItem(item)) : undefined,
  })
}

function normalizeAttachment(payload: unknown): Json {
  const attachment = requireRecord(payload, 'Trello 附件')
  return compact({
    id: text(attachment.id),
    name: text(attachment.name),
    url: text(attachment.url),
    // bytes 的 null 是"未知大小",与字段缺席不同。
    bytes: attachment.bytes === null ? null : number(attachment.bytes),
    date: text(attachment.date),
  })
}

/** create 与 update 共用的卡片请求体(上游 `buildCardMutationBody`)。 */
function cardBody(
  input: z.infer<typeof createCardInput> | z.infer<typeof updateCardInput>,
  mode: 'create' | 'update',
): Json {
  // closed / dueComplete 只在 update 的 schema 里有;create 走过来时它们本来就是 undefined。
  const updates = input as Partial<z.infer<typeof updateCardInput>>
  const body = compact({
    idList: mode === 'create' ? requireInput(input.listId, 'listId') : text(input.listId),
    name: text(input.name),
    desc: text(input.description),
    // due 的 null 要原样发下去:那是"清掉截止日期"的表达。
    due: input.due === null ? null : text(input.due),
    pos: position(input.position),
    idMembers: idList(input.memberIds, 'memberIds'),
    idLabels: idList(input.labelIds, 'labelIds'),
    closed: updates.closed,
    dueComplete: updates.dueComplete,
  })
  if (mode === 'update' && Object.keys(body).length === 0) {
    // 空 PUT Trello 会照单全收并回一个没变过的卡片,调用方看不出自己什么都没改。
    throw new TBError('invalid_argument', '更新卡片至少要给一个可改字段')
  }
  return body
}

export async function getMember(input: z.infer<typeof getMemberInput>, ctx: ProviderContext): Promise<Json> {
  const memberId = text(input.memberId) ?? 'me'
  const payload = await request(ctx, {
    path: `/members/${encodeURIComponent(memberId)}`,
    query: [['fields', fields(input.fields, DEFAULT_MEMBER_FIELDS)]],
  })
  return { member: normalizeMember(payload) }
}

export async function listMemberBoards(
  input: z.infer<typeof listMemberBoardsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const memberId = text(input.memberId) ?? 'me'
  const payload = await request(ctx, {
    path: `/members/${encodeURIComponent(memberId)}/boards`,
    query: [
      ['fields', fields(input.fields, DEFAULT_BOARD_FIELDS)],
      ['filter', input.filter],
    ],
  })
  return { boards: requireArray(payload, 'Trello 看板列表').map(board => normalizeBoard(board)) }
}

export async function getBoard(input: z.infer<typeof getBoardInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    path: `/boards/${encodeURIComponent(requireInput(input.boardId, 'boardId'))}`,
    query: [['fields', fields(input.fields, DEFAULT_BOARD_FIELDS)]],
  })
  return { board: normalizeBoard(payload) }
}

export async function createBoard(input: z.infer<typeof createBoardInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: '/boards',
    body: compact({
      name: requireInput(input.name, 'name'),
      desc: text(input.description),
      defaultLists: input.defaultLists,
      // 可见性在 Trello 的建板接口里叫 prefs_permissionLevel,不是 permissionLevel。
      prefs_permissionLevel: input.permissionLevel,
    }),
  })
  return { board: normalizeBoard(payload) }
}

export async function listBoardLists(
  input: z.infer<typeof listBoardListsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/boards/${encodeURIComponent(requireInput(input.boardId, 'boardId'))}/lists`,
    query: [['filter', input.filter]],
  })
  return { lists: requireArray(payload, 'Trello 列表集合').map(list => normalizeList(list)) }
}

export async function createList(input: z.infer<typeof createListInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: '/lists',
    body: compact({
      idBoard: requireInput(input.boardId, 'boardId'),
      name: requireInput(input.name, 'name'),
      pos: position(input.position),
    }),
  })
  return { list: normalizeList(payload) }
}

export async function updateList(input: z.infer<typeof updateListInput>, ctx: ProviderContext): Promise<Json> {
  const body = compact({
    name: text(input.name),
    pos: position(input.position),
  })
  if (Object.keys(body).length === 0) {
    throw new TBError('invalid_argument', '更新列表至少要给一个可改字段')
  }
  const payload = await request(ctx, {
    method: 'PUT',
    path: `/lists/${encodeURIComponent(requireInput(input.listId, 'listId'))}`,
    body,
  })
  return { list: normalizeList(payload) }
}

export async function archiveList(input: z.infer<typeof archiveListInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    method: 'PUT',
    path: `/lists/${encodeURIComponent(requireInput(input.listId, 'listId'))}`,
    body: { closed: true },
  })
  return { list: normalizeList(payload) }
}

export async function listBoardCards(
  input: z.infer<typeof listBoardCardsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const boardId = requireInput(input.boardId, 'boardId')
  // 过滤器在**路径**上,不是 query;缺省 visible。
  const filter = input.filter ?? 'visible'
  const payload = await request(ctx, {
    path: `/boards/${encodeURIComponent(boardId)}/cards/${encodeURIComponent(filter)}`,
    query: [['fields', fields(input.fields, DEFAULT_CARD_FIELDS)]],
  })
  return { cards: requireArray(payload, 'Trello 卡片列表').map(card => normalizeCard(card)) }
}

export async function listBoardMembers(
  input: z.infer<typeof listBoardMembersInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/boards/${encodeURIComponent(requireInput(input.boardId, 'boardId'))}/members`,
    query: [['fields', fields(input.fields, DEFAULT_MEMBER_FIELDS)]],
  })
  return { members: requireArray(payload, 'Trello 成员列表').map(member => normalizeMember(member)) }
}

export async function listBoardLabels(
  input: z.infer<typeof listBoardLabelsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/boards/${encodeURIComponent(requireInput(input.boardId, 'boardId'))}/labels`,
  })
  // 标签没有改名裁剪那一步,原样透传(outputSchema 是 looseObject)。
  return { labels: requireArray(payload, 'Trello 标签列表').map(label => requireRecord(label, 'Trello 标签')) }
}

export async function getCard(input: z.infer<typeof getCardInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    path: `/cards/${encodeURIComponent(requireInput(input.cardId, 'cardId'))}`,
    query: [['fields', fields(input.fields, DEFAULT_CARD_FIELDS)]],
  })
  return { card: normalizeCard(payload) }
}

export async function createCard(input: z.infer<typeof createCardInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, { method: 'POST', path: '/cards', body: cardBody(input, 'create') })
  return { card: normalizeCard(payload) }
}

export async function moveCard(input: z.infer<typeof moveCardInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    method: 'PUT',
    path: `/cards/${encodeURIComponent(requireInput(input.cardId, 'cardId'))}`,
    body: compact({
      idList: requireInput(input.listId, 'listId'),
      pos: position(input.position),
    }),
  })
  return { card: normalizeCard(payload) }
}

export async function archiveCard(input: z.infer<typeof archiveCardInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    method: 'PUT',
    path: `/cards/${encodeURIComponent(requireInput(input.cardId, 'cardId'))}`,
    body: { closed: true },
  })
  return { card: normalizeCard(payload) }
}

export async function updateCard(input: z.infer<typeof updateCardInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    method: 'PUT',
    path: `/cards/${encodeURIComponent(requireInput(input.cardId, 'cardId'))}`,
    body: cardBody(input, 'update'),
  })
  return { card: normalizeCard(payload) }
}

export async function addCardComment(
  input: z.infer<typeof addCardCommentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: `/cards/${encodeURIComponent(requireInput(input.cardId, 'cardId'))}/actions/comments`,
    body: { text: requireInput(input.text, 'text') },
  })
  return { action: normalizeAction(payload) }
}

export async function listCardComments(
  input: z.infer<typeof listCardCommentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/cards/${encodeURIComponent(requireInput(input.cardId, 'cardId'))}/actions`,
    // 卡片的动作流里什么都有,只要评论那一种。
    query: [['filter', 'commentCard'], ['limit', input.limit]],
  })
  return { comments: requireArray(payload, 'Trello 评论列表').map(comment => normalizeAction(comment)) }
}

export async function addCardMember(input: z.infer<typeof addCardMemberInput>, ctx: ProviderContext): Promise<Json> {
  await request(ctx, {
    method: 'POST',
    path: `/cards/${encodeURIComponent(requireInput(input.cardId, 'cardId'))}/idMembers`,
    // 要加的 id 走 query 的 `value`,不是请求体 —— 上游 API 如此。
    query: [['value', requireInput(input.memberId, 'memberId')]],
  })
  return { success: true }
}

export async function removeCardMember(
  input: z.infer<typeof removeCardMemberInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const cardId = requireInput(input.cardId, 'cardId')
  const memberId = requireInput(input.memberId, 'memberId')
  await request(ctx, {
    method: 'DELETE',
    path: `/cards/${encodeURIComponent(cardId)}/idMembers/${encodeURIComponent(memberId)}`,
  })
  return { success: true }
}

export async function addCardLabel(input: z.infer<typeof addCardLabelInput>, ctx: ProviderContext): Promise<Json> {
  await request(ctx, {
    method: 'POST',
    path: `/cards/${encodeURIComponent(requireInput(input.cardId, 'cardId'))}/idLabels`,
    query: [['value', requireInput(input.labelId, 'labelId')]],
  })
  return { success: true }
}

export async function removeCardLabel(
  input: z.infer<typeof removeCardLabelInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const cardId = requireInput(input.cardId, 'cardId')
  const labelId = requireInput(input.labelId, 'labelId')
  await request(ctx, {
    method: 'DELETE',
    path: `/cards/${encodeURIComponent(cardId)}/idLabels/${encodeURIComponent(labelId)}`,
  })
  return { success: true }
}

export async function createChecklist(
  input: z.infer<typeof createChecklistInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: `/cards/${encodeURIComponent(requireInput(input.cardId, 'cardId'))}/checklists`,
    body: { name: requireInput(input.name, 'name') },
  })
  return { checklist: normalizeChecklist(payload) }
}

export async function listCardChecklists(
  input: z.infer<typeof listCardChecklistsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/cards/${encodeURIComponent(requireInput(input.cardId, 'cardId'))}/checklists`,
  })
  return {
    checklists: requireArray(payload, 'Trello 清单列表').map(checklist => normalizeChecklist(checklist)),
  }
}

export async function addCheckitem(input: z.infer<typeof addCheckitemInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: `/checklists/${encodeURIComponent(requireInput(input.checklistId, 'checklistId'))}/checkItems`,
    body: compact({
      name: requireInput(input.name, 'name'),
      pos: position(input.position),
      checked: input.checked,
    }),
  })
  return { checkItem: normalizeCheckItem(payload) }
}

export async function updateCheckitemState(
  input: z.infer<typeof updateCheckitemStateInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const cardId = requireInput(input.cardId, 'cardId')
  const checkItemId = requireInput(input.checkItemId, 'checkItemId')
  const payload = await request(ctx, {
    method: 'PUT',
    // 改检查项状态要从**卡片**下走,不是从 checklist 下走 —— 上游 API 如此。
    path: `/cards/${encodeURIComponent(cardId)}/checkItem/${encodeURIComponent(checkItemId)}`,
    body: { state: requireInput(input.state, 'state') },
  })
  // 上游回的是整张卡片而不是那个检查项,outputSchema 也是这么声明的。
  return { card: normalizeCard(payload) }
}

export async function addCardAttachmentUrl(
  input: z.infer<typeof addCardAttachmentUrlInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    method: 'POST',
    path: `/cards/${encodeURIComponent(requireInput(input.cardId, 'cardId'))}/attachments`,
    body: compact({
      url: requireInput(input.url, 'url'),
      name: text(input.name),
    }),
  })
  return { attachment: normalizeAttachment(payload) }
}

export async function search(input: z.infer<typeof searchInput>, ctx: ProviderContext): Promise<Json> {
  const payload = await request(ctx, {
    path: '/search',
    query: [
      ['query', requireInput(input.query, 'query')],
      ['modelTypes', input.modelTypes?.join(',')],
      ['cards_limit', input.cardsLimit],
      ['boards_limit', input.boardsLimit],
      ['members_limit', input.membersLimit],
    ],
  })
  return { results: requireArray(payload, 'Trello 搜索结果').map(result => requireRecord(result, 'Trello 搜索结果项')) }
}
