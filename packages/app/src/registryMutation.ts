/**
 * 注册面 NodeConfig 变更的共享安全链与派生状态失效。
 *
 * system/registry 的 write/update/delete 与 `~register` 是同一份外部契约的两条通道,
 * "两通道同权"由本模块的单点实现从代码结构上保证,不靠两处手写链逐行对拍。
 * (第三条写入口——设备 hello——输入形状不同,其等价判定在 deviceHello.ts。)
 *
 * 链内顺序是硬约束:注册路径规则与 Secret Reference 授权在前,出站探测
 * (s3 连通、凭证探针)在后。调用方须先完成自己通道的 scope 判定
 * (system/registry 的 cmd scope / `~register` 的 register scope)再进此链。
 */
import {
  assertSecretRefUse,
  type CallContext,
  check,
  eventBindingSchema,
  isTBError,
  type NodeRegistryStore,
  type StateStore,
  TBError,
  type TreePath,
} from '@tool-bridge/core'
import type { TbAppDeps } from './deps'
import { assertContextConfig, assertSkillhubConfig, bindPlatformStorageConfig } from './contextNodes'
import { assertPluginMountContract, assertToolConfig, requirePluginExport } from './toolNodes'
import { assertRemoteConfigAllowed, resolveRemoteSettings } from './federation'
import { assertMcpOAuthConfig, invalidateMcpOAuth } from './oauth'
import { invalidateToolCache } from './providers/toolCache'
import { invalidateProviderOAuth } from './providerOAuth'
import { invalidateMcpEra } from './providers/mcp'
import { assertRegisterPath } from './paths'

export async function assertNodeConfigMutation(opts: {
  /** delete 无 config(下方各 config 校验对 undefined 自然放行)。 */
  action: 'delete' | 'write'
  config: unknown
  ctx: CallContext
  deps: TbAppDeps
  kind?: unknown
  registry: NodeRegistryStore
  targetPath: TreePath
}): Promise<void> {
  const { action, config, ctx, deps, registry, targetPath } = opts
  // 挂载/更新 remote 节点时校验 baseUrl 白名单(注册时即拒;env 基线 ∪ 运行时条目)。
  assertRemoteConfigAllowed(config, await resolveRemoteSettings(deps.state, deps.remote))
  // 注册路径规则(含 existing 占用查询;deps.reservedRoots 追加保留根)。
  await assertRegisterPath(registry, ctx, targetPath, action, deps)
  // Secret Reference 使用授权:绑定 authRef/skRef 须持 system/secret admin(注册路径
  // 判定之后、落库之前)。受限注册者不得引用平台已有 Secret(confused-deputy 合入阻断项)。
  assertSecretRefUse(ctx.scopes, config)
  // mcp oauthClient 的服务端权威校验:client secret 只能是 SecretStore 引用。
  await assertMcpOAuthConfig(config, deps.secrets)
  const previous = await registry.get(targetPath).catch((error: unknown) => {
    if (!isTBError(error) || error.code !== 'not_found') throw error
    return undefined
  })
  if (opts.kind === 'topic' || previous?.kind === 'topic') {
    if (!check(ctx, targetPath, 'admin').allow) throw new TBError('permission_denied', 'topic administration requires admin on the topic')
    if (previous && opts.kind !== undefined && opts.kind !== previous.kind) {
      throw new TBError('conflict', 'unmount the existing node before changing a topic binding')
    }
    if (action === 'write' && (opts.kind ?? previous?.kind) === 'topic') {
      if (!deps.eventRepository) throw new TBError('unavailable', 'event repository is unavailable')
      if (opts.kind === 'topic' && previous?.config !== undefined && config === undefined) {
        throw new TBError('conflict', 'path is occupied by a bound event source')
      }
      if (config !== undefined) {
        const parsed = eventBindingSchema.safeParse(config)
        if (!parsed.success) throw new TBError('invalid_argument', 'invalid event source binding')
        const binding = parsed.data
        const { export: descriptor } = await requirePluginExport(deps, binding.provider, 'topic', 'topic', binding.export)
        await assertPluginMountContract(descriptor, binding, deps)
      }
    }
  }
  if (action === 'write') {
    await bindPlatformStorageConfig(config, previous?.config, deps)
  }
  // context 配置校验 + s3 连通探测:探测出站网络,须在权限判定之后。
  await assertContextConfig(config, deps)
  // skillhub 配置校验(provider storage/s3;s3 连通探测)。
  await assertSkillhubConfig(config, deps)
  // kind:'tool' 挂载校验:provider 必须是已注册且启用的 tool-provider plugin;
  // export 声明了 credentialProbe 且配了 authRef 时,再用该凭证真实探一次(出站)。
  await assertToolConfig(config, deps, ctx, targetPath)
}

/** 注册变更后的派生状态失效:该节点的工具缓存 + mcp 会话 era + 两套 OAuth 记录一体作废。 */
export async function invalidateNodeDerivedState(
  store: StateStore,
  path: TreePath,
): Promise<void> {
  await invalidateToolCache(store, path)
  await invalidateMcpEra(store, path)
  await invalidateMcpOAuth(store, path)
  await invalidateProviderOAuth(store, path)
}
