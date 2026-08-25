import { describe, expect, it } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createResendPlugin } from '../../src/resend/index'

/**
 * Resend 迁移产物的 wire 级验收。重点在**手写豁免路径**:
 * 那条 Zod 无法反推进 JSON Schema 的"正文二选一"约束,运行期必须真的拦得住。
 */

const API_KEY = 're_test_key'
const plugin = createResendPlugin()

const { call: callProvider, mockJson: mockResend } = createProviderHarness({
  mountPath: 'mail/resend',
  plugin,
  upstreamAuth: API_KEY,
})

function call(args: unknown, opts: { auth?: string | null } = {}): Promise<Response> {
  return callProvider('send_email', args, opts)
}

const VALID = {
  from: 'ada@example.com',
  to: 'grace@example.com',
  subject: 'Hello',
  html: '<p>Hi</p>',
}

describe('resend(手写 schema 豁免路径)', () => {
  it('发送成功:返回 emailId', async () => {
    const mock = mockResend(200, { id: 'email_123' })
    const res = await call(VALID)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ content: { emailId: 'email_123' } })

    const request = (mock.mock.calls[0] as [Request])[0]
    expect(request.url).toBe('https://api.resend.com/emails')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    await expect(request.json()).resolves.toEqual(VALID)
  })

  it('只给 text 也放行(二选一,不是必须 html)', async () => {
    mockResend(200, { id: 'email_456' })
    const res = await call({ ...VALID, html: undefined, text: 'Hi' })
    expect(res.status).toBe(200)
  })

  it('html 与 text 都不给 → 400,且不打上游(手写 refine 真的生效)', async () => {
    const mock = mockResend(200, { id: 'x' })
    const res = await call({ from: VALID.from, to: VALID.to, subject: VALID.subject })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('invalid_argument')
    expect(body.message).toContain('at least one of html or text')
    expect(mock).not.toHaveBeenCalled()
  })

  it('必填字段缺失 → 400', async () => {
    const mock = mockResend(200, { id: 'x' })
    expect((await call({ to: VALID.to, subject: 'x', text: 'x' })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('Resend 的稳定错误名优先于 HTTP 状态:invalid_api_key → 401', async () => {
    // Resend 对无效 key 回 403,但错误名是权威的。
    mockResend(403, { name: 'invalid_api_key', message: 'API key is invalid' })
    const res = await call(VALID)
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'API key is invalid',
    })
  })

  it('没有稳定错误名时退回状态码归一', async () => {
    mockResend(429, { message: 'Too many requests' })
    await expect((await call(VALID)).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('成功响应没带 id → unavailable(不假装成功)', async () => {
    mockResend(200, {})
    expect((await call(VALID)).status).toBe(503)
  })

  it('没配 authRef → unavailable 且不打上游', async () => {
    const mock = mockResend(200, { id: 'x' })
    const res = await call(VALID, { auth: null })
    expect(res.status).toBe(503)
    expect(mock).not.toHaveBeenCalled()
  })
})
