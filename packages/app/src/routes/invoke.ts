/**
 * `POST /<path>`:数据面调用总入口(信封 `{tool, arguments}` 与直连工具路径两种形态)。
 *
 * 一个 handler 覆盖全部可调用 kind,分支顺序即语义优先级:remote 透传 → device 自定义
 * tool 标记(provider 是设备本地保留 id,须先于 plugin 分支)→ mcp/http/tool 上游 →
 * device shell → context/skillhub 动词 → builtin。可见性(read→404)统一在最前判,
 * 各分支只判自己的 call/read/write/admin scope。
 */
import {
  assertSecretRefUse,
  check,
  contextScopeForCmd,
  isTBError,
  KEY_PLUGIN,
  negotiate,
  NodeRegistryStore,
  type PluginManifest,
  resolveUpstreamTool,
  skillhubScopeForCmd,
  TBError,
  type TreeNode,
  type TreePath,
} from '@tool-bridge/core'
import type { SearchDirtyMarker } from '../search/synchronizer'
import type { AppContext } from '../deps'
import type { RouteEnv } from './env'
import {
  assertContextAlive,
  assertContextConfig,
  assertSkillhubConfig,
  contextProviderFor,
  deviceIdForDeviceFs,
  dispatchContextCmd,
  dispatchSkillhubCmd,
  localContext,
  skillhubProviderFor,
} from '../contextNodes'
import {
  assertToolConfig,
  mountCallContext,
  providerFor,
  refreshDynamicSearchNode,
  refreshDynamicToolCache,
  requirePluginExport,
  upstreamTools,
} from '../toolNodes'
import { assertRemoteConfigAllowed, remotePassthroughIfMatch, resolveRemoteSettings } from '../federation'
import { deviceMarkerOf, deviceToolMarker, invokeDevice, relativeDevicePath } from '../deviceNodes'
import { createPluginContextProvider } from '../providers/pluginContext'
import { assertRegisterPath, decodePath, scopeForCmd } from '../paths'
import { invalidateToolCache } from '../providers/toolCache'
import { renderResult, tbErrorResponse } from '../responses'
import { invalidateProviderOAuth } from '../providerOAuth'
import { invalidateMcpEra } from '../providers/mcp'
import { invalidateMcpOAuth } from '../oauth'

// --- POST /<path> 数据面调用 ---
export async function handleInvoke(c: AppContext, env: RouteEnv): Promise<Response> {
  const { builtinsOf, deps, searchSync } = env
  const rawEncoded = new URL(c.req.url).pathname.replace(/^\/+|\/+$/g, '')
  if (rawEncoded === '') throw TBError.notFound('no such path')
  const raw = decodePath(rawEncoded)
  if (raw.split('/').some(s => s.startsWith('~'))) throw TBError.notFound('no such path')
  const ctx = c.get('ctx')
  const store = c.get('store')
  const registry = new NodeRegistryStore(store)

  // 节点不可见 → 404(隐藏存在性)。
  if (!check(ctx, raw, 'read').allow) throw TBError.notFound('not found')

  // remote 透传:命中 remote 节点(或其后代)→ 改写 POST 打到 baseUrl(scope 恒 'call')。
  const remote = await remotePassthroughIfMatch(c, ctx, registry, raw, null, deps)
  if (remote) return remote

  let node: TreeNode
  // 直连工具路径(POST /<node>/<tool>)命中时为工具虚拟名;body 即 arguments 本体。
  let directTool: string | null = null
  try {
    node = await registry.get(raw)
  } catch {
    // 非注册路径:最长前缀命中 mcp/http/tool 节点且剩余恰一段 → 直连工具调用
    // (与工具级 ~help 同一路径面);其余 404。可见性按节点 path 复判
    // (raw 含工具段,scope 精确到节点路径时会漏判)。
    const resolved = await registry.resolve(raw).catch(() => null)
    if (
      resolved === null
      || (resolved.node.kind !== 'mcp'
        && resolved.node.kind !== 'http'
        && resolved.node.kind !== 'tool')
      || resolved.node.config === undefined
      || resolved.rest === ''
      || resolved.rest.includes('/')
    ) {
      throw TBError.notFound('not found')
    }
    if (!check(ctx, resolved.node.path, 'read').allow) throw TBError.notFound('not found')
    node = resolved.node
    directTool = resolved.rest
  }

  // 解析调用体:直连路径 body 即 arguments(可空);节点路径沿用 {tool,arguments} 信封。
  const readInvokeBody = async (): Promise<{
    args: Record<string, unknown>
    tool: string
  }> => {
    const parsed = (await c.req.json().catch(() => null)) as unknown
    if (directTool !== null) {
      if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
        throw new TBError('invalid_argument', 'body must be a JSON object (tool arguments)')
      }
      return { tool: directTool, args: (parsed ?? {}) as Record<string, unknown> }
    }
    const body = parsed as { arguments?: unknown, tool?: unknown } | null
    if (!body || typeof body.tool !== 'string') {
      throw new TBError('invalid_argument', 'body must be {tool, arguments}')
    }
    return { tool: body.tool, args: (body.arguments ?? {}) as Record<string, unknown> }
  }

  // --- device 自定义 tool 节点:providerConfig 标记 → 帧协议 call 转发。 ---
  // 须先于 mcp/http/tool 通用分支:provider 是设备本地保留 id(如 '@local'),不是 plugin。
  const toolMarker = deviceToolMarker(node)
  if (toolMarker !== null) {
    if (!check(ctx, node.path, 'call').allow) {
      throw new TBError('permission_denied', `no scope grants 'call' on '${node.path}'`)
    }
    const { tool, args } = await readInvokeBody()
    const result = await invokeDevice(deps, toolMarker.deviceId, {
      path: relativeDevicePath(node.path, toolMarker.mountPath),
      tool,
      arguments: args,
    })
    return renderResult(result, negotiate(c.req.header('accept')))
  }

  // --- mcp/http/tool 上游工具调用:scope 恒 'call';虚拟名反查上游真名再调 Provider。 ---
  if (
    (node.kind === 'mcp' || node.kind === 'http' || node.kind === 'tool')
    && node.config !== undefined
  ) {
    if (!check(ctx, node.path, 'call').allow) {
      throw new TBError('permission_denied', `no scope grants 'call' on '${node.path}'`)
    }
    const { tool, args } = await readInvokeBody()
    const provider = await providerFor(node, ctx, deps)
    const tools = await upstreamTools(node, provider, deps, false, new Date().toISOString())
    const upstreamName = resolveUpstreamTool(node.virtualize, tools, tool)
    const result = await provider.call(upstreamName, args)
    // MCP RPC 业务错误(result.isError)是正常返回值(HTTP 200),按协商渲染其 content。
    return renderResult(result.content, negotiate(c.req.header('accept')))
  }

  // --- device shell 调用:节点级 read/call 后转发到设备通道。 ---
  if (node.kind === 'device' && node.config?.kind === 'device') {
    if (!check(ctx, node.path, 'call').allow) {
      throw new TBError('permission_denied', `no scope grants 'call' on '${node.path}'`)
    }
    const body = (await c.req.json().catch(() => null)) as {
      arguments?: unknown
      tool?: unknown
    } | null
    if (!body || typeof body.tool !== 'string') {
      throw new TBError('invalid_argument', 'body must be {tool, arguments}')
    }
    if (body.tool !== 'exec') {
      throw new TBError('invalid_argument', `unknown cmd '${body.tool}' on '${node.path}'`)
    }
    const result = await invokeDevice(deps, node.config.deviceId, {
      path: 'shell',
      tool: body.tool,
      arguments: (body.arguments ?? {}) as Record<string, unknown>,
    })
    return renderResult(result, negotiate(c.req.header('accept')))
  }

  // --- context namespace 数据面:四动词 + Search/Delete,cmd→scope 静态表判定。 ---
  if (node.kind === 'context' && node.config?.kind === 'context') {
    const cfg = node.config
    // ttl 懒回收:POST 命中即判,过期删节点并 404。
    await assertContextAlive(node, cfg, registry)
    const body = (await c.req.json().catch(() => null)) as {
      arguments?: unknown
      tool?: unknown
    } | null
    if (!body || typeof body.tool !== 'string') {
      throw new TBError('invalid_argument', 'body must be {tool, arguments}')
    }
    const scope = contextScopeForCmd(body.tool)
    if (scope === null) {
      throw new TBError('invalid_argument', `unknown cmd '${body.tool}' on '${node.path}'`)
    }
    // 节点可见性(read→404)已在上方统一判过;这里按 cmd 的 read/write scope 判 403。
    if (!check(ctx, node.path, scope).allow) {
      throw new TBError('permission_denied', `no scope grants '${scope}' on '${node.path}'`)
    }
    // readOnly 挂载对写动词直接拒(provider 内亦拒,双保险)。
    if (cfg.readOnly === true && scope === 'write') {
      throw new TBError('permission_denied', `readOnly 挂载拒绝 '${body.tool}'`)
    }
    const args = (body.arguments ?? {}) as Record<string, unknown>
    if (cfg.provider === 'device-fs') {
      const result = await invokeDevice(deps, deviceIdForDeviceFs(cfg), {
        path: 'fs',
        tool: body.tool,
        arguments: args,
      })
      return renderResult(result, negotiate(c.req.header('accept')))
    }
    // device 自定义 context 节点:标记命中 → 相对路径转发到设备。
    const contextMarker = deviceMarkerOf(cfg.providerConfig)
    if (cfg.provider !== 'r2' && cfg.provider !== 's3' && contextMarker !== null) {
      const result = await invokeDevice(deps, contextMarker.deviceId, {
        path: relativeDevicePath(node.path, contextMarker.mountPath),
        tool: body.tool,
        arguments: args,
      })
      return renderResult(result, negotiate(c.req.header('accept')))
    }
    if (cfg.provider !== 'r2' && cfg.provider !== 's3') {
      // SDK 进程内 context Provider(registerContext):按节点路径查本实例表。
      const local = localContext(deps, node)
      if (local !== null) {
        const result = await dispatchContextCmd(local, body.tool, args)
        return renderResult(result, negotiate(c.req.header('accept')))
      }
      // plugin-backed context:provider 非 r2/s3 视为 plugin id,
      // 经 envelope 转发;plugin 不存在/禁用/kind 不符 → invalid_argument。
      const { manifest, export: exported } = await requirePluginExport(
        store,
        cfg.provider,
        'context',
        'context',
        cfg.export,
      )
      const provider = createPluginContextProvider({
        manifest,
        secrets: deps.secrets,
        ctx: mountCallContext(ctx, node.path, cfg.providerConfig, exported.id),
        capabilities: exported.capabilities ?? [],
        ...(exported.methods !== undefined ? { methods: exported.methods } : {}),
        // 挂载 authRef = 上游凭证引用,平台代解析经 X-TB-Upstream-Auth 注入。
        ...(cfg.authRef !== undefined ? { upstreamAuthRef: cfg.authRef } : {}),
        ...(deps.pluginBindings !== undefined ? { bindings: deps.pluginBindings } : {}),
      })
      const result = await dispatchContextCmd(provider, body.tool, args)
      return renderResult(result, negotiate(c.req.header('accept')))
    }
    const provider = await contextProviderFor(node, cfg, deps, c.req.url)
    const result = await dispatchContextCmd(provider, body.tool, args)
    return renderResult(result, negotiate(c.req.header('accept')))
  }

  // --- skillhub 数据面:List/Get/Search(read)+ Publish/Remove(write)。 ---
  if (node.kind === 'skillhub' && node.config?.kind === 'skillhub') {
    const cfg = node.config
    // ttl 懒回收:POST 命中即判,过期删节点并 404。
    await assertContextAlive(node, cfg, registry)
    const body = (await c.req.json().catch(() => null)) as {
      arguments?: unknown
      tool?: unknown
    } | null
    if (!body || typeof body.tool !== 'string') {
      throw new TBError('invalid_argument', 'body must be {tool, arguments}')
    }
    const scope = skillhubScopeForCmd(body.tool)
    if (scope === null) {
      throw new TBError('invalid_argument', `unknown cmd '${body.tool}' on '${node.path}'`)
    }
    // 节点可见性(read→404)已统一判过;这里按 cmd 的 read/write scope 判 403。
    if (!check(ctx, node.path, scope).allow) {
      throw new TBError('permission_denied', `no scope grants '${scope}' on '${node.path}'`)
    }
    if (cfg.readOnly === true && scope === 'write') {
      throw new TBError('permission_denied', `readOnly 挂载拒绝 '${body.tool}'`)
    }
    const args = (body.arguments ?? {}) as Record<string, unknown>
    const provider = await skillhubProviderFor(node, cfg, deps, c.req.url)
    const result = await dispatchSkillhubCmd(provider, body.tool, args)
    return renderResult(result, negotiate(c.req.header('accept')))
  }

  if (node.kind !== 'builtin' || node.config?.kind !== 'builtin') {
    throw TBError.unimplemented(`kind '${node.kind}' not callable`)
  }

  const builtins = builtinsOf(store)
  const mod = builtins.get(node.config.module)
  if (!mod) throw TBError.unimplemented(`builtin module '${node.config.module}' not available`)

  const body = (await c.req.json().catch(() => null)) as {
    arguments?: unknown
    tool?: unknown
  } | null
  if (!body || typeof body.tool !== 'string') {
    throw new TBError('invalid_argument', 'body must be {tool, arguments}')
  }
  const cmd = body.tool
  const args = (body.arguments ?? {}) as Record<string, unknown>

  const spec = scopeForCmd(mod, node.path, cmd)
  if (!spec) throw new TBError('invalid_argument', `unknown cmd '${cmd}' on '${node.path}'`)

  // 按 cmd 声明的 scope 判定(资源 = 节点 path)。
  if (!check(ctx, node.path, spec.scope).allow) {
    throw new TBError('permission_denied', `no scope grants '${spec.scope}' on '${node.path}'`)
  }

  // registry 模块的 write/update/delete 额外过注册路径规则(资源 = arguments.path)。
  let registryTarget: string | undefined
  if (node.config.module === 'registry' && ['write', 'update', 'delete'].includes(cmd)) {
    const targetPath = typeof args.path === 'string' ? args.path : undefined
    if (targetPath === undefined) {
      throw new TBError('invalid_argument', 'field \'path\' must be a string')
    }
    // 挂载/更新 remote 节点时校验 baseUrl 白名单(注册时即拒)。
    const cfgPatch
      = cmd === 'write'
        ? args.config
        : cmd === 'update'
          ? (args.patch as { config?: unknown } | undefined)?.config
          : undefined
    // 挂载/更新 remote 节点时校验 baseUrl 白名单(注册时即拒;env 基线 ∪ 运行时条目)。
    assertRemoteConfigAllowed(cfgPatch, await resolveRemoteSettings(store, deps.remote))
    await assertRegisterPath(
      registry,
      ctx,
      targetPath,
      cmd === 'delete' ? 'delete' : 'write',
      deps,
    )
    // Secret Reference 使用授权:绑定 authRef/skRef 须持 system/secret admin(注册路径
    // 判定之后、落库之前;delete 无 config 自然放行)。confused-deputy 合入阻断项。
    assertSecretRefUse(ctx.scopes, cfgPatch)
    // context 配置校验 + s3 连通探测:探测出站网络,须在权限判定之后。
    await assertContextConfig(cfgPatch, deps)
    // skillhub 配置校验(provider r2/s3;s3 连通探测)。
    await assertSkillhubConfig(cfgPatch, deps)
    // kind:'tool' 挂载校验:provider 必须是已注册且启用的 tool-provider plugin;
    // export 声明了 credentialProbe 且配了 authRef 时,再用该凭证真实探一次。
    await assertToolConfig(cfgPatch, deps, ctx, targetPath)
    registryTarget = targetPath
  }
  if (registryTarget !== undefined && (cmd === 'write' || cmd === 'update')) {
    await searchSync?.ensureSeeded()
  }

  let pluginMounts: Array<{ marker?: SearchDirtyMarker, node: TreeNode }> = []
  if (node.config.module === 'plugin' && ['write', 'update', 'delete'].includes(cmd)) {
    const pluginId = typeof args.id === 'string' ? args.id : undefined
    if (pluginId !== undefined) {
      const mounts = (await registry.subtree('')).filter(candidate => (
        candidate.kind === 'tool'
        && candidate.config?.kind === 'tool'
        && candidate.config.provider === pluginId
      ))
      pluginMounts = await Promise.all(mounts.map(async candidate => ({
        marker: await searchSync?.markNode(candidate.path),
        node: candidate,
      })))
    }
  }

  const registryMarker = registryTarget === undefined
    ? undefined
    : await searchSync?.markNode(registryTarget)
  let result: unknown
  try {
    result = await mod.dispatch(cmd, args, ctx)
  } catch (error) {
    await searchSync?.abort(registryMarker)
    await Promise.all(pluginMounts.map(async mount => await searchSync?.abort(mount.marker)))
    if (isTBError(error)) return tbErrorResponse(error)
    return tbErrorResponse(new TBError('internal', 'internal error'))
  }
  // 注册变更 → 失效该节点工具缓存 + mcp 会话/两套 OAuth 令牌(Write/Update/Delete 触发失效)。
  if (registryTarget !== undefined) {
    await invalidateToolCache(store, registryTarget)
    await invalidateMcpEra(store, registryTarget)
    await invalidateMcpOAuth(store, registryTarget)
    await invalidateProviderOAuth(store, registryTarget)
    await searchSync?.reconcileNodeQuietly(registryTarget, { marker: registryMarker })
    const current = await registry.get(registryTarget).catch(() => null)
    if (current !== null && await refreshDynamicSearchNode(current, ctx, deps)) {
      await searchSync?.abort(registryMarker)
    }
  }
  const pluginEmptyPaths: TreePath[] = []
  for (const mount of pluginMounts) {
    await invalidateToolCache(store, mount.node.path)
    await invalidateMcpEra(store, mount.node.path)
    await invalidateMcpOAuth(store, mount.node.path)
    await invalidateProviderOAuth(store, mount.node.path)
    const providerId = mount.node.config?.kind === 'tool'
      ? mount.node.config.provider
      : ''
    const manifest = await store.get(KEY_PLUGIN + providerId)
    if (
      manifest !== null
      && (manifest as PluginManifest).enabled !== false
    ) {
      try {
        await refreshDynamicToolCache(mount.node, ctx, deps)
      } catch {
        // Marker remains pending; canonical plugin mutation is already durable.
      }
    } else {
      pluginEmptyPaths.push(mount.node.path)
      await searchSync?.reconcileNodeQuietly(mount.node.path, {
        marker: mount.marker,
        tools: [],
      })
    }
  }
  if (pluginMounts.length > 0) {
    await searchSync?.rebuildAll(
      pluginMounts.flatMap(mount => mount.marker === undefined ? [] : [mount.marker]),
      { authoritativeEmpty: pluginEmptyPaths },
    )
  }
  return renderResult(result, negotiate(c.req.header('accept')))
}
