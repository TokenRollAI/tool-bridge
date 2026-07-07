/**
 * remote 透传的路径改写与白名单(纯逻辑)。
 *
 * gateway 负责实际 fetch、skRef 换发、X-TB-Via 注入(见 via.ts);此处只算改写后的目标 URL
 * 与白名单判定。
 */

import { segments } from '../tree/path'
import type { TreePath } from '../types'

/**
 * 把对 remote 节点 `<nodePath>` 及其后代的请求改写为对 `baseUrl` 下相对路径的**同形**请求。
 *
 * `requestPath` 是完整请求 path(可含尾部保留段 `~help`/`~tree`/`~skill`);去掉 remote 节点
 * 挂载前缀 `nodePath` 后得到相对路径,拼到 `baseUrl` 下。保留段随相对路径原样带过去
 * (`docs/remote/~help` 挂在 `docs/remote` → `<baseUrl>/~help`)。
 *
 * 前置条件:`nodePath` 是 `requestPath` 的段前缀(gateway 由 Resolve 保证);若不是,退化为
 * 直接把 `requestPath` 全量拼到 baseUrl(保守,不丢段)。
 */
export function rewriteRemotePath(
  nodePath: TreePath,
  requestPath: TreePath,
  baseUrl: string,
): string {
  const base = baseUrl.replace(/\/+$/, '')

  // requestPath 尾部可能带保留段(~help/~tree/~skill);拆出保留段单独处理,
  // 其余段做前缀剥离(保留段不是树路径的一部分,不参与前缀比较)。
  const rawSegs = requestPath
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter((s) => s.length > 0)
  const reserved =
    rawSegs.length > 0 && rawSegs[rawSegs.length - 1]?.startsWith('~') ? rawSegs.pop() : undefined

  const nodeSegs = segments(nodePath)
  const pathSegs = rawSegs

  let relSegs: string[]
  const isPrefix = nodeSegs.length <= pathSegs.length && nodeSegs.every((s, i) => s === pathSegs[i])
  if (isPrefix) {
    relSegs = pathSegs.slice(nodeSegs.length)
  } else {
    // 非前缀(不应发生):保守全量透传,不丢段。
    relSegs = pathSegs
  }

  const tail = reserved !== undefined ? [...relSegs, reserved] : relSegs
  const rel = tail.join('/')
  return rel === '' ? base : `${base}/${rel}`
}

/**
 * 从 URL 取 host(小写,去 userinfo/端口)。core 无运行时全局(不用 `URL`),用字符串解析;
 * 无 scheme://authority 结构 → undefined。
 */
function hostOf(url: string): string | undefined {
  const m = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)/.exec(url)
  if (m === null) return undefined
  let authority = m[1] ?? ''
  const at = authority.lastIndexOf('@')
  if (at >= 0) authority = authority.slice(at + 1)
  // IPv6 字面量 [::1]:port —— 取到 ']';否则按首个 ':' 切端口。
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']')
    if (close >= 0) return authority.slice(0, close + 1).toLowerCase()
  }
  const colon = authority.indexOf(':')
  const host = colon >= 0 ? authority.slice(0, colon) : authority
  return host.toLowerCase()
}

/**
 * baseUrl 白名单判定:host **后缀**匹配 allowlist 任一条目。
 * 空 allowlist = 拒绝一切 remote(定型)。URL 无 host → 拒。
 *
 * 后缀匹配按 host 段边界:`example.com` 命中 `api.example.com`,但不命中 `notexample.com`。
 */
export function checkAllowlist(baseUrl: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false
  const host = hostOf(baseUrl)
  if (host === undefined || host === '') return false
  return allowlist.some((entry) => {
    const suffix = entry.trim().toLowerCase()
    if (suffix === '') return false
    return host === suffix || host.endsWith(`.${suffix}`)
  })
}
