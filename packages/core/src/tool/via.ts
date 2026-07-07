/**
 * X-TB-Via 环检测与跳数上限(跨实例透传环检测)。
 *
 * remote 透传时出站请求携带 `X-TB-Via: <本实例标识>` 并追加既有链。收到含**自身标识**的
 * 入站链 → 环;链段数 ≥ maxHops → 跳数超限。两者都归 `unavailable(retryable:false)`。
 * 纯逻辑;gateway 负责读/写 header。
 */

import { TBError } from '../errors'

/** 解析 X-TB-Via 头:逗号分隔、每段 trim,丢弃空段。缺省/空串 → 空链。 */
export function parseVia(header: string | undefined): string[] {
  if (header === undefined) return []
  return header
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * 环 / 跳数检测(在**追加自身之前**对入站链判定):
 * - 链中已含 `selfId` → 环 → `unavailable(retryable:false)`;
 * - 链长 ≥ `maxHops` → 跳数超限 → `unavailable(retryable:false)`。
 * 通过返回 null。
 */
export function checkVia(chain: string[], selfId: string, maxHops: number): TBError | null {
  if (chain.includes(selfId)) {
    return new TBError('unavailable', `检测到透传环:'${selfId}' 已在 X-TB-Via 链中`, {
      retryable: false,
    })
  }
  if (chain.length >= maxHops) {
    return new TBError('unavailable', `透传跳数超限:链长 ${chain.length} ≥ maxHops ${maxHops}`, {
      retryable: false,
    })
  }
  return null
}

/** 把自身标识追加到链尾,产出出站 X-TB-Via 头值。 */
export function appendVia(chain: string[], selfId: string): string {
  return [...chain, selfId].join(', ')
}
