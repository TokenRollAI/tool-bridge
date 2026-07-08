/**
 * 内容协商(规范性)。
 *
 * 把 `Accept` 头归类为三种表现之一。调用点(gateway)据此决定实际渲染:
 * `~help` 三种表现俱全——dsl(text/plain,默认)/ json(规范机器可读)/
 * markdown(可读性表现,renderHelpMarkdown);调用返回值端点把默认表现渲染为 markdown。
 * negotiate 只负责归类,不承担这层端点语义。
 */

export type Representation = 'dsl' | 'json' | 'markdown'

/**
 * 归类 `Accept`:
 *   含 `application/json` → 'json';含 `text/markdown` → 'markdown';
 *   其余(`*​/*`、`text/plain`、缺失/空)→ 'dsl'(默认表现)。
 * 仅做大小写无关的子串匹配,不解析 q 值(当前不需要;后续如需可在此升级)。
 * json 优先于 markdown:两者同时出现时取 json(机器可读优先)。
 */
export function negotiate(acceptHeader: string | undefined): Representation {
  if (!acceptHeader) return 'dsl'
  const accept = acceptHeader.toLowerCase()
  if (accept.includes('application/json')) return 'json'
  if (accept.includes('text/markdown')) return 'markdown'
  return 'dsl'
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
