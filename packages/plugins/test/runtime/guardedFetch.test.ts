import { isTBError, type TBError } from '@tool-bridge/core'
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
    expect(isIpAddress('::ffff:010.0.0.1')).toBe(false)
    expect(classifyIpAddress('::ffff:010.0.0.1')).toBe('blocked')
  })

  it('保留 IPv6 压缩、方括号、zone id 与 v4-compatible/v4-mapped 语义', () => {
    expect(isIpAddress('[2606:4700:4700::1111]')).toBe(true)
    expect(classifyIpAddress('fe80::1%eth0')).toBe('blocked')
    expect(classifyIpAddress('::192.168.1.1')).toBe('blocked')
    expect(classifyIpAddress('::ffff:8.8.8.8')).toBe('public')
    expect(classifyIpAddress('2001:db8::1')).toBe('blocked')
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

  it.each([301, 302])('PUT 收到 %s 时保留 method 与 body', async (status) => {
    const seen: Array<{ body: string, method: string }> = []
    const guarded = createGuardedFetch({
      fetch: vi.fn(async (input: Request) => {
        seen.push({ body: await input.text(), method: input.method })
        return seen.length === 1
          ? new Response(null, { status, headers: { location: '/done' } })
          : new Response('ok', { status: 200 })
      }) as unknown as typeof fetch,
    })

    await guarded('https://api.example.com/start', { method: 'PUT', body: 'payload' })
    expect(seen).toEqual([
      { body: 'payload', method: 'PUT' },
      { body: 'payload', method: 'PUT' },
    ])
  })

  it('HEAD 收到 303 时仍保留 HEAD', async () => {
    const seen: string[] = []
    const guarded = createGuardedFetch({
      fetch: vi.fn((input: Request) => {
        seen.push(input.method)
        return Promise.resolve(seen.length === 1
          ? new Response(null, { status: 303, headers: { location: '/done' } })
          : new Response(null, { status: 200 }))
      }) as unknown as typeof fetch,
    })

    await guarded('https://api.example.com/start', { method: 'HEAD' })
    expect(seen).toEqual(['HEAD', 'HEAD'])
  })

  it('PUT 收到 303 时降级为 GET，并丢弃 body 及其内容头', async () => {
    const seen: Array<{ body: string, contentType: string | null, method: string }> = []
    const guarded = createGuardedFetch({
      fetch: vi.fn(async (input: Request) => {
        seen.push({
          body: await input.text(),
          contentType: input.headers.get('content-type'),
          method: input.method,
        })
        return seen.length === 1
          ? new Response(null, { status: 303, headers: { location: '/done' } })
          : new Response('ok', { status: 200 })
      }) as unknown as typeof fetch,
    })

    await guarded('https://api.example.com/start', {
      method: 'PUT',
      body: 'payload',
      headers: { 'content-type': 'text/plain' },
    })
    expect(seen).toEqual([
      { body: 'payload', contentType: 'text/plain', method: 'PUT' },
      { body: '', contentType: null, method: 'GET' },
    ])
  })

  it('POST 收到同源 307 时保留 method、body 与 headers', async () => {
    const seen: Array<{ body: string, header: string | null, method: string, url: string }> = []
    const guarded = createGuardedFetch({
      fetch: vi.fn(async (input: Request) => {
        seen.push({
          body: await input.text(),
          header: input.headers.get('x-request-id'),
          method: input.method,
          url: input.url,
        })
        return seen.length === 1
          ? new Response(null, { status: 307, headers: { location: '/done' } })
          : new Response('ok', { status: 200 })
      }) as unknown as typeof fetch,
    })

    await guarded('https://api.example.com/start', {
      method: 'POST',
      body: 'payload',
      headers: { 'x-request-id': 'request-1' },
    })

    expect(seen).toEqual([
      {
        body: 'payload',
        header: 'request-1',
        method: 'POST',
        url: 'https://api.example.com/start',
      },
      {
        body: 'payload',
        header: 'request-1',
        method: 'POST',
        url: 'https://api.example.com/done',
      },
    ])
  })
})

describe('EgressBlockedError 的语义', () => {
  /**
   * 它必须是 TBError。裸 Error 冒到 plugin-sdk 的归一处会变成 `internal` 500
   * 「internal plugin error」—— 于是"拦下了一次 SSRF"对运维呈现为"插件崩了"。
   */
  it('是 invalid_argument 而非 internal,且不可重试', () => {
    try {
      assertPublicHttpUrl('http://169.254.169.254/latest/')
      expect.unreachable('应当抛出')
    } catch (err) {
      expect(isTBError(err), '不是 TBError → 会被归一成 internal 500').toBe(true)
      expect((err as TBError).code).toBe('invalid_argument')
      // 那个目标不会变,标成可重试只会让调用方白重试。
      expect((err as TBError).retryable).toBe(false)
    }
  })
})

describe('跨源重定向剥凭证', () => {
  /** 记录每一跳看到的 URL 与凭证类头。 */
  function tracer(steps: Array<(url: string) => Response>): {
    fetch: typeof fetch
    hops: Array<{ headers: Record<string, string>, url: string }>
  } {
    const hops: Array<{ headers: Record<string, string>, url: string }> = []
    let i = 0
    const fetchImpl = vi.fn((input: Request) => {
      hops.push({
        url: input.url,
        headers: Object.fromEntries([...input.headers].filter(([name]) =>
          /auth|key|token|secret|cookie|tat/i.test(name))),
      })
      const step = steps[i++]
      if (step === undefined) throw new Error(`没有为第 ${i} 跳准备响应`)
      return Promise.resolve(step(input.url))
    }) as unknown as typeof fetch
    return { fetch: fetchImpl, hops }
  }

  const redirectTo = (target: string) => (): Response =>
    new Response(null, { status: 302, headers: { location: target } })
  const ok = (): Response => new Response('ok', { status: 200 })

  it('**换 origin 就剥掉 Authorization**(否则 302 一下就把 API key 送给第三方)', async () => {
    const { fetch: transport, hops } = tracer([redirectTo('https://evil.example/steal'), ok])
    await createGuardedFetch({ crossOriginRedirect: 'follow', fetch: transport })('https://api.legit.example/v1/thing', {
      headers: { authorization: 'Bearer SECRET_KEY' },
    })
    expect(hops[0]?.headers.authorization).toBe('Bearer SECRET_KEY')
    expect(hops[1]?.headers.authorization, '凭证被带到了 evil.example').toBeUndefined()
  })

  it('自定义密钥头也剥(各家命名不统一,凡名字带 key/token/secret 的一律剥)', async () => {
    const { fetch: transport, hops } = tracer([redirectTo('https://other.example/x'), ok])
    await createGuardedFetch({ crossOriginRedirect: 'follow', fetch: transport })('https://api.legit.example/v1', {
      headers: {
        'x-api-key': 'K',
        'x-subscription-token': 'T',
        'x-access-token': 'A',
        'accept': 'application/json',
      },
    })
    expect(Object.keys(hops[1]?.headers ?? {})).toEqual([])
    // 非凭证头不受影响(这里只过滤了凭证类,accept 不在记录范围内 —— 用下一条验证)。
  })

  it('精确声明命名不明显的敏感头,跨源时同样剥掉', async () => {
    const { fetch: transport, hops } = tracer([redirectTo('https://other.example/x'), ok])
    await createGuardedFetch({
      crossOriginRedirect: 'follow',
      fetch: transport,
      sensitiveHeaders: ['X-Lark-MCP-TAT'],
    })('https://api.legit.example/v1', {
      headers: { 'X-Lark-MCP-TAT': 'tenant-secret' },
    })
    expect(hops[1]?.headers['x-lark-mcp-tat']).toBeUndefined()
  })

  it('默认拒绝跨源重定向,307 不会转发请求体', async () => {
    const seenBodies: string[] = []
    const transport = vi.fn(async (input: Request) => {
      seenBodies.push(await input.text())
      return new Response(null, {
        status: 307,
        headers: { location: 'https://evil.example/steal' },
      })
    }) as unknown as typeof fetch
    const guarded = createGuardedFetch({ fetch: transport })

    await expect(guarded('https://api.legit.example/token', {
      body: JSON.stringify({ app_secret: 'tenant-secret' }),
      method: 'POST',
    })).rejects.toThrow(/不允许跨源重定向/)
    expect(seenBodies).toEqual(['{"app_secret":"tenant-secret"}'])
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('**同源重定向保留凭证**(常见的 /v1 → /v2 迁移不该因此坏掉)', async () => {
    const { fetch: transport, hops } = tracer([
      redirectTo('https://api.legit.example/v2/thing'),
      ok,
    ])
    await createGuardedFetch({ fetch: transport })('https://api.legit.example/v1/thing', {
      headers: { authorization: 'Bearer SECRET_KEY' },
    })
    expect(hops[1]?.url).toBe('https://api.legit.example/v2/thing')
    expect(hops[1]?.headers.authorization, '同源跳转不该剥凭证').toBe('Bearer SECRET_KEY')
  })

  it('降级为 GET 的那条路径同样剥(303 / 非 GET 收到 302)', async () => {
    const { fetch: transport, hops } = tracer([
      () => new Response(null, { status: 303, headers: { location: 'https://evil.example/x' } }),
      ok,
    ])
    await createGuardedFetch({ crossOriginRedirect: 'follow', fetch: transport })('https://api.legit.example/v1', {
      method: 'POST',
      body: 'x',
      headers: { authorization: 'Bearer SECRET_KEY' },
    })
    expect(hops[1]?.headers.authorization).toBeUndefined()
  })

  it('非凭证头跨源保留(剥的是凭证,不是所有头)', async () => {
    let secondAccept: string | null = null
    let n = 0
    const transport = vi.fn((input: Request) => {
      n += 1
      if (n === 2) secondAccept = input.headers.get('accept')
      return Promise.resolve(n === 1
        ? new Response(null, { status: 302, headers: { location: 'https://other.example/x' } })
        : new Response('ok', { status: 200 }))
    }) as unknown as typeof fetch
    await createGuardedFetch({ crossOriginRedirect: 'follow', fetch: transport })('https://api.legit.example/v1', {
      headers: { accept: 'application/json', authorization: 'Bearer K' },
    })
    expect(secondAccept).toBe('application/json')
  })
})
