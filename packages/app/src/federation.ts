/**
 * remote 联邦:透传、远端 `~tree` 聚合与远端返回路径的可信化。
 * 远端 JSON 是不可信协议数据,进入本地树之前一律经 canonicalRemotePath 收敛。
 * 出站传输本身在 providers/remote.ts,这里是它在树语义上的消费面。
 */
import {
  type CallContext,
  check,
  NodeRegistryStore,
  RemoteAllowlistStore,
  type StateStore,
  TBError,
  type TreeEntry,
  type TreeJson,
  type TreeNode,
  type TreePath,
  validatePath,
} from '@tool-bridge/core'
import type { AppContext, TbAppDeps } from './deps'
import { assertRemoteAllowed, passthroughRemote, type RemoteSettings } from './providers/remote'

export function remoteProtocolError(message: string): TBError {
  return new TBError('unavailable', message, { retryable: false })
}

/** Remote JSON paths are untrusted protocol data; reject URL-normalizable aliases. */
export function canonicalRemotePath(path: string, allowRoot: boolean): TreePath {
  if (path !== path.replace(/^\/+|\/+$/g, '')) {
    throw remoteProtocolError(`remote returned non-canonical path '${path}'`)
  }
  const invalid = validatePath(path, { allowRoot })
  if (invalid !== null) throw remoteProtocolError(`remote returned invalid path '${path}'`)
  for (const segment of path === '' ? [] : path.split('/')) {
    let decoded = segment
    for (let pass = 0; pass < 4; pass++) {
      if (
        decoded === '.'
        || decoded === '..'
        || decoded.startsWith('~')
        || decoded.includes('/')
        || decoded.includes('\\')
        || [...decoded].some((char) => {
          const code = char.charCodeAt(0)
          return code <= 31 || code === 127
        })
      ) {
        throw remoteProtocolError(`remote returned unsafe path segment '${segment}'`)
      }
      let next: string
      try {
        next = decodeURIComponent(decoded)
      } catch {
        throw remoteProtocolError(`remote returned malformed encoded path '${path}'`)
      }
      if (next === decoded) break
      if (pass === 3) {
        throw remoteProtocolError(`remote returned over-encoded path '${path}'`)
      }
      decoded = next
    }
  }
  return path
}

export function remotePathWithin(nodePath: TreePath, commandPath: TreePath): boolean {
  return nodePath === ''
    || commandPath === nodePath
    || commandPath.startsWith(`${nodePath}/`)
}

export function localizeRemoteEntry(
  mountPath: TreePath,
  remoteParentPath: TreePath,
  entry: TreeJson,
): TreeEntry {
  const rel = canonicalRemotePath(entry.path, false)
  const parent = rel.split('/').slice(0, -1).join('/')
  if (parent !== remoteParentPath) {
    throw remoteProtocolError(`remote ~tree child '${rel}' is not a direct descendant`)
  }
  const out: TreeEntry = {
    path: `${mountPath}/${rel}`,
    kind: entry.kind,
    description: entry.description,
  }
  // presence 由上游 ~tree 已派生好,本地原样透传(远端设备的新鲜度以远端时钟为准)。
  if (entry.presence !== undefined) out.presence = entry.presence
  return out
}
/**
 * 生效的 remote 白名单 = env 基线 ∪ 运行时条目(system/federation 管理)。
 * 请求期读取(app 被 WeakMap 按 env 缓存,不能在装配期定死);运行时无条目 → 原样返回基线。
 */
export async function resolveRemoteSettings(
  state: StateStore,
  base: RemoteSettings,
): Promise<RemoteSettings> {
  const runtime = await new RemoteAllowlistStore(state).hosts()
  if (runtime.length === 0) return base
  return { ...base, allowlist: [...new Set([...base.allowlist, ...runtime])] }
}

/**
 * remote 透传:最长前缀 resolve 命中 remote 节点则改写请求打到 baseUrl。
 * 非 remote → 返回 null(交给普通流程)。本地两级权限:先可见(read),POST 另需 call。
 */
export async function remotePassthroughIfMatch(
  c: AppContext,
  ctx: CallContext,
  registry: NodeRegistryStore,
  treePath: TreePath,
  reservedTail: '~help' | '~tree' | '~skill' | null,
  deps: TbAppDeps,
  headers: Headers = c.req.raw.headers,
): Promise<Response | null> {
  let resolved: { node: TreeNode, rest: string }
  try {
    resolved = await registry.resolve(treePath)
  } catch {
    return null
  }
  const node = resolved.node
  if (node.kind !== 'remote' || node.config?.kind !== 'remote') return null

  if (!check(ctx, treePath, 'read').allow) throw TBError.notFound('not found')
  const method = reservedTail === null ? 'POST' : 'GET'
  if (method === 'POST' && !check(ctx, treePath, 'call').allow) {
    throw new TBError('permission_denied', `no scope grants 'call' on '${treePath}'`)
  }
  const requestPath = reservedTail === null ? treePath : `${treePath}/${reservedTail}`
  const body = method === 'POST' ? await c.req.text() : undefined
  // 必须 await(而非裸 return async promise):裸返回时其 reject 会在链接那一 tick 被
  // workerd/miniflare 误报为 unhandled rejection,即便 runHandler 最终 catch(同 GET 通配注释)。
  return await passthroughRemote({
    actor: { keyId: ctx.keyId, owner: ctx.owner, traceId: ctx.traceId },
    config: node.config,
    nodePath: node.path,
    requestPath,
    method,
    ...(body !== undefined ? { body } : {}),
    headers,
    secrets: deps.secrets,
    settings: await resolveRemoteSettings(deps.state, deps.remote),
    requestUrl: c.req.url,
  })
}

/**
 * remote 联邦树聚合:本地 `~tree` 构树递归到 remote 节点或其后代时,取远端同形
 * `~tree` 的直接 children 并把路径加回本地挂载前缀,再交给 buildTree 统一计入深度/节点预算。
 */
export async function remoteTreeChildren(
  c: AppContext,
  ctx: CallContext,
  registry: NodeRegistryStore,
  treePath: TreePath,
  deps: TbAppDeps,
): Promise<TreeEntry[]> {
  if (treePath === '') return []
  let resolved: { node: TreeNode, rest: string }
  try {
    resolved = await registry.resolve(treePath)
  } catch {
    return []
  }
  if (resolved.node.kind !== 'remote' || resolved.node.config?.kind !== 'remote') return []

  const headers = new Headers(c.req.raw.headers)
  headers.set('accept', 'application/json')
  const resp = await remotePassthroughIfMatch(c, ctx, registry, treePath, '~tree', deps, headers)
  if (resp === null) return []
  if (!resp.ok) {
    throw new TBError('unavailable', `remote ~tree returned HTTP ${resp.status}`, {
      retryable: resp.status >= 500,
    })
  }
  const remoteTree = (await resp.json().catch(() => null)) as TreeJson | null
  if (remoteTree === null) {
    throw new TBError('unavailable', 'remote ~tree returned invalid JSON', { retryable: false })
  }
  const remotePath = canonicalRemotePath(remoteTree.path, true)
  if (remotePath !== resolved.rest) {
    throw remoteProtocolError(`remote ~tree path '${remotePath}' does not match request`)
  }
  return (remoteTree.children ?? []).map(child =>
    localizeRemoteEntry(resolved.node.path, remotePath, child))
}

/** 注册 remote 节点时的白名单校验:config.kind==='remote' → baseUrl 必须在白名单内。 */
export function assertRemoteConfigAllowed(config: unknown, settings: RemoteSettings): void {
  if (config === null || typeof config !== 'object') return
  if ((config as { kind?: unknown }).kind !== 'remote') return
  const baseUrl = (config as { baseUrl?: unknown }).baseUrl
  if (typeof baseUrl !== 'string') {
    throw new TBError('invalid_argument', 'remote config 缺少 baseUrl')
  }
  assertRemoteAllowed(baseUrl, settings)
}
