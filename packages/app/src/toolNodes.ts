/**
 * 工具层节点(mcp / http / tool)的 Provider 装配与工具集取用。
 *
 * 「取哪些工具」统一走 upstreamTools(mcp/tool 命中 toolcache + 搜索派生同步),
 * 「找哪个 Provider」统一走 providerFor(SDK 进程内 > plugin export)。
 * 注册面的 kind:'tool' 配置校验也在这里,保证挂载时即拒不可用的 provider。
 */
import {
  type CallContext,
  check,
  type HelpModel,
  KEY_PLUGIN,
  KEY_PLUGIN_META,
  NodeRegistryStore,
  type PluginDescribe,
  type PluginExport,
  type PluginManifest,
  resolvePluginExport,
  type StateStore,
  TBError,
  toolHelpModel,
  type ToolSpec,
  type TreeNode,
  type TreePath,
  virtualizeTools,
} from '@tool-bridge/core'
import type { UpstreamProvider } from './providers/types'
import {
  isMutableSearchIndex,
  type SearchDirtyMarker,
  SearchSynchronizer,
} from './search/synchronizer'
import { type AppContext, type TbAppDeps, TOOL_CACHE_TTL_DEFAULT } from './deps'
import { assertNoDeviceMarker, deviceToolMarker } from './deviceNodes'
import { createHttpProvider, type HttpConfig } from './providers/http'
import { createMcpProvider, type McpConfig } from './providers/mcp'
import { createPluginToolProvider } from './providers/pluginTool'
import { getTools } from './providers/toolCache'

/** 取上游工具集:mcp/tool 走 `toolcache:<path>` 缓存(TTL + refresh);http 从 config 直接生成。 */
export function upstreamTools(
  node: TreeNode,
  provider: UpstreamProvider,
  deps: TbAppDeps,
  refresh: boolean,
  now: string,
): Promise<ToolSpec[]> {
  if (node.kind === 'mcp' || node.kind === 'tool') {
    const sync = isMutableSearchIndex(deps.search)
      ? new SearchSynchronizer(deps.state, deps.search)
      : undefined
    let marker: SearchDirtyMarker | undefined
    return getTools(deps.state, node.path, () => provider.list(), {
      refresh,
      ttl: deps.toolCacheTtlSec ?? TOOL_CACHE_TTL_DEFAULT,
      now,
      ...(sync === undefined
        ? {}
        : {
            beforeFresh: async () => {
              marker = await sync.markNode(node.path)
            },
            onFreshError: async () => await sync.abort(marker),
            onFresh: async tools => await sync.reconcileNodeQuietly(node.path, { marker, tools }),
          }),
    })
  }
  return provider.list()
}
// ---------- plugin 挂载消费 ----------

/**
 * 取已注册且启用的 plugin,并选出挂载目标 export(plugin/v2)。
 *
 * v1 用 manifest.kind 判「这个 plugin 是不是我要的类型」;v2 的类型属于 **export**,
 * 故改为:取 manifest(存在 + 启用)→ 取注册时缓存的 `~describe` → 按挂载配置的
 * `config.export` 与节点 kind 选出唯一 export(单 export 可省略;多 export 必须显式,
 * 见 core resolvePluginExport)。不存在/禁用 → invalid_argument(不泄露更多)。
 */
export async function requirePluginExport(
  store: StateStore,
  id: string,
  nodeKind: 'tool' | 'context',
  what: 'context' | 'tool',
  exportId?: string,
): Promise<{ export: PluginExport, manifest: PluginManifest }> {
  const manifest = (await store.get(KEY_PLUGIN + id)) as PluginManifest | null
  if (manifest === null) {
    throw new TBError('invalid_argument', `未知 ${what} provider:'${id}'`)
  }
  if (manifest.enabled !== true) {
    throw new TBError('invalid_argument', `plugin '${id}' 已禁用`)
  }
  const describe = (await store.get(KEY_PLUGIN_META + id)) as PluginDescribe | null
  if (describe === null) {
    throw new TBError('invalid_argument', `plugin '${id}' 缺少 ~describe 缓存,请重新注册`)
  }
  const chosen = resolvePluginExport(describe, {
    nodeKind,
    pluginId: id,
    ...(exportId !== undefined ? { exportId } : {}),
  })
  return { manifest, export: chosen }
}

/**
 * plugin 调用的挂载上下文:同一 plugin 可多路径挂载,envelope 里带 mountPath 与
 * 挂载节点的 providerConfig(mountConfig)供 plugin 区分挂载来源;老 plugin 按
 * "未知字段忽略"原则不受影响。
 */
export function mountCallContext(
  ctx: CallContext,
  mountPath: TreePath,
  providerConfig: Record<string, unknown> | undefined,
  exportId?: string,
): CallContext {
  return {
    ...ctx,
    mountPath,
    ...(providerConfig !== undefined ? { mountConfig: providerConfig } : {}),
    // v2 多 export:plugin 据此把调用路由到正确的 export。
    ...(exportId !== undefined ? { exportId } : {}),
  }
}

/** 为 mcp/http/tool 节点构造对应 Provider(其余 kind 无 Provider → unimplemented)。 */
export async function providerFor(
  node: TreeNode,
  ctx: CallContext,
  deps: TbAppDeps,
): Promise<UpstreamProvider> {
  const insecure = deps.allowInsecureHttp
  if (node.kind === 'mcp' && node.config?.kind === 'mcp') {
    return createMcpProvider(node.config as McpConfig, deps.secrets, {
      allowInsecure: insecure,
      // 会话复用凭证存 StateStore(mcpsession:<path>);调用结果不缓存(providers/mcp.ts)。
      session: { store: deps.state, nodePath: node.path },
      // auth:'oauth' 节点的托管凭证存取面(mcpoauth:*);密钥缺省 → provider 内报 unavailable。
      ...(deps.encryptionKey !== undefined
        ? { oauth: { store: deps.state, encryptionKey: deps.encryptionKey } }
        : {}),
    })
  }
  if (node.kind === 'http' && node.config?.kind === 'http') {
    return createHttpProvider(node.config as HttpConfig, deps.secrets, { allowInsecure: insecure })
  }
  if (node.kind === 'tool' && node.config?.kind === 'tool') {
    // SDK 进程内工具源(registerTool):按节点路径查本实例表,先于 plugin 解析。
    const local = deps.locals?.tool?.(node.path)
    if (local !== undefined) return local
    // plugin 工具源:provider = 已注册 tool-provider plugin 的 id。
    const { manifest, export: exported } = await requirePluginExport(
      deps.state,
      node.config.provider,
      'tool',
      'tool',
      node.config.export,
    )
    return createPluginToolProvider({
      manifest,
      secrets: deps.secrets,
      ctx: mountCallContext(ctx, node.path, node.config.providerConfig, exported.id),
      // 挂载 authRef = 上游凭证引用,平台代解析经 X-TB-Upstream-Auth 注入。
      ...(node.config.authRef !== undefined ? { upstreamAuthRef: node.config.authRef } : {}),
      ...(deps.pluginBindings !== undefined ? { bindings: deps.pluginBindings } : {}),
    })
  }
  throw TBError.unimplemented(`kind '${node.kind}' has no tool provider`)
}

/** 注册变更后主动 materialize 动态工具表；失败时保留 dirty marker，由后续 fresh list 修复。 */
export async function refreshDynamicSearchNode(
  node: TreeNode,
  ctx: CallContext,
  deps: TbAppDeps,
): Promise<boolean> {
  if ((node.kind !== 'mcp' && node.kind !== 'tool') || deviceToolMarker(node) !== null) return false
  try {
    const provider = await providerFor(node, ctx, deps)
    await upstreamTools(node, provider, deps, true, new Date().toISOString())
    return true
  } catch {
    // Canonical registry mutation remains successful; marker keeps derived search repairable.
    return false
  }
}

export async function refreshDynamicToolCache(
  node: TreeNode,
  ctx: CallContext,
  deps: TbAppDeps,
): Promise<void> {
  if ((node.kind !== 'mcp' && node.kind !== 'tool') || deviceToolMarker(node) !== null) return
  const provider = await providerFor(node, ctx, deps)
  await getTools(deps.state, node.path, () => provider.list(), {
    refresh: true,
    ttl: deps.toolCacheTtlSec ?? TOOL_CACHE_TTL_DEFAULT,
    now: new Date().toISOString(),
  })
}

/**
 * 工具级 `~help`(两级披露的细节级):path 非注册节点时,最长前缀 resolve 命中
 * mcp/http 节点且 rest 恰为一段(工具虚拟名)→ 单工具全量 HelpModel。工具集取自与节点级
 * 相同的缓存(getTools),不额外打上游。不匹配/工具不存在 → null(调用方 404)。
 * 可见性与列表面一致(read+call;deny==not_found 不泄露存在性)。
 */
export async function toolHelpModelFor(
  c: AppContext,
  ctx: CallContext,
  registry: NodeRegistryStore,
  path: TreePath,
  deps: TbAppDeps,
): Promise<HelpModel | null> {
  let resolved: { node: TreeNode, rest: string }
  try {
    resolved = await registry.resolve(path)
  } catch {
    return null
  }
  const { node, rest } = resolved
  if (
    (node.kind !== 'mcp' && node.kind !== 'http' && node.kind !== 'tool')
    || node.config === undefined
  ) {
    return null
  }
  if (rest === '' || rest.includes('/')) return null
  if (!check(ctx, node.path, 'read').allow || !check(ctx, node.path, 'call').allow) return null
  // device 自定义 tool 节点:工具表来自注册时缓存的 providerConfig.cmds,不打设备。
  const marker = deviceToolMarker(node)
  if (marker !== null) {
    const cached = (marker.cmds ?? []).find(t => t.name === rest)
    if (cached === undefined) return null
    return toolHelpModel(node.path, { kind: node.kind, description: node.description }, cached)
  }
  const provider = await providerFor(node, ctx, deps)
  const refresh = c.req.query('refresh') === '1'
  const raw = await upstreamTools(node, provider, deps, refresh, new Date().toISOString())
  const { exposed } = virtualizeTools(node.virtualize, raw)
  const tool = exposed.find(t => t.name === rest)
  if (tool === undefined) return null
  return toolHelpModel(node.path, { kind: node.kind, description: node.description }, tool)
}
/**
 * 注册/更新 kind:'tool' 节点时的配置校验(注册时即拒):
 * provider 必须是已注册且启用的 tool-provider plugin(SDK 保留 id '@local' 由
 * SDK 内部注册通道落库,不经注册面)。
 */
export async function assertToolConfig(config: unknown, store: StateStore): Promise<void> {
  if (config === null || typeof config !== 'object') return
  if ((config as { kind?: unknown }).kind !== 'tool') return
  assertNoDeviceMarker(config)
  const provider = (config as { provider?: unknown }).provider
  if (typeof provider !== 'string' || provider === '') {
    throw new TBError('invalid_argument', 'kind:\'tool\' 节点需要 config.provider(plugin id)')
  }
  const exportId = (config as { export?: unknown }).export
  await requirePluginExport(
    store,
    provider,
    'tool',
    'tool',
    typeof exportId === 'string' ? exportId : undefined,
  )
}
