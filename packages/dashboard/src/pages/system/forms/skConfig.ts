import type { Action, Scope } from '@/lib/types'

export interface ScopeRow {
  actions: Action[]
  effect: 'allow' | 'deny'
  pattern: string
}

export interface SkFormState {
  description: string
  expiresAt: string
  owner: string
  registerPaths: string
  scopes: ScopeRow[]
}

export const INITIAL_SCOPES: ScopeRow[] = [
  { pattern: '**', actions: ['read', 'call'], effect: 'allow' },
]

export const INITIAL_SK_FORM: SkFormState = {
  owner: '',
  description: '',
  scopes: INITIAL_SCOPES,
  registerPaths: '',
  expiresAt: '',
}

export function buildSkWriteArgs(state: SkFormState) {
  const owner = state.owner.trim()
  if (owner === '') {
    throw new Error('请填写 owner，建议使用 user:、agent: 或 device: 前缀。')
  }
  const scopes: Scope[] = state.scopes.map((scope, index) => {
    if (scope.pattern.trim() === '' || scope.actions.length === 0) {
      throw new Error(`第 ${index + 1} 条 scope 需要 path pattern 和至少一个 action。`)
    }
    return {
      pattern: scope.pattern.trim(),
      actions: scope.actions,
      ...(scope.effect === 'deny' ? { effect: 'deny' as const } : {}),
    }
  })
  if (scopes.length === 0) {
    throw new Error('至少需要一条包含 path pattern 与 action 的 scope。')
  }
  const registerPaths = state.registerPaths
    .split('\n')
    .map(value => value.trim())
    .filter(Boolean)
  let expiresAt: string | undefined
  if (state.expiresAt !== '') {
    const timestamp = new Date(state.expiresAt)
    if (Number.isNaN(timestamp.getTime())) throw new Error('过期时间格式非法。')
    expiresAt = timestamp.toISOString()
  }
  return {
    owner,
    scopes,
    ...(state.description.trim() ? { description: state.description.trim() } : {}),
    ...(registerPaths.length > 0 ? { registerPaths } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  }
}
