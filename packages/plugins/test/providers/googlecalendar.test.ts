import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGooglecalendarPlugin } from '../../src/googlecalendar/index'
import { googlecalendarActions } from '../../src/googlecalendar/schema'

/**
 * Google Calendar 迁移产物的 wire 级验收。除了常规的请求拼装/错误归一,重点钉住几处
 * "迁移最容易迁丢"的语义:
 * - 事件时间的 `date`(全天)与 `dateTime`(带时区)两种形态原样透传;
 * - 写事件时 `conferenceDataVersion` / `supportsAttachments` 两个开关由 body 反推;
 * - `update_event` 读改写要把 `conferenceData` / `source` 二次收窄;
 * - `sync_events` 带 syncToken 时只发同步模式的参数,且强制 `showDeleted=true`;
 * - `find_free_slots` 的 `isReliable`:三种不可信来源都要把 `free` 清空;
 * - `list_events_all_calendars` 的部分失败、401 整体上抛、全天事件按**日历自己的时区**排序。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
/** 平台注入的是 OAuth2 换来的 access token,插件侧照常当单值凭证取。 */
const ACCESS_TOKEN = 'ya29.a0test'
const API_BASE = 'https://www.googleapis.com/calendar/v3'
const plugin = createGooglecalendarPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'calendar/google',
  exportId: 'actions',
}

function envelope(body: unknown, opts: { auth?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'authorization': `Bearer ${PLUGIN_TOKEN}`,
    'content-type': 'application/json',
    [HEADER_TB_CONTEXT]: encodeCallContext(CALLER),
  }
  const auth = opts.auth === undefined ? ACCESS_TOKEN : opts.auth
  if (auth !== null) {
    headers[HEADER_TB_UPSTREAM_AUTH] = base64urlEncode(new TextEncoder().encode(auth))
  }
  return Promise.resolve(plugin.fetch(
    new Request('https://plugin.test/', { method: 'POST', headers, body: JSON.stringify(body) }),
    ENV as never,
  ))
}

function call(name: string, args: unknown, opts?: { auth?: string | null }): Promise<Response> {
  return envelope({ tool: 'Call', arguments: { name, args } }, opts)
}

/** 一次上游响应。`payload: null` 表示空响应体(204 必须传 null,传 '' 在 undici 下 TypeError)。 */
type Reply = [status: number, payload: unknown]

/**
 * 按顺序回放多个上游响应;回放完最后一个之后重复它(扇出多个日历的用例要用)。
 */
function mockCalendar(...replies: Reply[]): ReturnType<typeof vi.fn> {
  const queue = [...replies]
  const fn = vi.fn(() => {
    const [status, payload] = queue.length > 1 ? queue.shift()! : queue[0]!
    return Promise.resolve(payload === null
      ? new Response(null, { status })
      : new Response(JSON.stringify(payload), {
          status,
          headers: { 'content-type': 'application/json' },
        }))
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 取上游收到的第 index 个请求。 */
function sent(mock: ReturnType<typeof vi.fn>, index = 0): Request {
  return (mock.mock.calls[index] as [Request])[0]
}

function query(mock: ReturnType<typeof vi.fn>, index = 0): Record<string, string> {
  return Object.fromEntries(new URL(sent(mock, index).url).searchParams)
}

async function body(mock: ReturnType<typeof vi.fn>, index = 0): Promise<unknown> {
  return JSON.parse(await sent(mock, index).text())
}

async function content(res: Response): Promise<unknown> {
  return ((await res.json()) as { content: unknown }).content
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('List 出全部 37 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(googlecalendarActions).length)
    expect(tools).toHaveLength(37)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报成单个 tools/v1 export,并带上与上游一致的 oauth 声明', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const described = (await res.json()) as {
      exports: Array<{
        credentialFields?: unknown
        credentialProbe?: unknown
        id: string
        oauth?: Record<string, unknown>
        profile: string
      }>
    }
    expect(described.exports).toHaveLength(1)
    const [entry] = described.exports
    expect(entry).toMatchObject({ id: 'actions', profile: 'tools/v1' })
    expect(entry?.oauth).toEqual({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.calendars',
        'https://www.googleapis.com/auth/calendar.calendarlist',
        'https://www.googleapis.com/auth/calendar.settings.readonly',
        'https://www.googleapis.com/auth/calendar.acls',
        'https://www.googleapis.com/auth/calendar.acls.readonly',
      ],
      clientAuth: 'client_secret_post',
      // Google 只在 access_type=offline 时下发 refresh_token;prompt=consent 保证重复授权
      // 也重新下发。少任何一个,令牌过期后就刷不回来了。
      authorizationParams: { access_type: 'offline', prompt: 'consent' },
    })
    // oauth 与这两者互斥(SDK 侧当场拒),这里钉住"确实一个都没声明"。
    expect(entry?.credentialProbe).toBeUndefined()
    expect(entry?.credentialFields).toBeUndefined()
  })
})

describe('请求拼装', () => {
  it('list_events:凭证走 Bearer 头,GET 无请求体,eventTypes 数组展开成重复同名参数', async () => {
    const mock = mockCalendar([200, { items: [] }])
    await call('list_events', {
      calendarId: 'primary',
      q: 'standup',
      timeMin: '2026-08-13T00:00:00Z',
      timeMax: '2026-08-14T00:00:00Z',
      singleEvents: true,
      maxResults: 10,
      eventTypes: ['default', 'birthday'],
    })

    const request = sent(mock)
    const url = new URL(request.url)
    expect(request.method).toBe('GET')
    expect(url.origin + url.pathname).toBe(`${API_BASE}/calendars/primary/events`)
    expect(request.headers.get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(await request.text()).toBe('')
    expect(url.searchParams.getAll('eventTypes')).toEqual(['default', 'birthday'])
    expect(query(mock)).toMatchObject({
      q: 'standup',
      timeMin: '2026-08-13T00:00:00Z',
      timeMax: '2026-08-14T00:00:00Z',
      singleEvents: 'true',
      maxResults: '10',
    })
  })

  it('calendarId 逐段编码进路径(带 / 的日历 id 不会拐去别的资源)', async () => {
    const mock = mockCalendar([200, { id: 'x' }])
    await call('get_calendar', { calendarId: 'a/b@group.calendar.google.com' })
    expect(new URL(sent(mock).url).pathname)
      .toBe('/calendar/v3/calendars/a%2Fb%40group.calendar.google.com')
  })

  it('create_event:全天与带时区两种时间形态都原样透传,开关参数由 body 反推', async () => {
    const allDay = mockCalendar([200, { id: 'e1', status: 'confirmed' }])
    await call('create_event', {
      calendarId: 'primary',
      event: {
        summary: '休假',
        start: { date: '2026-08-13' },
        end: { date: '2026-08-14' },
      },
    })
    expect(sent(allDay).method).toBe('POST')
    await expect(body(allDay)).resolves.toEqual({
      summary: '休假',
      start: { date: '2026-08-13' },
      end: { date: '2026-08-14' },
    })
    // 没有 conferenceData / attachments 就不该出现那两个开关。
    expect(query(allDay)).toEqual({})

    vi.unstubAllGlobals()
    const timed = mockCalendar([200, { id: 'e2', status: 'confirmed' }])
    await call('create_event', {
      calendarId: 'primary',
      event: {
        summary: '评审',
        start: { dateTime: '2026-08-13T10:00:00+09:00', timeZone: 'Asia/Tokyo' },
        end: { dateTime: '2026-08-13T11:00:00+09:00', timeZone: 'Asia/Tokyo' },
        conferenceData: { createRequest: { requestId: 'r1' } },
        attachments: [{ fileUrl: 'https://example.test/a.pdf' }],
      },
    })
    await expect(body(timed)).resolves.toMatchObject({
      start: { dateTime: '2026-08-13T10:00:00+09:00', timeZone: 'Asia/Tokyo' },
      end: { dateTime: '2026-08-13T11:00:00+09:00', timeZone: 'Asia/Tokyo' },
    })
    // 少了这两个参数,Google 会静默丢掉 conferenceData 与 attachments。
    expect(query(timed)).toEqual({ conferenceDataVersion: '1', supportsAttachments: 'true' })
  })

  it('update_event:先 GET 再 PUT,只发白名单字段,且沿用的 conferenceData/source 被二次收窄', async () => {
    const mock = mockCalendar(
      [200, {
        id: 'e1',
        status: 'confirmed',
        summary: '旧标题',
        etag: '"abc"',
        kind: 'calendar#event',
        htmlLink: 'https://calendar.google.test/e1',
        start: { dateTime: '2026-08-13T10:00:00Z' },
        end: { dateTime: '2026-08-13T11:00:00Z' },
        conferenceData: {
          conferenceId: 'c1',
          notes: 'n',
          signature: '只读字段',
          entryPoints: [{ entryPointType: 'video' }],
        },
        source: { url: 'https://example.test', title: 'T', extraneous: '只读字段' },
      }],
      [200, { id: 'e1', status: 'confirmed', summary: '新标题' }],
    )
    await call('update_event', { calendarId: 'primary', eventId: 'e1', event: { summary: '新标题' } })

    expect(sent(mock, 0).method).toBe('GET')
    expect(sent(mock, 1).method).toBe('PUT')
    await expect(body(mock, 1)).resolves.toEqual({
      summary: '新标题',
      status: 'confirmed',
      start: { dateTime: '2026-08-13T10:00:00Z' },
      end: { dateTime: '2026-08-13T11:00:00Z' },
      // 只读子字段被剥掉:原样 PUT 回去 Google 会 400。
      conferenceData: { conferenceId: 'c1', notes: 'n', entryPoints: [{ entryPointType: 'video' }] },
      source: { url: 'https://example.test', title: 'T' },
    })
    expect(query(mock, 1)).toEqual({ conferenceDataVersion: '1' })
  })

  it('sync_events:带 syncToken 时只发同步模式的参数,并强制 showDeleted=true', async () => {
    const mock = mockCalendar([200, { items: [], nextSyncToken: 'tok2' }])
    await call('sync_events', {
      calendarId: 'primary',
      syncToken: 'tok1',
      maxResults: 50,
      // 这三个在增量同步模式下必须被丢掉 —— Google 不接受它们与 syncToken 同时出现。
      q: 'standup',
      timeMin: '2026-08-13T00:00:00Z',
      orderBy: 'startTime',
    })
    expect(query(mock)).toEqual({ syncToken: 'tok1', maxResults: '50', showDeleted: 'true' })
  })

  it('sync_events:没给 syncToken 时退回普通列表查询(过滤参数照发)', async () => {
    const mock = mockCalendar([200, { items: [] }])
    await call('sync_events', { calendarId: 'primary', q: 'standup', timeMin: '2026-08-13T00:00:00Z' })
    expect(query(mock)).toEqual({ q: 'standup', timeMin: '2026-08-13T00:00:00Z' })
  })

  it('quick_add_event 的文本走 query 而不是 body;move_event 的目标走 destination', async () => {
    const quick = mockCalendar([200, { id: 'e1', status: 'confirmed' }])
    await call('quick_add_event', { calendarId: 'primary', text: '明天十点和 A 喝咖啡' })
    expect(new URL(sent(quick).url).pathname).toBe('/calendar/v3/calendars/primary/events/quickAdd')
    expect(query(quick)).toEqual({ text: '明天十点和 A 喝咖啡' })
    expect(await sent(quick).text()).toBe('')

    vi.unstubAllGlobals()
    const move = mockCalendar([200, { id: 'e1', status: 'confirmed' }])
    await call('move_event', { calendarId: 'primary', eventId: 'e1', destinationCalendarId: 'team@x' })
    expect(query(move)).toEqual({ destination: 'team@x' })
  })

  it('list_acl 的 maxResults 有本地默认值 100,list_settings 没有默认值', async () => {
    const acl = mockCalendar([200, { items: [] }])
    await call('list_acl', { calendarId: 'primary' })
    expect(query(acl)).toEqual({ maxResults: '100' })

    vi.unstubAllGlobals()
    const settings = mockCalendar([200, { items: [] }])
    await call('list_settings', {})
    expect(query(settings)).toEqual({})
  })

  it('patch_calendar_list_entry 只发白名单字段;create_calendar 的可写字段铺在入参顶层', async () => {
    const entry = mockCalendar([200, { id: 'primary', summary: 'S', accessRole: 'owner' }])
    await call('patch_calendar_list_entry', {
      calendarId: 'primary',
      entry: { hidden: true, backgroundColor: '#123456' },
    })
    expect(sent(entry).method).toBe('PATCH')
    expect(new URL(sent(entry).url).pathname).toBe('/calendar/v3/users/me/calendarList/primary')
    await expect(body(entry)).resolves.toEqual({ hidden: true, backgroundColor: '#123456' })

    vi.unstubAllGlobals()
    const created = mockCalendar([200, { id: 'c1', summary: '新日历' }])
    await call('create_calendar', { summary: '新日历', timeZone: 'Asia/Tokyo' })
    await expect(body(created)).resolves.toEqual({ summary: '新日历', timeZone: 'Asia/Tokyo' })
  })

  it('删除类 action 回 204 空体,出参统一是 { success: true }', async () => {
    const mock = mockCalendar([204, null])
    const res = await call('delete_acl_rule', { calendarId: 'primary', ruleId: 'user:a@x' })
    expect(sent(mock).method).toBe('DELETE')
    expect(new URL(sent(mock).url).pathname).toBe('/calendar/v3/calendars/primary/acl/user%3Aa%40x')
    await expect(content(res)).resolves.toEqual({ success: true })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:maxResults 越界 → 400 且不打上游', async () => {
    const mock = mockCalendar([200, {}])
    const res = await call('list_events', { calendarId: 'primary', maxResults: 5000 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('纯空白的 calendarId 能过 Zod 的 min(1),但在本地就挡下(否则会打出一个必然 404 的请求)', async () => {
    const mock = mockCalendar([200, {}])
    const res = await call('get_calendar', { calendarId: '   ' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('calendarId')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游 4xx → invalid_argument,5xx → unavailable + retryable,消息取自 error.message', async () => {
    mockCalendar([400, { error: { code: 400, message: 'Invalid timeMin' } }])
    const bad = await call('list_events', { calendarId: 'primary' })
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({ code: 'invalid_argument', message: 'Invalid timeMin' })

    vi.unstubAllGlobals()
    mockCalendar([500, { error: { code: 500, message: 'Backend Error' } }])
    await expect((await call('list_events', { calendarId: 'primary' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    mockCalendar([404, { error: { code: 404, message: 'Not Found' } }])
    expect((await call('get_event', { calendarId: 'primary', eventId: 'nope' })).status).toBe(404)
  })

  it('403 身兼两职:配额耗尽 → rate_limited + retryable,权限不足 → permission_denied 不可重试', async () => {
    mockCalendar([403, {
      error: {
        code: 403,
        message: 'Calendar usage limits exceeded.',
        errors: [{ domain: 'usageLimits', reason: 'quotaExceeded' }],
      },
    }])
    const limited = await call('list_events', { calendarId: 'primary' })
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockCalendar([403, {
      error: {
        code: 403,
        message: 'Request had insufficient authentication scopes.',
        errors: [{ domain: 'global', reason: 'insufficientPermissions' }],
      },
    }])
    const denied = await call('list_events', { calendarId: 'primary' })
    expect(denied.status).toBe(403)
    await expect(denied.json()).resolves.toMatchObject({ code: 'permission_denied', retryable: false })
  })

  it('syncToken 过期(410)改写成"去掉 syncToken 重做全量同步"的指引', async () => {
    mockCalendar([410, { error: { code: 410, message: 'Sync token is no longer valid' } }])
    const res = await call('list_events', { calendarId: 'primary', syncToken: 'stale' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument', retryable: false })
    expect(((await (await call('list_events', { calendarId: 'primary', syncToken: 'stale' })).json()) as {
      message: string
    }).message).toContain('syncToken')
  })

  it('非 JSON 的成功响应归 unavailable(上游违约),不当成空结果', async () => {
    const fn = vi.fn(() => Promise.resolve(new Response('<html>oops</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })))
    vi.stubGlobal('fetch', fn)
    await expect((await call('get_colors', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockCalendar([200, {}])
    const res = await call('list_calendars', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })

  it('delete_event 把 404 当成删除成功(删除是幂等的)', async () => {
    mockCalendar([404, { error: { code: 404, message: 'Not Found' } }])
    const res = await call('delete_event', { calendarId: 'primary', eventId: 'gone' })
    expect(res.status).toBe(200)
    await expect(content(res)).resolves.toEqual({ success: true })

    // 同样的 404 落在 get_event 上仍然是 not_found —— 幂等只对删除成立。
    vi.unstubAllGlobals()
    mockCalendar([404, { error: { code: 404, message: 'Not Found' } }])
    expect((await call('get_event', { calendarId: 'primary', eventId: 'gone' })).status).toBe(404)
  })
})

describe('remove_attendee', () => {
  const eventPayload = {
    id: 'e1',
    status: 'confirmed',
    attendees: [
      { email: 'A@X.com', displayName: 'A', id: '只读字段', self: true },
      { email: 'b@x', responseStatus: 'accepted' },
    ],
  }

  it('邮箱比对不区分大小写,回写时把 attendee 收窄到可写字段', async () => {
    const mock = mockCalendar([200, eventPayload], [200, { id: 'e1', status: 'confirmed' }])
    await call('remove_attendee', { eventId: 'e1', attendeeEmail: 'a@x.COM' })

    // calendarId 缺省是 primary。
    expect(new URL(sent(mock, 0).url).pathname).toBe('/calendar/v3/calendars/primary/events/e1')
    expect(sent(mock, 1).method).toBe('PATCH')
    await expect(body(mock, 1)).resolves.toEqual({
      attendees: [{ email: 'b@x', responseStatus: 'accepted' }],
    })
  })

  it('参会人不在事件里 → invalid_argument,且不发出那次 PATCH', async () => {
    const mock = mockCalendar([200, eventPayload])
    const res = await call('remove_attendee', { eventId: 'e1', attendeeEmail: 'nobody@x' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
    expect(mock).toHaveBeenCalledTimes(1)
  })
})

describe('find_free_slots', () => {
  const TIME_MIN = '2026-08-13T00:00:00Z'
  const TIME_MAX = '2026-08-13T12:00:00Z'

  it('忙区间先裁剪到窗内再合并重叠,空档由合并结果推出', async () => {
    mockCalendar([200, {
      kind: 'calendar#freeBusy',
      timeMin: TIME_MIN,
      timeMax: TIME_MAX,
      calendars: {
        'a@x': {
          busy: [
            // 起点越界:要被裁到窗起点,且呈现成窗边界的字符串。
            { start: '2026-08-12T23:00:00Z', end: '2026-08-13T02:00:00Z' },
            { start: '2026-08-13T01:00:00Z', end: '2026-08-13T03:00:00Z' },
            // 倒挂区间直接丢掉。
            { start: '2026-08-13T09:00:00Z', end: '2026-08-13T08:00:00Z' },
          ],
        },
      },
    }])
    const res = await call('find_free_slots', { items: ['a@x'], timeMin: TIME_MIN, timeMax: TIME_MAX })
    await expect(content(res)).resolves.toEqual({
      kind: 'calendar#freeBusy',
      timeMin: TIME_MIN,
      timeMax: TIME_MAX,
      calendars: {
        'a@x': {
          busy: [{ start: TIME_MIN, end: '2026-08-13T03:00:00Z' }],
          free: [{ start: '2026-08-13T03:00:00Z', end: TIME_MAX }],
          isReliable: true,
        },
      },
    })
  })

  it('三种不可信来源都把 free 清空:日历自己报错、整个缺席、group 报错波及', async () => {
    mockCalendar([200, {
      kind: 'calendar#freeBusy',
      timeMin: TIME_MIN,
      timeMax: TIME_MAX,
      calendars: {
        'denied@x': { busy: [], errors: [{ domain: 'calendar', reason: 'notFound' }] },
        'derived@x': { busy: [{ start: '2026-08-13T01:00:00Z', end: '2026-08-13T02:00:00Z' }] },
      },
      groups: { g1: { calendars: ['derived@x'], errors: [{ reason: 'cannotExpandGroup' }] } },
    }])
    const res = await call('find_free_slots', {
      items: ['denied@x', 'absent@x', 'g1'],
      timeMin: TIME_MIN,
      timeMax: TIME_MAX,
    })
    const result = (await content(res)) as { calendars: Record<string, unknown> }

    expect(result.calendars['denied@x']).toEqual({
      busy: [],
      free: [],
      isReliable: false,
      errors: [{ code: 'notFound', message: 'calendar returned error: notFound' }],
    })
    // 点名要了却没出现在响应里 —— 沉默不能当成"这天全空"。
    expect(result.calendars['absent@x']).toEqual({
      busy: [],
      free: [],
      isReliable: false,
      errors: [{ code: 'provider_error', message: 'calendar missing from freeBusy response' }],
    })
    // 从 group 展开出来的日历:自己没报错,但所属 group 报错了,同样不可信。
    expect(result.calendars['derived@x']).toEqual({
      busy: [{ start: '2026-08-13T01:00:00Z', end: '2026-08-13T02:00:00Z' }],
      free: [],
      isReliable: false,
      errors: [{
        code: 'provider_error',
        message: 'calendar reliability is degraded by group error: cannotExpandGroup',
      }],
    })
    // group id 本身不是日历,不出现在出参里。
    expect(Object.keys(result.calendars).sort()).toEqual(['absent@x', 'denied@x', 'derived@x'])
  })

  it('group 展开数量顶格视为被截断:日历本身没问题也标成不可信', async () => {
    mockCalendar([200, {
      calendars: { 'derived@x': { busy: [] } },
      groups: { g1: { calendars: ['derived@x'] } },
    }])
    const res = await call('find_free_slots', {
      items: ['g1'],
      timeMin: TIME_MIN,
      timeMax: TIME_MAX,
      groupExpansionMax: 1,
    })
    const result = (await content(res)) as { calendars: Record<string, unknown>, kind: string }
    // 上游没回 kind 时兜底。
    expect(result.kind).toBe('calendar#freeBusy')
    expect(result.calendars['derived@x']).toEqual({
      busy: [],
      free: [],
      isReliable: false,
      errors: [{
        code: 'provider_error',
        message: 'calendar reliability is degraded by group expansion limits',
      }],
    })
  })

  it('free_busy_query 原样透出上游结果,且 items 的两种形态都规范成 { id }', async () => {
    const mock = mockCalendar([200, { kind: 'calendar#freeBusy', calendars: { 'a@x': { busy: [] } } }])
    const res = await call('free_busy_query', {
      items: [{ id: 'a@x' }],
      timeMin: TIME_MIN,
      timeMax: TIME_MAX,
    })
    await expect(body(mock)).resolves.toEqual({
      items: [{ id: 'a@x' }],
      timeMin: TIME_MIN,
      timeMax: TIME_MAX,
      timeZone: 'UTC',
      groupExpansionMax: 100,
      calendarExpansionMax: 50,
    })
    await expect(content(res)).resolves.toEqual({
      kind: 'calendar#freeBusy',
      calendars: { 'a@x': { busy: [] } },
    })
  })
})

describe('list_events_all_calendars', () => {
  const TIME_MIN = '2026-08-13T00:00:00Z'
  const TIME_MAX = '2026-08-14T00:00:00Z'

  it('不给 calendarIds:先列可见日历再逐个查,部分失败进 errorsByCalendar 而不是整体失败', async () => {
    const mock = mockCalendar(
      [200, {
        items: [
          { id: 'a@x', summary: 'A', primary: true, accessRole: 'owner', timeZone: 'UTC' },
          { id: 'b@x', summary: 'B', accessRole: 'reader' },
        ],
      }],
      [200, {
        items: [{
          id: 'e1',
          status: 'confirmed',
          summary: '评审',
          start: { dateTime: '2026-08-13T10:00:00Z' },
          end: { dateTime: '2026-08-13T11:00:00Z' },
        }],
      }],
      [403, { error: { code: 403, message: 'Forbidden', errors: [{ reason: 'forbidden' }] } }],
    )
    const res = await call('list_events_all_calendars', { timeMin: TIME_MIN, timeMax: TIME_MAX })
    const result = (await content(res)) as {
      calendarsQueried: unknown[]
      errorsByCalendar: Record<string, unknown>
      events: Array<Record<string, unknown>>
      summaryView: unknown[]
    }

    expect(new URL(sent(mock, 0).url).pathname).toBe('/calendar/v3/users/me/calendarList')
    expect(query(mock, 0)).toEqual({ showHidden: 'false', showDeleted: 'false' })
    // singleEvents 默认 true、每个日历默认取 250 条。
    expect(query(mock, 1)).toMatchObject({
      timeMin: TIME_MIN,
      timeMax: TIME_MAX,
      timeZone: 'UTC',
      singleEvents: 'true',
      maxResults: '250',
    })

    expect(result.events).toHaveLength(1)
    // 聚合出来的事件必须带来源,否则调用方分不清它属于哪个日历。
    expect(result.events[0]?.sourceCalendar).toEqual({
      calendarId: 'a@x',
      summary: 'A',
      primary: true,
      accessRole: 'owner',
    })
    expect(result.errorsByCalendar).toEqual({ 'b@x': { code: 'forbidden', message: 'Forbidden' } })
    expect(result.calendarsQueried).toEqual([
      { calendarId: 'a@x', summary: 'A', primary: true, accessRole: 'owner' },
      { calendarId: 'b@x', summary: 'B', accessRole: 'reader' },
    ])
    expect(result.summaryView).toEqual([{
      calendarId: 'a@x',
      calendarSummary: 'A',
      eventId: 'e1',
      summary: '评审',
      start: { dateTime: '2026-08-13T10:00:00Z' },
      end: { dateTime: '2026-08-13T11:00:00Z' },
      allDay: false,
      status: 'confirmed',
    }])
  })

  it('401 立刻整体上抛,不对着同一个坏令牌把剩下的日历再撞一遍', async () => {
    const mock = mockCalendar(
      [200, { items: [{ id: 'a@x', summary: 'A' }, { id: 'b@x', summary: 'B' }] }],
      [401, { error: { code: 401, message: 'Invalid Credentials' } }],
    )
    const res = await call('list_events_all_calendars', { timeMin: TIME_MIN, timeMax: TIME_MAX })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ code: 'permission_denied' })
    // calendarList + 第一个日历,没有第二个日历那一跳。
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('所有日历都失败才抛错,错误沿用第一个可恢复错误', async () => {
    mockCalendar([404, { error: { code: 404, message: 'Not Found' } }])
    const res = await call('list_events_all_calendars', {
      calendarIds: ['a@x', 'b@x'],
      timeMin: TIME_MIN,
      timeMax: TIME_MAX,
    })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ code: 'not_found' })
  })

  it('calendarIds: [] 是"一个都不查",不是"查全部"', async () => {
    const mock = mockCalendar([200, { items: [] }])
    const res = await call('list_events_all_calendars', {
      calendarIds: [],
      timeMin: TIME_MIN,
      timeMax: TIME_MAX,
    })
    await expect(content(res)).resolves.toEqual({
      events: [],
      summaryView: [],
      calendarsQueried: [],
      errorsByCalendar: {},
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('全天事件按各自日历的时区排序(东京的今天早于洛杉矶的今天)', async () => {
    mockCalendar(
      [200, {
        items: [
          { id: 'la@x', summary: 'LA', timeZone: 'America/Los_Angeles' },
          { id: 'tokyo@x', summary: 'Tokyo', timeZone: 'Asia/Tokyo' },
        ],
      }],
      [200, { items: [{ id: 'la-event', status: 'confirmed', start: { date: '2026-08-13' }, end: { date: '2026-08-14' } }] }],
      [200, { items: [{ id: 'tokyo-event', status: 'confirmed', start: { date: '2026-08-13' }, end: { date: '2026-08-14' } }] }],
    )
    const res = await call('list_events_all_calendars', { timeMin: TIME_MIN, timeMax: TIME_MAX })
    const result = (await content(res)) as { events: Array<{ id: string }>, summaryView: Array<{ allDay: boolean }> }
    // 若按调用侧的 UTC 一刀切,两者会打平并退化成按 calendarId 排(la@x 在前),
    // 那正是这条用例要挡下的迁移错误。
    expect(result.events.map(event => event.id)).toEqual(['tokyo-event', 'la-event'])
    expect(result.summaryView.every(item => item.allDay)).toBe(true)
  })

  it('翻页取到 maxResultsPerCalendar 就停,第二页带上 pageToken', async () => {
    const mock = mockCalendar(
      [200, { items: [{ id: 'e1', status: 'confirmed' }, { id: 'e2', status: 'confirmed' }], nextPageToken: 'p2' }],
      [200, { items: [{ id: 'e3', status: 'confirmed' }, { id: 'e4', status: 'confirmed' }], nextPageToken: 'p3' }],
    )
    const res = await call('list_events_all_calendars', {
      calendarIds: ['a@x'],
      timeMin: TIME_MIN,
      timeMax: TIME_MAX,
      maxResultsPerCalendar: 3,
    })
    const result = (await content(res)) as { events: Array<{ id: string }> }
    expect(query(mock, 1)).toMatchObject({ pageToken: 'p2', maxResults: '3' })
    // 第二页多回来的那条要被截掉,而不是让结果超过上限。
    expect(result.events.map(event => event.id)).toEqual(['e1', 'e2', 'e3'])
    expect(mock).toHaveBeenCalledTimes(2)
  })
})
