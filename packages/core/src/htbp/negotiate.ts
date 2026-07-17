/**
 * 内容协商(规范性)。
 *
 * 把 `Accept` 头归类为三种表现之一。调用点(gateway)据此决定实际渲染:
 * `~help` 三种表现俱全——markdown(默认,可读性表现 renderHelpMarkdown)/
 * json(规范机器可读)/ dsl(紧凑 text/plain,显式 Accept: text/plain 才给);
 * 调用返回值端点把 markdown 与 dsl 都渲染为 markdown(无 DSL 表现)。
 * negotiate 只负责归类,不承担这层端点语义。
 */

export type Representation = 'dsl' | 'json' | 'markdown'

/**
 * 归类 `Accept`:
 *   含 `application/json` → 'json';含 `text/plain` → 'dsl'(紧凑 DSL,显式声明才给);
 *   其余(`text/markdown`、任意类型、未知类型、缺失/空)→ 'markdown'(默认表现)。
 * 仅做大小写无关的子串匹配,不解析 q 值(当前不需要;后续如需可在此升级)。
 * 优先级 json > markdown > dsl:声明 json 一定拿 json;markdown 与 plain 共存取 markdown。
 */
export function negotiate(acceptHeader: string | undefined): Representation {
  if (!acceptHeader) return 'markdown'
  const accept = acceptHeader.toLowerCase()
  if (accept.includes('application/json')) return 'json'
  if (accept.includes('text/markdown')) return 'markdown'
  if (accept.includes('text/plain')) return 'dsl'
  return 'markdown'
}

/** 表现 → 出网关的 Content-Type。 */
export function contentTypeFor(kind: Representation): string {
  switch (kind) {
    case 'json':
      return 'application/json; charset=utf-8'
    case 'markdown':
      return 'text/markdown; charset=utf-8'
    default:
      return 'text/plain; charset=utf-8'
  }
}
