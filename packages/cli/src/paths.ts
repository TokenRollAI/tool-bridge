/** 构造 HTBP 保留段路径:`nodePath('~help', 'docs/context7')` → `/docs/context7/~help`。 */
export function nodePath(segment: string, path?: string): string {
  const clean = (path ?? '').replace(/^\/+|\/+$/g, '')
  return clean ? `/${clean}/${segment}` : `/${segment}`
}
