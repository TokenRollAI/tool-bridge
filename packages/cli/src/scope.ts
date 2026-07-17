import { CliError } from './http'

/**
 * SK Scope 与动作。CLI 本地镜像线格式,不依赖 core。
 */
export type Action = 'read' | 'write' | 'call' | 'register' | 'admin'

export interface Scope {
  actions: Action[]
  effect?: 'allow' | 'deny'
  pattern: string
}

const ACTIONS: readonly Action[] = ['read', 'write', 'call', 'register', 'admin']

/**
 * 解析 `--scope` 字符串 `"pattern:actions"` → Scope。
 * 例:`"docs/**:read,call"` → `{ pattern: 'docs/**', actions: ['read','call'] }`。
 * 树路径 glob 不含 `:`,故按首个 `:` 切分 pattern 与动作列表。
 */
export function parseScope(spec: string): Scope {
  const idx = spec.indexOf(':')
  if (idx < 0) {
    throw new CliError(
      `invalid --scope "${spec}": expected "pattern:actions" e.g. "docs/**:read,call"`,
    )
  }
  const pattern = spec.slice(0, idx).trim()
  if (!pattern) throw new CliError(`invalid --scope "${spec}": empty pattern`)

  const actions = spec
    .slice(idx + 1)
    .split(',')
    .map(a => a.trim())
    .filter(Boolean)
  if (actions.length === 0) throw new CliError(`invalid --scope "${spec}": no actions`)

  for (const a of actions) {
    if (!ACTIONS.includes(a as Action)) {
      throw new CliError(`invalid action "${a}" in --scope "${spec}"; valid: ${ACTIONS.join(', ')}`)
    }
  }
  return { pattern, actions: actions as Action[] }
}
