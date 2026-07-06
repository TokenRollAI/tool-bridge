import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import pkg from '../package.json' with { type: 'json' }

// 穿透测试(DOD.md:27):HTTP 进 → Worker 出,断言 Phase 0 四条对外行为。

describe('GET /healthz', () => {
  it('200 + JSON {healthy:true, version}(DOD.md:40)', async () => {
    const res = await SELF.fetch('https://tb.test/healthz')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = (await res.json()) as { healthy: boolean; version: string }
    expect(body.healthy).toBe(true)
    expect(body.version).toBe(pkg.version)
  })
})

describe('GET /~help(根占位)', () => {
  it('200 + text/plain,首行为 htbp 0.1,空树无 cmd 行(Proto §1.1-1.3)', async () => {
    const res = await SELF.fetch('https://tb.test/~help')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    const text = await res.text()
    const lines = text.split('\n').filter((l) => l.length > 0)
    expect(lines[0]).toBe('htbp 0.1')
    // 空树:除首行外无 node/cmd 行
    expect(lines).toEqual(['htbp 0.1'])
  })
})

describe('保留段占位 → 501 TBError', () => {
  it.each([
    '/~tree',
    '/~skill',
    '/~register',
    '/~describe',
  ])('GET %s → 501,body code=unavailable,retryable=false', async (path) => {
    const res = await SELF.fetch(`https://tb.test${path}`)
    expect(res.status).toBe(501)
    const body = (await res.json()) as { code: string; retryable: boolean }
    expect(body.code).toBe('unavailable')
    expect(body.retryable).toBe(false)
  })
})

describe('兜底 → 404 TBError', () => {
  it('未知路径 → 404,body code=not_found,retryable=false', async () => {
    const res = await SELF.fetch('https://tb.test/does/not/exist')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = (await res.json()) as { code: string; retryable: boolean; message: string }
    expect(body.code).toBe('not_found')
    expect(body.retryable).toBe(false)
    expect(typeof body.message).toBe('string')
  })
})
