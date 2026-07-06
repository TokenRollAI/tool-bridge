/**
 * context 节点 ttl 判定(Proto §5.3:ttl 到期由网关回收整个节点)。
 *
 * core 只出纯判定;回收动作(registry.delete + 404)在网关的懒回收接线点执行。
 */

/**
 * ttlSec 为 undefined 或 0 → 永不过期;createdAt 无法解析 → 不过期(不误回收)。
 * 边界:now 恰好等于 createdAt + ttl 视为已过期。
 */
export function isContextExpired(
  createdAt: string,
  ttlSec: number | undefined,
  now: number,
): boolean {
  if (!ttlSec) return false
  const created = Date.parse(createdAt)
  if (Number.isNaN(created)) return false
  return now >= created + ttlSec * 1000
}
