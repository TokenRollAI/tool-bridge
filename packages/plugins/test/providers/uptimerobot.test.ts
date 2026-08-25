import { describe, expect, it, vi } from 'vitest'
import { createUptimerobotPlugin } from '../../src/uptimerobot/index'
import { createProviderHarness } from '../support/providerHarness'
import { uptimerobotActions } from '../../src/uptimerobot/schema'

/**
 * UptimeRobot 迁移产物的 wire 级验收。重点在这个 API 的两处怪异:凭证走 form body
 * 而非请求头,以及"HTTP 200 + stat:'fail'"这种 body 内错误。
 */

const API_KEY = 'u123456-deadbeef'
const plugin = createUptimerobotPlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockUptimerobot,
} = createProviderHarness({
  mountPath: 'ops/uptimerobot',
  plugin,
  upstreamAuth: API_KEY,
})

async function sentForm(mock: ReturnType<typeof vi.fn>): Promise<URLSearchParams> {
  return new URLSearchParams(await sent(mock).text())
}

describe('契约面', () => {
  it('List 出全部 7 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(uptimerobotActions).length)
    expect(tools).toHaveLength(7)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('effect 播种值符合读写语义', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ effect?: string, name: string }>
    const effectOf = (name: string): string | undefined => tools.find(t => t.name === name)?.effect
    expect(effectOf('list_monitors')).toBe('read')
    expect(effectOf('get_account_details')).toBe('read')
    expect(effectOf('create_monitor')).toBe('write')
    expect(effectOf('delete_monitor')).toBe('destructive')
  })
})

describe('请求成形', () => {
  it('凭证与 format 走 form body(不是请求头),端点是 POST 固定路径', async () => {
    const mock = mockUptimerobot(200, { stat: 'ok', account: { email: 'a@example.com' } })
    const res = await call('get_account_details', {})

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.uptimerobot.com/v2/getAccountDetails')
    expect(request.headers.get('content-type')).toContain('application/x-www-form-urlencoded')
    expect(request.headers.get('authorization')).toBeNull()
    const form = await sentForm(mock)
    expect(form.get('api_key')).toBe(API_KEY)
    expect(form.get('format')).toBe('json')
    await expect(res.json()).resolves.toMatchObject({
      content: { account: { email: 'a@example.com' } },
    })
  })

  it('多值过滤器用连字符拼接,布尔编码成 1/0', async () => {
    const mock = mockUptimerobot(200, { stat: 'ok', monitors: [], limit: 50, offset: 0, total: 3 })
    const res = await call('list_monitors', {
      monitor_ids: [111, 222],
      types: [1, 2],
      statuses: [0, 9],
      logs: true,
      alert_contacts: false,
      limit: 50,
    })

    const form = await sentForm(mock)
    expect(form.get('monitors')).toBe('111-222')
    expect(form.get('types')).toBe('1-2')
    expect(form.get('statuses')).toBe('0-9')
    expect(form.get('logs')).toBe('1')
    expect(form.get('alert_contacts')).toBe('0')
    expect(form.get('limit')).toBe('50')
    await expect(res.json()).resolves.toMatchObject({
      content: { pagination: { limit: 50, offset: 0, total: 3 } },
    })
  })

  it('结构化 alert_contacts 编码成 id_threshold_recurrence', async () => {
    const mock = mockUptimerobot(200, { stat: 'ok', monitor: { id: 1 } })
    await call('create_monitor', {
      friendly_name: 'Site',
      url: 'https://example.com',
      type: 1,
      alert_contacts: [12345, { id: 67890, threshold: 5, recurrence: 2 }],
    })
    const form = await sentForm(mock)
    expect(form.get('alert_contacts')).toBe('12345_0_0-67890_5_2')
    expect(form.get('friendly_name')).toBe('Site')
    expect(form.has('sub_type')).toBe(false)
  })

  it('update_monitor 把 monitor_id 改名成 id 送出', async () => {
    const mock = mockUptimerobot(200, { stat: 'ok', monitor: { id: 7 } })
    await call('update_monitor', { monitor_id: 7, friendly_name: 'New' })
    const form = await sentForm(mock)
    expect(sent(mock).url).toBe('https://api.uptimerobot.com/v2/editMonitor')
    expect(form.get('id')).toBe('7')
    expect(form.has('monitor_id')).toBe(false)
  })

  it('三个分页字段都读不出时 pagination 为 null', async () => {
    mockUptimerobot(200, { stat: 'ok', alert_contacts: [] })
    const res = await call('list_alert_contacts', {})
    await expect(res.json()).resolves.toEqual({
      content: { alert_contacts: [], pagination: null },
    })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:monitor_id 给 0 → 400 且不打上游', async () => {
    const mock = mockUptimerobot(200, { stat: 'ok' })
    const res = await call('get_monitor', { monitor_id: 0 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('delete_monitor 缺 monitor_id → 400 且不打上游(schema 把它标成了可选)', async () => {
    const mock = mockUptimerobot(200, { stat: 'ok' })
    const res = await call('delete_monitor', {})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('monitor_id')
    expect(mock).not.toHaveBeenCalled()
  })

  it('HTTP 200 + stat:fail 也算失败,错误类型决定归一后的码', async () => {
    mockUptimerobot(200, { stat: 'fail', error: { type: 'invalid_api_key', message: 'api_key is invalid' } })
    const denied = await call('list_monitors', {})
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'api_key is invalid',
    })

    mockUptimerobot(200, { stat: 'fail', error: { type: 'rate_limit_exceeded', message: 'slow down' } })
    await expect((await call('list_monitors', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockUptimerobot(200, { stat: 'fail', error: { type: 'invalid_parameter', message: 'bad type' } })
    await expect((await call('list_monitors', {})).json())
      .resolves.toMatchObject({ code: 'invalid_argument' })
  })

  it('上游 HTTP 错误按状态归一', async () => {
    mockUptimerobot(401, { error: { message: 'unauthorized' } })
    expect((await call('list_monitors', {})).status).toBe(401)

    mockUptimerobot(429, { error: { message: 'too many requests' } })
    await expect((await call('list_monitors', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockUptimerobot(500, { error: { message: 'boom' } })
    await expect((await call('list_monitors', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('过滤器匹配不到监控 → 404(上游回的是 stat:ok + 空数组)', async () => {
    mockUptimerobot(200, { stat: 'ok', monitors: [] })
    const res = await call('get_monitor', { monitor_id: 999 })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ code: 'not_found' })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockUptimerobot(200, { stat: 'ok' })
    const res = await call('list_monitors', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
