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

import { TBError } from '@tool-bridge/plugin-sdk'
import { classifyIpAddress, isIpAddress } from './ipPolicy'

/** 默认最多跟随的重定向跳数。 */
const MAX_REDIRECTS = 5

/**
 * 跨 origin 重定向时必须剥掉的请求头。
 *
 * 平台自动跟随重定向时,Fetch 规范本来就会剥这些头;我们为了逐跳校验地址改成手动跟随,
 * 就得自己补上这一条 —— 否则「域名合法但 302 到别处」不再是 SSRF,而是**凭证外泄**:
 * 上游被接管、CDN 配错、或干脆是个恶意上游,一次 302 就能把租户的 API key 拿走。
 */
const CROSS_ORIGIN_STRIPPED_HEADERS = [
  'authorization',
  'cookie',
  'proxy-authorization',
  // 各家自定义的密钥头没有统一命名,凡是名字里带 key/token/secret 的一律剥掉:
  // 宁可让跨源跳转少带一个无关头,也不能漏带走一个凭证。
] as const

/** Fetch 在 redirect-method 改成 GET 时同步删除的 request-body-header。 */
const REQUEST_BODY_HEADERS = [
  'content-encoding',
  'content-language',
  'content-location',
  'content-type',
] as const

/** 名字看起来像凭证的头(各家自定义密钥头没有统一命名)。 */
function looksLikeCredentialHeader(name: string): boolean {
  return /(?:^|-)(?:api[-_]?key|key|token|secret|auth)(?:$|-)/i.test(name)
}

/** 跨 origin 时产出剥掉凭证后的 headers。 */
function stripCredentials(headers: Headers, sensitiveHeaders: ReadonlySet<string>): Headers {
  const next = new Headers(headers)
  for (const [name] of headers) {
    if (CROSS_ORIGIN_STRIPPED_HEADERS.includes(name.toLowerCase() as never)
      || looksLikeCredentialHeader(name)
      || sensitiveHeaders.has(name.toLowerCase())) {
      next.delete(name)
    }
  }
  return next
}

/**
 * 出站被本层拒绝。**继承 TBError 而不是裸 Error**:裸 Error 冒到 plugin-sdk 的错误归一处
 * 会变成 `internal` 500「internal plugin error」—— 于是"我们拦下了一次 SSRF"对运维呈现为
 * "插件崩了",原因被完全抹掉。
 *
 * 归 `invalid_argument`:出站目标不合法是**输入/配置**问题(上游 base URL 配错、租户填了
 * 内网地址、上游 302 到保留网段),不是服务故障,更不该被标成可重试 —— 那个目标不会变。
 */
export class EgressBlockedError extends TBError {
  constructor(message: string) {
    super('invalid_argument', message)
    this.name = 'EgressBlockedError'
  }
}

export interface GuardedFetchOptions {
  /**
   * 跨 origin 重定向策略。默认 error：请求体和非标准凭证头无法被完整识别，
   * 只有确认请求不含秘密的调用方才应显式选择 follow。
   */
  crossOriginRedirect?: 'error' | 'follow'
  /** 底层传输;缺省全局 fetch。测试注入用。 */
  fetch?: typeof fetch
  /** 最多跟随几跳重定向;超过即报错(而非静默停在中途返回 302)。 */
  maxRedirects?: number
  /** 额外按精确名字认定为凭证的请求头(不依赖 key/token/secret 命名启发式)。 */
  sensitiveHeaders?: readonly string[]
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
  const crossOriginRedirect = options.crossOriginRedirect ?? 'error'
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS
  const sensitiveHeaders = new Set(
    (options.sensitiveHeaders ?? []).map(name => name.toLowerCase()),
  )

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
      // transport 会消费请求体。先发送 clone，给 307/308 留下仍可转移到下一跳的原请求；
      // 否则 string/stream body 在第一跳后已 disturbed，无法按 Fetch 语义原样重放。
      const response = await transport(new Request(request.clone(), { redirect: 'manual' }))
      const location = response.headers.get('location')
      if (response.status < 300 || response.status > 399 || location === null) return response

      if (hop >= maxRedirects) {
        throw new EgressBlockedError(`出站重定向超过 ${maxRedirects} 跳`)
      }
      // 逐跳校验:这才是这层存在的主要理由。
      const previousOrigin = new URL(request.url).origin
      url = assertPublicHttpUrl(new URL(location, url))
      const crossesOrigin = url.origin !== previousOrigin
      if (crossesOrigin && crossOriginRedirect === 'error') {
        throw new EgressBlockedError('携带敏感信息的出站请求不允许跨源重定向')
      }
      // 换了 origin 就剥凭证头 —— 只查「跳到哪」不管「带什么去」,等于把 SSRF 防线
      // 变成凭证外泄通道(见 CROSS_ORIGIN_STRIPPED_HEADERS)。
      const headers = !crossesOrigin
        ? request.headers
        : stripCredentials(request.headers, sensitiveHeaders)
      // Fetch redirect-method：301/302 只把 POST 改成 GET；303 把 GET/HEAD 之外的方法
      // 改成 GET；307/308 始终保留。不能把 PUT 301/302 或 HEAD 303 错降级。
      const downgrade = ((response.status === 301 || response.status === 302) && request.method === 'POST')
        || (response.status === 303 && request.method !== 'GET' && request.method !== 'HEAD')
      if (downgrade) {
        const redirectedHeaders = new Headers(headers)
        for (const name of REQUEST_BODY_HEADERS) redirectedHeaders.delete(name)
        request = new Request(url, { method: 'GET', headers: redirectedHeaders, redirect: 'manual' })
      } else {
        // Request 的 method/body 等属性在原型上，不是可展开的 enumerable field；
        // `{ ...request }` 会静默变成 GET + 空 body。把 Request 作为 WebIDL
        // RequestInit 转移其完整语义，再只在跨源时覆盖已脱敏 headers。
        const redirected = new Request(url, request as unknown as RequestInit)
        request = crossesOrigin
          ? new Request(redirected, { headers, redirect: 'manual' })
          : redirected
      }
    }
  }
}

/** 共享实例:插件业务代码直接用它替代全局 fetch。 */
export const guardedFetch: typeof fetch = createGuardedFetch()
