import { encodeTreePath } from './path'

/** 只定位命令；调用路径和输入 schema 始终重新读取 owner 的实时 help。 */
export function toolHref(ownerPath: string, commandName: string): string {
  return `/tools/${encodeTreePath(ownerPath)}?tool=${encodeURIComponent(commandName)}`
}

const RETURN_PAGES = new Set([
  '/', '/search', '/tools', '/canvas', '/manage/devices', '/manage/registry', '/manage/sk',
  '/manage/secrets', '/manage/plugins', '/manage/federation', '/manage/store',
  '/manage/keys', '/manage/maintenance', '/manage/deployment', '/manage/settings/config',
  '/manage/storage',
])

/** history state 也属于不可信输入：限定应用路由，并剔除非导航 query 与 hash。 */
export function safeToolReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || [...value].some(char => char.charCodeAt(0) <= 32)) return '/tools'
  try {
    const url = new URL(value, 'https://dashboard.invalid')
    const pathname = value.split(/[?#]/)[0]
    if (url.origin !== 'https://dashboard.invalid' || url.pathname !== pathname) return '/tools'
    if (!RETURN_PAGES.has(url.pathname) && !/^\/(nodes|tools)\//.test(url.pathname)) return '/tools'
    if (url.pathname.split('/').some((part) => {
      const decoded = decodeURIComponent(part)
      return decoded === '.' || decoded === '..' || /[\\/]/.test(decoded) || [...decoded].some(char => char.charCodeAt(0) < 32)
    })) return '/tools'
    const query = new URLSearchParams()
    const allowed = url.pathname === '/search'
      ? ['q', 'federation']
      : url.pathname === '/tools' ? ['path'] : /^\/(nodes|tools)\//.test(url.pathname) ? ['tool', 'tab'] : []
    for (const key of allowed) {
      const entry = url.searchParams.get(key)
      if (entry !== null) query.set(key, entry)
    }
    return `${url.pathname}${query.size ? `?${query}` : ''}`
  } catch {
    return '/tools'
  }
}
