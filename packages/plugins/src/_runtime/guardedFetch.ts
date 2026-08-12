/**
 * 插件出站的唯一 fetch 入口:每一跳(初始 URL + 每次重定向)都过公网可达性校验。
 *
 * 内置插件与网关**同进程**跑,插件的 fetch 就是网关的 fetch。上游 base URL、凭证里带的
 * 主机名、用户填的 webhook 地址都可能指向内网或云元数据服务;更隐蔽的是**重定向**——
 * 目标域名合法,302 到 169.254.169.254 就绕过了只查首跳的实现。故这里 `redirect: 'manual'`
 * 自己跟随,逐跳校验。
 *
 * 主机名解析后的地址不在这里查:Workers 与 Node 的 DNS 能力不一致,做成"有就查、没有
 * 就静默跳过"会让防线强度随宿主漂移而无人察觉。这层只保证**可被静态判定**的部分
 * (IP 字面量、协议、重定向链),DNS rebinding 类攻击由部署侧的出网策略负责。
 */

import { classifyIpAddress, isIpAddress } from './ipPolicy'

/** 默认最多跟随的重定向跳数。 */
const MAX_REDIRECTS = 5

export class EgressBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EgressBlockedError'
  }
}

export interface GuardedFetchOptions {
  /** 底层传输;缺省全局 fetch。测试注入用。 */
  fetch?: typeof fetch
  /** 最多跟随几跳重定向;超过即报错(而非静默停在中途返回 302)。 */
  maxRedirects?: number
}

/**
 * 校验一个 URL 可以作为出站目标,返回解析后的 URL。
 * 主机是 IP 字面量时按保留网段判定;是域名时只校验协议(域名解析结果不在此层)。
 */
export function assertPublicHttpUrl(value: string | URL): URL {
  let url: URL
  try {
    url = value instanceof URL ? value : new URL(value)
  } catch {
    throw new EgressBlockedError(`出站目标不是合法 URL: ${String(value)}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new EgressBlockedError(`出站目标协议不被允许: ${url.protocol}`)
  }
  // URL 会把 IPv6 主机包在方括号里,剥掉再判。
  const hostname = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname
  if (hostname === '') throw new EgressBlockedError('出站目标缺少主机名')
  if (isIpAddress(hostname) && classifyIpAddress(hostname) === 'blocked') {
    // 不回显解析细节:主机名常来自租户输入,把判定结果原样告诉调用方
    // 等于送一个探测内网网段的 oracle。
    throw new EgressBlockedError('出站目标指向私有或保留地址')
  }
  return url
}

/**
 * 带出站校验的 fetch。签名与全局 fetch 一致,可直接替换。
 *
 * 注意 `init.redirect` 会被忽略:重定向必须由本函数手动跟随才能逐跳校验。
 */
export function createGuardedFetch(options: GuardedFetchOptions = {}): typeof fetch {
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS

  return async function guardedFetch(input, init) {
    // 每次调用才解析底层传输,不在构造时绑定 globalThis.fetch:共享实例是模块级常量,
    // 早绑会锁死宿主装载 fetch 之前的那个值(测试里打桩全局 fetch 也会失效——
    // 这不是测试的怪癖,而是宿主延迟注入 fetch 时的真实故障)。
    const transport = options.fetch ?? globalThis.fetch
    const initial = input instanceof Request ? input.url : String(input)
    let url = assertPublicHttpUrl(initial)
    // 基准请求:method/headers/body 的真源。后续每跳都由它派生,只换 URL。
    // redirect:'manual' 是本层的前提——交给平台自动跟随就没有逐跳校验的机会。
    let request = input instanceof Request
      ? new Request(url, new Request(input, init))
      : new Request(url, { ...init, redirect: 'manual' })

    for (let hop = 0; ; hop += 1) {
      const response = await transport(new Request(request, { redirect: 'manual' }))
      const location = response.headers.get('location')
      if (response.status < 300 || response.status > 399 || location === null) return response

      if (hop >= maxRedirects) {
        throw new EgressBlockedError(`出站重定向超过 ${maxRedirects} 跳`)
      }
      // 逐跳校验:这才是这层存在的主要理由。
      url = assertPublicHttpUrl(new URL(location, url))
      // 303,以及「非 GET 收到 301/302」,按 Fetch 规范降级为 GET 且丢弃 body。
      const downgrade = response.status === 303
        || ((response.status === 301 || response.status === 302) && request.method !== 'GET')
      request = downgrade
        ? new Request(url, { method: 'GET', headers: request.headers, redirect: 'manual' })
        : new Request(url, request)
    }
  }
}

/** 共享实例:插件业务代码直接用它替代全局 fetch。 */
export const guardedFetch: typeof fetch = createGuardedFetch()
