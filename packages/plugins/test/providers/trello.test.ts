import {
  encodeCredentialValues,
} from '@tool-bridge/core'
import { describe, expect, it, vi } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createTrelloPlugin } from '../../src/trello/index'
import { trelloActions } from '../../src/trello/schema'

/**
 * Trello 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * 两字段凭证进 **query**(不是请求头)、`fields` 参数总是发默认值、空更新体在本地就拦、
 * 以及一批"声明里 optional 但 executor 里必填"的 id 字段。
 */

const API_KEY = 'trellokey123'
const API_TOKEN = 'trellotoken456'
const CARD = 'card789'
const BOARD = 'board456'
const plugin = createTrelloPlugin()

interface CallOptions {
  raw?: string | null
}

const { call, envelope, mockJson: mockTrello, mockRaw, sent } = createProviderHarness<CallOptions>({
  mountPath: 'tasks/trello',
  plugin,
  resolveUpstreamAuth: opts => opts.raw !== undefined
    ? opts.raw
    : encodeCredentialValues({ apiKey: API_KEY, apiToken: API_TOKEN }),
})

/** 去掉两个凭证参数后剩下的 query —— 断言业务参数时用。 */
function businessQuery(request: Request): Record<string, string> {
  const params = new URL(request.url).searchParams
  params.delete('key')
  params.delete('token')
  return Object.fromEntries(params)
}

const CARD_PAYLOAD = {
  id: CARD,
  idBoard: BOARD,
  idList: 'list1',
  name: 'Ship it',
  desc: 'the description',
  url: 'https://trello.com/c/abc',
  shortUrl: 'https://trello.com/c/abc',
  closed: false,
  due: null,
  dueComplete: false,
  badges: { votes: 0 },
}

describe('契约面', () => {
  it('List 出全部 28 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(trelloActions).length)
    expect(tools).toHaveLength(28)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('凭证', () => {
  it('两个字段都进 query(不是请求头)—— Trello 的 API 设计,部署侧要对这两个参数名脱敏', async () => {
    const mock = mockTrello(200, { id: 'm1', username: 'ann' })
    await call('get_member', {})

    const request = sent(mock)
    const url = new URL(request.url)
    expect(url.origin).toBe('https://api.trello.com')
    expect(url.searchParams.get('key')).toBe(API_KEY)
    expect(url.searchParams.get('token')).toBe(API_TOKEN)
    expect(request.headers.get('authorization')).toBeNull()
    expect(request.headers.get('x-api-key')).toBeNull()
  })

  it('没配 authRef → 报错且不打上游', async () => {
    const mock = mockTrello(200, {})
    const res = await call('get_member', {}, { raw: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })

  it('凭证少了一个字段 → 报错且不打上游(字段表是 SDK 在解析时校验的)', async () => {
    const mock = mockTrello(200, {})
    const res = await call('get_member', {}, { raw: encodeCredentialValues({ apiKey: API_KEY }) })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('请求拼装', () => {
  it('get_member:memberId 缺省 me,fields 总是发(不给就发默认字段表)', async () => {
    const mock = mockTrello(200, { id: 'm1', username: 'ann', fullName: 'Ann' })
    await call('get_member', {})
    const request = sent(mock)
    expect(request.method).toBe('GET')
    expect(new URL(request.url).pathname).toBe('/1/members/me')
    expect(businessQuery(request)).toEqual({ fields: 'id,username,fullName' })
    expect(await request.text()).toBe('')
  })

  it('给了 fields 就用给的那份,逗号拼成一个参数', async () => {
    const mock = mockTrello(200, { id: 'm1' })
    await call('get_member', { memberId: 'm9', fields: ['id', 'avatarUrl'] })
    expect(new URL(sent(mock).url).pathname).toBe('/1/members/m9')
    expect(businessQuery(sent(mock))).toEqual({ fields: 'id,avatarUrl' })
  })

  it('list_board_cards 的过滤器在路径上(缺省 visible),不是 query', async () => {
    const mock = mockTrello(200, [])
    await call('list_board_cards', { boardId: BOARD })
    expect(new URL(sent(mock).url).pathname).toBe(`/1/boards/${BOARD}/cards/visible`)

    vi.unstubAllGlobals()
    const closed = mockTrello(200, [])
    await call('list_board_cards', { boardId: BOARD, filter: 'closed' })
    expect(new URL(sent(closed).url).pathname).toBe(`/1/boards/${BOARD}/cards/closed`)
  })

  it('list_card_comments 固定带 filter=commentCard(卡片动作流里什么都有)', async () => {
    const mock = mockTrello(200, [])
    await call('list_card_comments', { cardId: CARD, limit: 5 })
    expect(businessQuery(sent(mock))).toEqual({ filter: 'commentCard', limit: '5' })
  })

  it('create_card:POST + JSON body,字段改名成 Trello 的写法', async () => {
    const mock = mockTrello(200, CARD_PAYLOAD)
    await call('create_card', {
      listId: 'list1',
      name: 'Ship it',
      description: 'the description',
      position: 'top',
      memberIds: ['m1', 'm2'],
      labelIds: ['l1'],
    })
    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/1/cards')
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      idList: 'list1',
      name: 'Ship it',
      desc: 'the description',
      pos: 'top',
      idMembers: 'm1,m2',
      idLabels: 'l1',
    })
  })

  it('create_board 的可见性字段叫 prefs_permissionLevel', async () => {
    const mock = mockTrello(200, { id: BOARD, name: 'Roadmap' })
    await call('create_board', { name: 'Roadmap', permissionLevel: 'private', defaultLists: false })
    await expect(sent(mock).json()).resolves.toEqual({
      name: 'Roadmap',
      defaultLists: false,
      prefs_permissionLevel: 'private',
    })
  })

  it('update_card 的 due:给 null 是"清掉截止日期",要原样发下去', async () => {
    const mock = mockTrello(200, CARD_PAYLOAD)
    await call('update_card', { cardId: CARD, due: null })
    await expect(sent(mock).json()).resolves.toEqual({ due: null })

    vi.unstubAllGlobals()
    const set = mockTrello(200, CARD_PAYLOAD)
    await call('update_card', { cardId: CARD, due: '2026-01-01T00:00:00Z' })
    await expect(sent(set).json()).resolves.toEqual({ due: '2026-01-01T00:00:00Z' })
  })

  it('add_card_member 把 id 放 query 的 value,不是请求体;remove 走 DELETE 路径', async () => {
    const add = mockTrello(200, {})
    await call('add_card_member', { cardId: CARD, memberId: 'm1' })
    expect(sent(add).method).toBe('POST')
    expect(new URL(sent(add).url).pathname).toBe(`/1/cards/${CARD}/idMembers`)
    expect(businessQuery(sent(add))).toEqual({ value: 'm1' })
    expect(await sent(add).text()).toBe('')

    vi.unstubAllGlobals()
    const remove = mockTrello(200, {})
    await call('remove_card_member', { cardId: CARD, memberId: 'm1' })
    expect(sent(remove).method).toBe('DELETE')
    expect(new URL(sent(remove).url).pathname).toBe(`/1/cards/${CARD}/idMembers/m1`)
  })

  it('update_checkitem_state 从卡片下走,不是从 checklist 下走', async () => {
    const mock = mockTrello(200, CARD_PAYLOAD)
    await call('update_checkitem_state', { cardId: CARD, checkItemId: 'ci1', state: 'complete' })
    expect(new URL(sent(mock).url).pathname).toBe(`/1/cards/${CARD}/checkItem/ci1`)
    await expect(sent(mock).json()).resolves.toEqual({ state: 'complete' })
  })

  it('search 把 modelTypes 拼成逗号串,limit 走带下划线的参数名', async () => {
    const mock = mockTrello(200, [])
    await call('search', { query: 'roadmap', modelTypes: ['cards', 'boards'], cardsLimit: 10 })
    expect(businessQuery(sent(mock))).toEqual({
      query: 'roadmap',
      modelTypes: 'cards,boards',
      cards_limit: '10',
    })
  })

  it('路径段被 encodeURIComponent 转义(卡片 id 来自调用方)', async () => {
    const mock = mockTrello(200, CARD_PAYLOAD)
    await call('get_card', { cardId: 'a/b c' })
    expect(new URL(sent(mock).url).pathname).toBe('/1/cards/a%2Fb%20c')
  })
})

describe('响应整形', () => {
  it('卡片按 outputSchema 改名裁剪:desc→description、idList→listId,due 的 null 保留', async () => {
    mockTrello(200, CARD_PAYLOAD)
    const res = await call('get_card', { cardId: CARD })
    await expect(res.json()).resolves.toEqual({
      content: {
        card: {
          id: CARD,
          boardId: BOARD,
          listId: 'list1',
          name: 'Ship it',
          description: 'the description',
          url: 'https://trello.com/c/abc',
          shortUrl: 'https://trello.com/c/abc',
          closed: false,
          // 明确的"没有截止日期",与字段缺席不是一回事。
          due: null,
          dueComplete: false,
        },
      },
    })
  })

  it('清单把 pos 改名成 position,并递归整形 checkItems', async () => {
    mockTrello(200, [{
      id: 'cl1',
      idCard: CARD,
      name: 'Steps',
      checkItems: [{ id: 'ci1', name: 'First', state: 'incomplete', pos: 16384, extra: 'dropped' }],
    }])
    const res = await call('list_card_checklists', { cardId: CARD })
    await expect(res.json()).resolves.toEqual({
      content: {
        checklists: [{
          id: 'cl1',
          cardId: CARD,
          name: 'Steps',
          checkItems: [{ id: 'ci1', name: 'First', state: 'incomplete', position: 16384 }],
        }],
      },
    })
  })

  it('标签不改名,原样透传;附件的 bytes 为 null 时保留', async () => {
    mockTrello(200, [{ id: 'l1', color: 'green', name: 'bug' }])
    await expect((await call('list_board_labels', { boardId: BOARD })).json())
      .resolves.toEqual({ content: { labels: [{ id: 'l1', color: 'green', name: 'bug' }] } })

    vi.unstubAllGlobals()
    mockTrello(200, { id: 'a1', name: 'Spec', url: 'https://example.com/s', bytes: null })
    await expect((await call('add_card_attachment_url', { cardId: CARD, url: 'https://example.com/s' })).json())
      .resolves.toMatchObject({ content: { attachment: { bytes: null } } })
  })

  it('变更类 action 回一个明确的确认,上游 204 空体也不出错', async () => {
    mockRaw(204, '')
    await expect((await call('add_card_label', { cardId: CARD, labelId: 'l1' })).json())
      .resolves.toEqual({ content: { success: true } })
  })
})

describe('校验与错误', () => {
  it('声明里 optional 但 executor 必填的 id:缺了在本地就报 invalid_argument', async () => {
    // archive_card 的 cardId 在 schema.ts 里是 .optional(),上游 executor 却是必填。
    const mock = mockTrello(200, {})
    const res = await call('archive_card', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('cardId')
    expect(mock).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const list = mockTrello(200, {})
    expect((await call('archive_list', {})).status).toBe(400)
    expect(list).not.toHaveBeenCalled()
  })

  it('纯空白的 id 能过 Zod 的 min(1),但在本地就挡下', async () => {
    const mock = mockTrello(200, {})
    const res = await call('get_board', { boardId: '   ' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('boardId')
    expect(mock).not.toHaveBeenCalled()
  })

  it('空的更新体在本地就拦下:Trello 会照单全收并回一个没变过的对象', async () => {
    const card = mockTrello(200, CARD_PAYLOAD)
    const cardRes = await call('update_card', { cardId: CARD })
    expect(cardRes.status).toBe(400)
    await expect(cardRes.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(card).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const list = mockTrello(200, {})
    expect((await call('update_list', { listId: 'list1' })).status).toBe(400)
    expect(list).not.toHaveBeenCalled()
  })

  it('入参校验真的生效:limit 越界 / 非法 URL → 400 且不打上游', async () => {
    const limit = mockTrello(200, [])
    expect((await call('list_card_comments', { cardId: CARD, limit: 5000 })).status).toBe(400)
    expect(limit).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const url = mockTrello(200, {})
    expect((await call('add_card_attachment_url', { cardId: CARD, url: 'not a url' })).status).toBe(400)
    expect(url).not.toHaveBeenCalled()
  })

  it('凭证无效时把 Trello 那句过短的话换成"该去哪儿拿对的值"', async () => {
    // Trello 的 401 体常常就是一个 JSON 字符串字面量。
    mockTrello(401, 'invalid key')
    const badKey = await call('get_member', {})
    expect(badKey.status).toBe(401)
    const keyBody = (await badKey.json()) as { code: string, message: string }
    expect(keyBody.code).toBe('permission_denied')
    expect(keyBody.message).toContain('power-ups/admin')
    expect(keyBody.message).toContain('API Secret')

    vi.unstubAllGlobals()
    mockTrello(401, 'invalid token')
    const badToken = (await (await call('get_member', {})).json()) as { message: string }
    expect(badToken.message).toContain('Token 链接')
  })

  it('上游 4xx → invalid_argument / not_found;5xx → unavailable + retryable', async () => {
    mockRaw(404, 'Card not found', 'text/plain')
    const missing = await call('get_card', { cardId: CARD })
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({ code: 'not_found', message: 'Card not found' })

    vi.unstubAllGlobals()
    mockTrello(400, { message: 'invalid value for idList' })
    await expect((await call('get_card', { cardId: CARD })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'invalid value for idList' })

    vi.unstubAllGlobals()
    mockTrello(429, { message: 'API rate limit exceeded' })
    await expect((await call('get_card', { cardId: CARD })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockRaw(500, '', 'text/plain')
    await expect((await call('get_card', { cardId: CARD })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('响应形状不合契约(该是数组的不是 / 2xx 上回非 JSON)→ unavailable', async () => {
    mockTrello(200, { boards: 'not an array' })
    await expect((await call('list_member_boards', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    mockRaw(200, '<html>maintenance</html>', 'text/html')
    const res = await call('get_card', { cardId: CARD })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })
})
