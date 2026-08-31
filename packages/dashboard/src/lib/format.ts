/** Context/Skill 浏览器共用的展示辅助:字节数、相对时间与大对象 $ref 判别。 */

/** 人类可读尺寸(B/KiB/MiB;undefined → '—')。 */
export function humanSize(n?: number): string {
  if (n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`
}

/** ISO 时间 → 相对时间(一天内),更早退回本地格式;缺失显示 '—',不可解析原样兜底。 */
export function humanTime(iso?: string): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(t).toLocaleString()
}

/** 大对象条目/文件:content 是 { $ref } 而非内联时返回其下载引用。 */
export function refOf(content: unknown): string | null {
  if (typeof content === 'object' && content !== null && '$ref' in content) {
    const v = (content as { $ref: unknown }).$ref
    return typeof v === 'string' ? v : null
  }
  return null
}
