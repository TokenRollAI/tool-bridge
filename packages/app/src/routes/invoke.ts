/**
 * `POST /<nodePath>/<command>`:数据面调用总入口。唯一形态——命令是节点下的虚拟叶子,
 * body 即 arguments 本体,无 `{tool, arguments}` 信封。resolve 得到 {节点, 命令段};
 * 命令段必须恰一段(非空、不含 '/'),节点本身不可调用(404)。
 *
 * 一个 handler 覆盖全部可调用 kind,分支顺序即语义优先级:remote 透传 → device 自定义
 * tool 标记(provider 是设备本地保留 id,须先于 plugin 分支)→ mcp/http/tool 上游 →
 * device shell → context/skillhub 动词 → builtin。可见性(read→404)与授权统一判在**节点路径**。
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
  createContextUploadGrant,
  deviceIdForDeviceFs,
  dispatchContextCmd,
  dispatchContextUploadCmd,
  dispatchSkillhubCmd,
  localContext,
  parseContextCmdArgs,
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
import { deviceCallContextFrom, deviceMarkerOf, deviceToolMarker, invokeDevice, relativeDevicePath } from '../deviceNodes'
import { assertRemoteConfigAllowed, remotePassthroughIfMatch, resolveRemoteSettings } from '../federation'
import { createPluginContextProvider } from '../providers/pluginContext'
import { assertRegisterPath, decodePath, scopeForCmd } from '../paths'
import { invalidateToolCache } from '../providers/toolCache'
import { renderResult, tbErrorResponse } from '../responses'
import { invalidateProviderOAuth } from '../providerOAuth'
import { rejectStoreCapabilityBodyFields } from './store'
import { resolveStoreRequestOrigin } from '../store'
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

  // remote 透传:命中 remote 节点(或其后代)→ 改写 POST 打到 baseUrl(scope 恒 'call')。
  // remote 判定用完整 raw 路径(含命令段),透传时原样转发给下游。
  const remoteVisible = check(ctx, raw, 'read').allow
  if (remoteVisible) {
    const remote = await remotePassthroughIfMatch(c, ctx, registry, raw, null, deps)
    if (remote) return remote
  }

  // 唯一调用形态:`POST /<nodePath>/<command>`,body 即 arguments 本体(无 {tool,arguments} 信封)。
  // 最长前缀 resolve 得到所属节点与剩余段;剩余段即命令名,必须恰一段(不为空、不含 '/')。
  // 节点本身(rest='')不可调用——必须带命令段。可见性/授权判在**节点路径**(决策:授权只到节点)。
  const resolved = await registry.resolve(raw).catch(() => null)
  if (resolved === null || resolved.rest === '' || resolved.rest.includes('/')) {
    throw TBError.notFound('not found')
  }
  const node: TreeNode = resolved.node
  const command = resolved.rest
  // 节点不可见 → 404(隐藏存在性),判在节点路径。
  if (!check(ctx, node.path, 'read').allow) throw TBError.notFound('not found')

  // 调用体恒为裸 arguments 对象(可空);命令名来自路径叶子段。
  const readInvokeBody = async (): Promise<Record<string, unknown>> => {
    const parsed = (await c.req.json().catch(() => null)) as unknown
    if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
      throw new TBError('invalid_argument', 'body must be a JSON object (command arguments)')
    }
    return (parsed ?? {}) as Record<string, unknown>
  }

  // --- device 自定义 tool 节点:providerConfig 标记 → 帧协议 call 转发。 ---
  // 须先于 mcp/http/tool 通用分支:provider 是设备本地保留 id(如 '@local'),不是 plugin。
  const toolMarker = deviceToolMarker(node)
  if (toolMarker !== null) {
    if (!check(ctx, node.path, 'call').allow) {
      throw new TBError('permission_denied', `no scope grants 'call' on '${node.path}'`)
    }
    const args = await readInvokeBody()
    const result = await invokeDevice(deps, toolMarker.deviceId, {
      // 帧 path 含命令叶子段:<mount 相对路径>/<命令>。
      path: `${relativeDevicePath(node.path, toolMarker.mountPath)}/${command}`,
      arguments: args,
      context: deviceCallContextFrom(ctx),
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
    const args = await readInvokeBody()
    const provider = await providerFor(node, ctx, deps)
    const tools = await upstreamTools(node, provider, deps, false, new Date().toISOString())
    const upstreamName = resolveUpstreamTool(node.virtualize, tools, command)
    const result = await provider.call(upstreamName, args)
    // MCP RPC 业务错误(result.isError)是正常返回值(HTTP 200),按协商渲染其 content。
    return renderResult(result.content, negotiate(c.req.header('accept')))
  }

  // --- device shell 调用:节点级 read/call 后转发到设备通道。 ---
  if (node.kind === 'device' && node.config?.kind === 'device') {
    if (!check(ctx, node.path, 'call').allow) {
      throw new TBError('permission_denied', `no scope grants 'call' on '${node.path}'`)
    }
    const args = await readInvokeBody()
    if (command !== 'exec') {
      throw new TBError('invalid_argument', `unknown cmd '${command}' on '${node.path}'`)
    }
    const result = await invokeDevice(deps, node.config.deviceId, {
      path: 'shell/exec',
      arguments: args,
      context: deviceCallContextFrom(ctx),
    })
    return renderResult(result, negotiate(c.req.header('accept')))
  }

  // --- context namespace 数据面:四动词 + Search/Delete,cmd→scope 静态表判定。 ---
  if (node.kind === 'context' && node.config?.kind === 'context') {
    const cfg = node.config
    // ttl 懒回收:POST 命中即判,过期删节点并 404。
    await assertContextAlive(node, cfg, registry)
    const args = await readInvokeBody()
    const scope = contextScopeForCmd(command)
    const directUpload = command === 'create_upload'
    if (scope === null || (directUpload && cfg.provider !== 'r2' && cfg.provider !== 's3')) {
      throw new TBError('invalid_argument', `unknown cmd '${command}' on '${node.path}'`)
    }
    // 节点可见性(read→404)已在上方统一判过;这里按 cmd 的 read/write scope 判 403。
    if (!check(ctx, node.path, scope).allow) {
      throw new TBError('permission_denied', `no scope grants '${scope}' on '${node.path}'`)
    }
    // readOnly 挂载对写动词直接拒(provider 内亦拒,双保险)。
    if (cfg.readOnly === true && scope === 'write') {
      throw new TBError('permission_denied', `readOnly 挂载拒绝 '${command}'`)
    }
    if (directUpload) {
      const result = await dispatchContextUploadCmd(
        args,
        input => createContextUploadGrant(node, cfg, deps, input),
      )
      return renderResult(result, negotiate(c.req.header('accept')))
    }
    if (cfg.provider === 'device-fs') {
      const forwardedArgs = parseContextCmdArgs(command, args)
      const result = await invokeDevice(deps, deviceIdForDeviceFs(cfg), {
        path: `fs/${command}`,
        arguments: forwardedArgs,
        context: deviceCallContextFrom(ctx),
      })
      return renderResult(result, negotiate(c.req.header('accept')))
    }
    // device 自定义 context 节点:标记命中 → 相对路径转发到设备。
    const contextMarker = deviceMarkerOf(cfg.providerConfig)
    if (cfg.provider !== 'r2' && cfg.provider !== 's3' && contextMarker !== null) {
      const forwardedArgs = parseContextCmdArgs(command, args)
      const result = await invokeDevice(deps, contextMarker.deviceId, {
        path: `${relativeDevicePath(node.path, contextMarker.mountPath)}/${command}`,
        arguments: forwardedArgs,
        context: deviceCallContextFrom(ctx),
      })
      return renderResult(result, negotiate(c.req.header('accept')))
    }
    if (cfg.provider !== 'r2' && cfg.provider !== 's3') {
      // SDK 进程内 context Provider(registerContext):按节点路径查本实例表。
      const local = localContext(deps, node)
      if (local !== null) {
        const result = await dispatchContextCmd(local, command, args)
        return renderResult(result, negotiate(c.req.header('accept')))
      }
      // plugin-backed context:provider 非 r2/s3 视为 plugin id,
      // 经 envelope 转发;plugin 不存在/禁用/kind 不符 → invalid_argument。
      const { manifest, export: exported } = await requirePluginExport(
        deps,
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
      const result = await dispatchContextCmd(provider, command, args)
      return renderResult(result, negotiate(c.req.header('accept')))
    }
    const provider = await contextProviderFor(node, cfg, deps, c.req.url)
    const result = await dispatchContextCmd(provider, command, args)
    return renderResult(result, negotiate(c.req.header('accept')))
  }

  // --- skillhub 数据面:List/Get/Search(read)+ Publish/Remove(write)。 ---
  if (node.kind === 'skillhub' && node.config?.kind === 'skillhub') {
    const cfg = node.config
    // ttl 懒回收:POST 命中即判,过期删节点并 404。
    await assertContextAlive(node, cfg, registry)
    const args = await readInvokeBody()
    const scope = skillhubScopeForCmd(command)
    if (scope === null) {
      throw new TBError('invalid_argument', `unknown cmd '${command}' on '${node.path}'`)
    }
    // 节点可见性(read→404)已统一判过;这里按 cmd 的 read/write scope 判 403。
    if (!check(ctx, node.path, scope).allow) {
      throw new TBError('permission_denied', `no scope grants '${scope}' on '${node.path}'`)
    }
    if (cfg.readOnly === true && scope === 'write') {
      throw new TBError('permission_denied', `readOnly 挂载拒绝 '${command}'`)
    }
    const provider = await skillhubProviderFor(node, cfg, deps, c.req.url)
    const result = await dispatchSkillhubCmd(provider, command, args)
    return renderResult(result, negotiate(c.req.header('accept')))
  }

  if (node.kind !== 'builtin' || node.config?.kind !== 'builtin') {
    throw TBError.unimplemented(`kind '${node.kind}' not callable`)
  }

  const builtins = builtinsOf(store)
  const mod = builtins.get(node.config.module)
  if (!mod) throw TBError.unimplemented(`builtin module '${node.config.module}' not available`)

  const args = await readInvokeBody()
  const cmd = command
  rejectStoreCapabilityBodyFields(node.config.module, args)

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
    result = await mod.dispatch(cmd, args, ctx, {
      requestOrigin: resolveStoreRequestOrigin(c.req.url, deps.canonicalOrigin),
    })
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
