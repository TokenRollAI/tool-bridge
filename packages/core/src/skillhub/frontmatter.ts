/**
 * SKILL.md 的最小 frontmatter 解析器(不引入 yaml 依赖——core 仅依赖 zod)。
 *
 * 采用 Claude Agent Skills 约定:文件以 `---` 独占一行开头,到下一处 `---` 独占一行结束,
 * 中间为 YAML。此处只取顶层标量 `key: value`(name/description/version/license 等),
 * 容忍单双引号包裹;不支持嵌套/列表/多行折叠(遇到即按整行文本兜底,不报错)。
 *
 * name 与 description 为 Claude 约定的必填字段;是否强制由调用方(provider Publish)决定,
 * 本模块只做纯解析,不抛"缺字段"错误。
 */

export interface Frontmatter {
  /** 顶层标量键值对(值已 trim、去引号)。 */
  meta: Record<string, string>
  /** frontmatter 之后的正文;无 frontmatter 时为整段内容。 */
  body: string
}

/** 去掉成对的首尾单/双引号(仅一层)。 */
function unquote(v: string): string {
  const s = v.trim()
  if (s.length >= 2) {
    const first = s[0]
    const last = s[s.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1)
    }
  }
  return s
}

/**
 * 解析 SKILL.md(或任意带 frontmatter 的文本)。
 * 无 frontmatter → `{ meta: {}, body: 原文 }`。
 */
export function parseFrontmatter(text: string): Frontmatter {
  // 归一换行,避免 \r\n 干扰行匹配;正文保留原样(用原文本切片)。
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    return { meta: {}, body: text }
  }
  const rest = normalized.slice(4)
  const end = rest.indexOf('\n---')
  if (end < 0) {
    // 起始 --- 但无闭合:视为无 frontmatter,避免误吞正文。
    return { meta: {}, body: text }
  }
  const block = rest.slice(0, end)
  // 闭合 `---` 行之后即正文(跳过闭合行剩余到换行)。
  const afterFence = rest.slice(end + 1)
  const nl = afterFence.indexOf('\n')
  const body = nl < 0 ? '' : afterFence.slice(nl + 1)

  const meta: Record<string, string> = {}
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx <= 0) continue // 无 key: 的行(含列表项 "- x")跳过
    const key = line.slice(0, idx).trim()
    const value = unquote(line.slice(idx + 1))
    if (key !== '') meta[key] = value
  }
  return { meta, body }
}
