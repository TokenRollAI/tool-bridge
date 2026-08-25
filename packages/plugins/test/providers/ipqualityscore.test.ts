import { describe, expect, it, vi } from 'vitest'
import { createIpqualityscorePlugin } from '../../src/ipqualityscore/index'
import { ipqualityscoreActions } from '../../src/ipqualityscore/schema'
import { createProviderHarness } from '../support/providerHarness'

/**
 * IPQualityScore 迁移产物的 wire 级验收。重点在几个"迁移最容易迁丢"的地方:
 * API key 拼在**路径**里(不是 header)、可选参数省略而非传空、`country[]` 重复键与大写化、
 * 以及 IPQS 那条"HTTP 200 + success:false 也是失败"的分支。
 */

const API_KEY = 'ipqs_test_key'
const plugin = createIpqualityscorePlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockIpqs,
} = createProviderHarness({
  mountPath: 'security/ipqualityscore',
  plugin,
  upstreamAuth: API_KEY,
})

describe('契约面', () => {
  it('List 出全部 4 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(ipqualityscoreActions).length)
    expect(tools).toHaveLength(4)
    expect(tools.map(t => t.name)).toEqual([
      'check_ip_reputation',
      'validate_email',
      'validate_phone',
      'scan_url',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('URL 组装(IPQS 把 API key 拼在路径里)', () => {
  it('check_ip_reputation:family/apiKey/value 三段路径 + 可选参数进 query', async () => {
    const mock = mockIpqs(200, { success: true, message: 'Success.', fraud_score: 12 })
    const res = await call('check_ip_reputation', {
      ipAddress: '8.8.8.8',
      strictness: 2,
      allowPublicAccessPoints: true,
      userAgent: 'Mozilla/5.0',
      userLanguage: 'en-US',
    })

    const request = sent(mock)
    expect(request.method).toBe('GET')
    const url = new URL(request.url)
    expect(url.origin).toBe('https://www.ipqualityscore.com')
    expect(url.pathname).toBe(`/api/json/ip/${API_KEY}/8.8.8.8`)
    expect(url.searchParams.get('strictness')).toBe('2')
    expect(url.searchParams.get('allow_public_access_points')).toBe('true')
    expect(url.searchParams.get('user_agent')).toBe('Mozilla/5.0')
    expect(url.searchParams.get('user_language')).toBe('en-US')
    // 凭证只在路径里,不该另外冒出 authorization 头。
    expect(request.headers.get('authorization')).toBeNull()
    expect(request.headers.get('accept')).toBe('application/json')
    await expect(res.json()).resolves.toMatchObject({
      content: { success: true, fraud_score: 12 },
    })
  })

  it('省略的可选参数不出现在 query 里', async () => {
    const mock = mockIpqs(200, { success: true, message: 'Success.', fraud_score: 0 })
    await call('check_ip_reputation', { ipAddress: '1.1.1.1' })
    const url = new URL(sent(mock).url)
    expect([...url.searchParams.keys()]).toEqual([])
  })

  it('validate_phone:country 是重复的 country[] 且大写化', async () => {
    const mock = mockIpqs(200, { success: true, message: 'Success.', valid: true })
    await call('validate_phone', { phone: '+1 555 0100', country: ['us', 'Ca'], strictness: 1 })

    const url = new URL(sent(mock).url)
    // 电话号里的空格与加号必须编码进路径段,不能生出第二个路径层级。
    expect(url.pathname).toBe(`/api/json/phone/${API_KEY}/%2B1%20555%200100`)
    expect(url.searchParams.getAll('country[]')).toEqual(['US', 'CA'])
    expect(url.searchParams.get('strictness')).toBe('1')
  })

  it('scan_url:待扫描的 URL 整体作为一个路径段编码', async () => {
    const mock = mockIpqs(200, { success: true, message: 'Success.', unsafe: false })
    await call('scan_url', { url: 'https://example.com/a?b=c' })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe(`/api/json/url/${API_KEY}/https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc`)
  })

  it('validate_email:timeout / abuse_strictness 用上游的 snake_case 参数名', async () => {
    const mock = mockIpqs(200, { success: true, message: 'Success.', valid: true })
    await call('validate_email', { email: 'ada@example.com', timeout: 7, abuseStrictness: 3 })
    const url = new URL(sent(mock).url)
    expect(url.pathname).toBe(`/api/json/email/${API_KEY}/ada%40example.com`)
    expect(url.searchParams.get('timeout')).toBe('7')
    expect(url.searchParams.get('abuse_strictness')).toBe('3')
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:email 不合法 → 400 且不打上游', async () => {
    const mock = mockIpqs(200, {})
    const res = await call('validate_email', { email: 'not-an-email' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('strictness 超出 0..3 → 400 且不打上游', async () => {
    const mock = mockIpqs(200, {})
    const res = await call('check_ip_reputation', { ipAddress: '8.8.8.8', strictness: 9 })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('ipAddress 不是 IP 字面量 → 400 且不打上游(schema 只要求非空)', async () => {
    const mock = mockIpqs(200, {})
    const res = await call('check_ip_reputation', { ipAddress: 'example.com' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('ipAddress')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 IPQS 的 message', async () => {
    mockIpqs(401, { success: false, message: 'Invalid or expired API key.' })
    const denied = await call('scan_url', { url: 'https://example.com' })
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid or expired API key.',
    })

    mockIpqs(429, { success: false, message: 'Too many requests.' })
    const limited = await call('scan_url', { url: 'https://example.com' })
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockIpqs(500, { success: false, message: 'IPQS is down' })
    await expect((await call('scan_url', { url: 'https://example.com' })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('HTTP 200 + success:false 也是失败,且按文案归类(IPQS 的主要失败路径)', async () => {
    // 这条文案同时含 "api key" 与 "insufficient credits":必须判成可重试的限流,
    // 归成 permission_denied 会让调用方放弃重试。
    mockIpqs(200, { success: false, message: 'Your API key has insufficient credits.' })
    const credits = await call('validate_email', { email: 'ada@example.com' })
    expect(credits.status).toBe(429)
    await expect(credits.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    mockIpqs(200, { success: false, message: 'Invalid API key.' })
    expect((await call('validate_email', { email: 'ada@example.com' })).status).toBe(401)

    mockIpqs(200, { success: false, message: 'Invalid IP address.' })
    expect((await call('check_ip_reputation', { ipAddress: '8.8.8.8' })).status).toBe(400)
  })

  it('响应不是 JSON 对象 → unavailable(契约破了,不是调用方的错)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('gateway timeout', { status: 200 }))))
    const res = await call('scan_url', { url: 'https://example.com' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockIpqs(200, {})
    const res = await call('scan_url', { url: 'https://example.com' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
