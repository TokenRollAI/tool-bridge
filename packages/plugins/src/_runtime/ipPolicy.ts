/**
 * 出站目标地址策略:判断一个主机名/IP 是否属于**不该被插件访问**的保留网段。
 *
 * 为什么内置插件必须有这层:按「进程内目录」形态,插件与网关**同进程**跑,插件代码
 * 即网关代码。一个上游 base URL 或凭证里带的主机名如果指向 127.0.0.1 / 169.254.169.254
 * / 10.0.0.0/8,插件的一次普通 fetch 就成了从网关内部发起的 SSRF,能打到云厂商元数据
 * 服务或内网。本仓在此之前没有这层防线。
 *
 * 判定按 IANA 特殊用途地址登记表,ipv4 与 ipv6(含 v4-mapped)分别处理。
 */

export type IpAddressClass = 'blocked' | 'public'

/** 点分十进制 → 32 位整数;不是合法 IPv4 则 undefined。 */
function parseIpv4(value: string): number | undefined {
  const parts = value.split('.')
  if (parts.length !== 4) return undefined
  let result = 0
  for (const part of parts) {
    // 拒绝前导零:'010' 在某些解析器里是八进制,是经典的绕过手法。
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith('0'))) return undefined
    const octet = Number(part)
    if (octet > 255) return undefined
    result = (result << 8) | octet
  }
  return result >>> 0
}

/** IPv6 → 16 字节;不是合法 IPv6 则 undefined。支持 `::` 压缩与末尾内嵌 IPv4。 */
function parseIpv6(value: string): Uint8Array | undefined {
  let text = value
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1)
  // 去掉 zone id(fe80::1%eth0):作用域只在本机有意义,本就该拦。
  const zone = text.indexOf('%')
  if (zone !== -1) text = text.slice(0, zone)
  if (!text.includes(':')) return undefined

  const halves = text.split('::')
  if (halves.length > 2) return undefined

  const expand = (part: string): number[] | undefined => {
    if (part === '') return []
    const groups: number[] = []
    const chunks = part.split(':')
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]!
      // 末尾内嵌 IPv4(::ffff:192.0.2.1)
      if (i === chunks.length - 1 && chunk.includes('.')) {
        const v4 = parseIpv4(chunk)
        if (v4 === undefined) return undefined
        groups.push((v4 >>> 16) & 0xFFFF, v4 & 0xFFFF)
        continue
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(chunk)) return undefined
      groups.push(Number.parseInt(chunk, 16))
    }
    return groups
  }

  const head = expand(halves[0] ?? '')
  const tail = halves.length === 2 ? expand(halves[1] ?? '') : []
  if (head === undefined || tail === undefined) return undefined
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 0 : missing !== 0) return undefined
  const groups = [...head, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => 0), ...tail]
  if (groups.length !== 8) return undefined

  const bytes = new Uint8Array(16)
  groups.forEach((group, i) => {
    bytes[i * 2] = (group >>> 8) & 0xFF
    bytes[i * 2 + 1] = group & 0xFF
  })
  return bytes
}

function classifyIpv4(value: number): IpAddressClass {
  const a = (value >>> 24) & 0xFF
  const b = (value >>> 16) & 0xFF
  const c = (value >>> 8) & 0xFF
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
    const v4 = ((bytes[12]! << 24) | (bytes[13]! << 16) | (bytes[14]! << 8) | bytes[15]!) >>> 0
    return classifyIpv4(v4)
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
  return parseIpv4(value) !== undefined || parseIpv6(value) !== undefined
}

/**
 * IP 字面量的可达性分类。**无法解析的输入一律 `blocked`** —— fail closed:
 * 认不出的形状不该被当成公网放行。
 */
export function classifyIpAddress(address: string): IpAddressClass {
  const v4 = parseIpv4(address)
  if (v4 !== undefined) return classifyIpv4(v4)
  const v6 = parseIpv6(address)
  if (v6 !== undefined) return classifyIpv6(v6)
  return 'blocked'
}
