import { describe, expect, it, vi } from 'vitest'
import { assertPublicHttpUrl, createGuardedFetch, EgressBlockedError } from '../../src/_runtime/guardedFetch'
import { classifyIpAddress, isIpAddress } from '../../src/_runtime/ipPolicy'

/**
 * 出站防线。内置插件与网关同进程跑,插件的 fetch 就是网关的 fetch —— 这层拦不住,
 * 一个上游 base URL 就能把网关变成 SSRF 跳板。
 */

describe('地址分类', () => {
  it.each([
    ['127.0.0.1', 'blocked'],
    ['10.1.2.3', 'blocked'],
    ['172.16.0.1', 'blocked'],
    ['172.32.0.1', 'public'],
    ['192.168.1.1', 'blocked'],
    ['169.254.169.254', 'blocked'],
    ['100.64.0.1', 'blocked'],
    ['0.0.0.0', 'blocked'],
    ['224.0.0.1', 'blocked'],
    ['8.8.8.8', 'public'],
    ['::1', 'blocked'],
    ['fe80::1', 'blocked'],
    ['fd00::1', 'blocked'],
    ['::ffff:127.0.0.1', 'blocked'],
    ['2606:4700:4700::1111', 'public'],
  ])('%s → %s', (address, expected) => {
    expect(classifyIpAddress(address)).toBe(expected)
  })

  it('前导零写法不被当成合法 IPv4(经典绕过手法:010 可能被解析成八进制)', () => {
    expect(isIpAddress('010.0.0.1')).toBe(false)
    expect(classifyIpAddress('010.0.0.1')).toBe('blocked')
  })

  it('认不出的输入一律 blocked(fail closed)', () => {
    expect(classifyIpAddress('not-an-ip')).toBe('blocked')
    expect(classifyIpAddress('')).toBe('blocked')
  })
})

describe('URL 校验', () => {
  it('放行公网 https', () => {
    expect(assertPublicHttpUrl('https://api.stripe.com/v1/customers').hostname).toBe('api.stripe.com')
  })

  it('拦下环回与云元数据地址', () => {
    expect(() => assertPublicHttpUrl('http://127.0.0.1:8080/x')).toThrow(EgressBlockedError)
    expect(() => assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/')).toThrow(EgressBlockedError)
    expect(() => assertPublicHttpUrl('http://[::1]/x')).toThrow(EgressBlockedError)
  })

  it('拦下非 http(s) 协议', () => {
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow(EgressBlockedError)
  })

  it('错误消息不回显判定细节(否则成了探测内网网段的 oracle)', () => {
    expect(() => assertPublicHttpUrl('http://10.1.2.3/x')).toThrow(/私有或保留地址/)
    try {
      assertPublicHttpUrl('http://10.1.2.3/x')
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('10.1.2.3')
    }
  })
})

describe('重定向逐跳校验', () => {
  function transportOf(steps: Array<((url: string) => Response) | Response>): typeof fetch {
    let i = 0
    return vi.fn((input: Request | URL | string) => {
      const url = input instanceof Request ? input.url : String(input)
      const step = steps[i++]
      if (step === undefined) throw new Error(`没有为第 ${i} 跳准备响应: ${url}`)
      return Promise.resolve(typeof step === 'function' ? step(url) : step)
    }) as unknown as typeof fetch
  }

  it('域名合法但 302 到元数据地址 —— 拦下(只查首跳的实现会漏)', async () => {
    const guarded = createGuardedFetch({
      fetch: transportOf([
        new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/' } }),
      ]),
    })
    await expect(guarded('https://totally-legit.example/redirect')).rejects.toThrow(EgressBlockedError)
  })

  it('跟随合法重定向并返回终点响应', async () => {
    const guarded = createGuardedFetch({
      fetch: transportOf([
        new Response(null, { status: 301, headers: { location: 'https://api.example.com/v2/thing' } }),
        new Response('ok', { status: 200 }),
      ]),
    })
    const res = await guarded('https://api.example.com/v1/thing')
    expect(res.status).toBe(200)
    await expect(res.text()).resolves.toBe('ok')
  })

  it('重定向跳数超限报错,不无限跟随', async () => {
    const hop = (url: string): Response =>
      new Response(null, { status: 302, headers: { location: `${url}/next` } })
    const guarded = createGuardedFetch({
      fetch: transportOf(Array.from({ length: 10 }, () => hop)),
      maxRedirects: 2,
    })
    await expect(guarded('https://api.example.com/a')).rejects.toThrow(/超过 2 跳/)
  })

  it('POST 收到 302 按规范降级为 GET', async () => {
    const seen: string[] = []
    const guarded = createGuardedFetch({
      fetch: vi.fn((input: Request) => {
        seen.push(input.method)
        return Promise.resolve(seen.length === 1
          ? new Response(null, { status: 302, headers: { location: 'https://api.example.com/done' } })
          : new Response('ok', { status: 200 }))
      }) as unknown as typeof fetch,
    })
    await guarded('https://api.example.com/start', { method: 'POST', body: 'x' })
    expect(seen).toEqual(['POST', 'GET'])
  })
})
