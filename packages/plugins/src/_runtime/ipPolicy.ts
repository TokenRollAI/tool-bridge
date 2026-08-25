/**
 * 出站目标地址策略:判断一个主机名/IP 是否属于**不该被插件访问**的保留网段。
 *
 * 为什么内置插件必须有这层:按「进程内目录」形态,插件与网关**同进程**跑,插件代码
 * 即网关代码。一个上游 base URL 或凭证里带的主机名如果指向 127.0.0.1 / 169.254.169.254
 * / 10.0.0.0/8,插件的一次普通 fetch 就成了从网关内部发起的 SSRF,能打到云厂商元数据
 * 服务或内网。本仓在此之前没有这层防线。
 *
 * 判定按 IANA 特殊用途地址登记表,ipv4 与 ipv6(含 v4-mapped)分别处理。
 *
 * IP 文法由 ipaddr.js 解析，网段策略仍在本文件显式维护。不直接使用库的
 * `range()` 决定放行，避免上游分类表升级时静默改变本项目的 SSRF 边界。
 */

import ipaddr from 'ipaddr.js'

export type IpAddressClass = 'blocked' | 'public'

type ParsedAddress = ipaddr.IPv4 | ipaddr.IPv6

function isStrictIpv4(value: string): boolean {
  return ipaddr.IPv4.isValidFourPartDecimal(value)
    && value.split('.').every(part => part === '0' || !part.startsWith('0'))
}

/**
 * 只接受标准四段十进制 IPv4，拒绝 inet_aton 兼容的八进制/十六进制/缩写形式。
 * IPv6 允许 zone id；它只对本地链路有意义，后续 policy 会将该网段拦下。
 */
function parseAddress(value: string): ParsedAddress | undefined {
  let text = value
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1)
  const embeddedIpv4 = text.includes('.') ? text.slice(text.lastIndexOf(':') + 1) : undefined
  if (embeddedIpv4 !== undefined && !isStrictIpv4(embeddedIpv4)) return undefined
  try {
    if (isStrictIpv4(text)) return ipaddr.IPv4.parse(text)
    if (ipaddr.IPv6.isValid(text)) return ipaddr.IPv6.parse(text)
  } catch {
    // 防御性 fail closed：isValid/parse 在未来版本出现不一致时不得放行。
  }
  return undefined
}

function classifyIpv4(octets: readonly number[]): IpAddressClass {
  const a = octets[0]!
  const b = octets[1]!
  const c = octets[2]!
  if (a === 0) return 'blocked' // 0.0.0.0/8 本网络
  if (a === 10) return 'blocked' // 10/8 私有
  if (a === 127) return 'blocked' // 环回
  if (a === 169 && b === 254) return 'blocked' // 链路本地(含 169.254.169.254 云元数据)
  if (a === 172 && b >= 16 && b <= 31) return 'blocked' // 172.16/12 私有
  if (a === 192 && b === 0 && c === 0) return 'blocked' // IETF 协议分配
  if (a === 192 && b === 0 && c === 2) return 'blocked' // TEST-NET-1
  if (a === 192 && b === 168) return 'blocked' // 私有
  if (a === 198 && (b === 18 || b === 19)) return 'blocked' // 基准测试
  if (a === 198 && b === 51 && c === 100) return 'blocked' // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return 'blocked' // TEST-NET-3
  if (a === 100 && b >= 64 && b <= 127) return 'blocked' // 100.64/10 CGNAT
  if (a >= 224) return 'blocked' // 组播 + 保留 + 广播
  return 'public'
}

function classifyIpv6(bytes: Uint8Array): IpAddressClass {
  const isZero = bytes.every(byte => byte === 0)
  if (isZero) return 'blocked' // ::
  if (bytes.slice(0, 15).every(byte => byte === 0) && bytes[15] === 1) return 'blocked' // ::1 环回
  // v4-mapped(::ffff:a.b.c.d)与 v4-compatible:按内嵌的 v4 判。
  const v4Mapped = bytes.slice(0, 10).every(byte => byte === 0)
    && ((bytes[10] === 0xFF && bytes[11] === 0xFF) || (bytes[10] === 0 && bytes[11] === 0))
  if (v4Mapped) {
    return classifyIpv4([bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!])
  }
  const first = bytes[0]!
  if ((first & 0xFE) === 0xFC) return 'blocked' // fc00::/7 唯一本地
  if (first === 0xFE && (bytes[1]! & 0xC0) === 0x80) return 'blocked' // fe80::/10 链路本地
  if (first === 0xFF) return 'blocked' // ff00::/8 组播
  if (first === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0D && bytes[3] === 0xB8) return 'blocked' // 2001:db8::/32 文档
  return 'public'
}

/** 字符串是不是 IP 字面量(v4 或 v6)。 */
export function isIpAddress(value: string): boolean {
  return parseAddress(value) !== undefined
}

/**
 * IP 字面量的可达性分类。**无法解析的输入一律 `blocked`** —— fail closed:
 * 认不出的形状不该被当成公网放行。
 */
export function classifyIpAddress(address: string): IpAddressClass {
  const parsed = parseAddress(address)
  if (parsed === undefined) return 'blocked'
  if (parsed instanceof ipaddr.IPv4) return classifyIpv4(parsed.octets)
  const bytes = new Uint8Array(parsed.toByteArray())
  if (parsed.isIPv4MappedAddress()) return classifyIpv4(parsed.toIPv4Address().octets)
  return classifyIpv6(bytes)
}
