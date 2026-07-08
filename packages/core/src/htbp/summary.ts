/**
 * 面向"一句话"渲染位的文本压缩。
 *
 * `~help` 的行式 DSL 与索引形态都假定 description/h 是单行短句,但上游(尤其 mcp)
 * 的 description 经常是整篇多行 markdown——直接透传会撑爆索引、并破坏 DSL 的行结构。
 * 这里统一"取首句 + 折叠空白 + 截断"的压缩规则;全文保留在单工具全量 `~help` 中。
 */

/** 一句话摘要的默认长度上限(字符)。 */
export const ONE_LINE_MAX = 160

/** 把任意文本折叠为单行:换行/连续空白 → 单空格,去首尾空白。 */
export function collapseToOneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 一句话摘要:取首个非空行(多行文本的第一行通常就是概述句),
 * 折叠空白,超过 `max` 时在字符边界截断并补 `…`。
 */
export function summarizeOneLine(text: string, max: number = ONE_LINE_MAX): string {
  const firstLine = text.split('\n').find((line) => line.trim() !== '') ?? ''
  const collapsed = collapseToOneLine(firstLine)
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max - 1).trimEnd()}…`
}
