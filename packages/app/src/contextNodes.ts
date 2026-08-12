/**
 * context / skillhub 节点:对象存储装配、四动词(+ Search/Delete)派发、ttl 懒回收,
 * 以及注册面的配置校验(含 s3 连通探测)。
 *
 * 语义真源在 core 的 objectProvider / skillhub;这里只负责把宿主注入的 ObjectStore、
 * keyPrefix、$ref 阈值与中转 URL 工厂接上,并把数据面 {tool} 映射到 provider 方法。
 */
import {
  contextCapabilitiesOf,
  type ContextEntryInput,
  type ContextPatch,
  type ContextProvider,
  createObjectContextProvider,
  createSkillhubProvider,
  isContextExpired,
  isTBError,
  type ListOptions,
  type NodeConfig,
  NodeRegistryStore,
  type ObjectStore,
  PRESIGN_TTL_SEC_DEFAULT,
  type SearchOptions,
  type SecretStoreImpl,
  type SkillhubProvider,
  type SkillPublishFile,
  TBError,
  type TreeNode,
  type TreePath,
} from '@tool-bridge/core'
import type { TbAppDeps } from './deps'
import { createS3ObjectStore, type S3StoreConfig } from './providers/s3Object'
import { assertNoDeviceMarker } from './deviceNodes'
import { requirePluginExport } from './toolNodes'
import { signRefToken } from './refToken'

// ---------- SDK 进程内 Provider ----------

/** 按节点路径查 SDK 进程内 ContextProvider(未注入/未命中 → null)。 */
export function localContext(deps: TbAppDeps, node: TreeNode): ContextProvider | null {
  return deps.locals?.context?.(node.path) ?? null
}

/**
 * 进程内 Provider 的 capabilities:按 handler 存在性推导(~describe/~help 共用)。
 * 推导真源在 core `context/capabilities.ts`,与 `~help` 的动词过滤同源,避免两处漂移。
 */
export function localCapabilities(provider: ContextProvider): string[] {
  return contextCapabilitiesOf(provider)
}
// ---------- context 节点 ----------

export type ContextConfig = Extract<NodeConfig, { kind: 'context' }>
export type SkillhubConfig = Extract<NodeConfig, { kind: 'skillhub' }>
/** context 与 skillhub 共用对象存储装配(provider/providerConfig/authRef 同形)。 */
export type ObjectNodeConfig = ContextConfig | SkillhubConfig

/** S3 类凭证值形状:JSON {"accessKeyId","secretAccessKey"};解析失败不回显值。 */
export function parseS3Credentials(
  raw: string,
  refName: string,
): { accessKeyId: string, secretAccessKey: string } {
  try {
    const v = JSON.parse(raw) as { accessKeyId?: unknown, secretAccessKey?: unknown }
    if (typeof v.accessKeyId === 'string' && typeof v.secretAccessKey === 'string') {
      return { accessKeyId: v.accessKeyId, secretAccessKey: v.secretAccessKey }
    }
  } catch {
    // fallthrough:统一 invalid_argument
  }
  throw new TBError(
    'invalid_argument',
    `凭证 '${refName}' 不是 {"accessKeyId","secretAccessKey"} 形状的 JSON`,
  )
}

export function deviceIdForDeviceFs(cfg: ContextConfig): string {
  const pc = cfg.providerConfig
  if (pc && typeof pc === 'object' && typeof pc.deviceId === 'string') return pc.deviceId
  throw new TBError('invalid_argument', 'device-fs context 缺少 providerConfig.deviceId')
}

/** s3 provider 的 store 构造参数:providerConfig.endpoint/bucket + authRef 解析(均必填)。 */
export async function s3StoreConfig(
  cfg: ObjectNodeConfig,
  secrets: SecretStoreImpl,
): Promise<S3StoreConfig> {
  const pc = (cfg.providerConfig ?? {}) as {
    bucket?: unknown
    endpoint?: unknown
    region?: unknown
  }
  if (typeof pc.endpoint !== 'string' || typeof pc.bucket !== 'string') {
    throw new TBError('invalid_argument', 's3 provider 需要 providerConfig.endpoint 与 bucket')
  }
  if (typeof cfg.authRef !== 'string') {
    throw new TBError('invalid_argument', 's3 provider 需要 authRef(SecretStore 引用名)')
  }
  const raw = await secrets.resolve(cfg.authRef)
  if (raw === undefined) {
    throw new TBError('invalid_argument', `authRef '${cfg.authRef}' 无法解析`)
  }
  return {
    endpoint: pc.endpoint,
    bucket: pc.bucket,
    ...(typeof pc.region === 'string' ? { region: pc.region } : {}),
    ...parseS3Credentials(raw, cfg.authRef),
  }
}

/** providerConfig.prefix(共桶隔离);缺省 r2 按节点路径隔离,s3 为空(整桶即 namespace)。 */
export function contextKeyPrefix(cfg: ContextConfig, nodePath: TreePath): string {
  const prefix = (cfg.providerConfig as { prefix?: unknown } | undefined)?.prefix
  if (typeof prefix === 'string') return prefix
  return cfg.provider === 'r2' ? `ctx/${nodePath}` : ''
}

/** 按 config.provider 构造底层 ObjectStore('r2' = 宿主注入的平台对象存储)。 */
export async function contextObjectStoreFor(cfg: ObjectNodeConfig, deps: TbAppDeps): Promise<ObjectStore> {
  if (cfg.provider === 'r2') {
    if (deps.objects === undefined) {
      throw new TBError('unavailable', 'object store not configured(objects 未注入)', {
        retryable: false,
      })
    }
    return await deps.objects()
  }
  if (cfg.provider === 's3') {
    return createS3ObjectStore(await s3StoreConfig(cfg, deps.secrets), {
      allowInsecure: deps.allowInsecureHttp,
    })
  }
  throw TBError.unimplemented(`context provider '${cfg.provider}' not implemented yet`)
}

/**
 * context 节点的 ContextProvider 装配:四动词语义在 core objectProvider,这里只注入
 * ObjectStore、keyPrefix、$ref 阈值/有效期与 /~ref 中转 URL 工厂(presign 凭证缺省时生效)。
 */
export async function contextProviderFor(
  node: TreeNode,
  cfg: ContextConfig,
  deps: TbAppDeps,
  requestUrl: string,
): Promise<ContextProvider> {
  const objects = await contextObjectStoreFor(cfg, deps)
  const opts: Parameters<typeof createObjectContextProvider>[1] = {
    nsPath: node.path,
    keyPrefix: contextKeyPrefix(cfg, node.path),
    readOnly: cfg.readOnly ?? false,
  }
  if (deps.refThresholdBytes !== undefined) opts.refThresholdBytes = deps.refThresholdBytes
  if (deps.refTtlSec !== undefined) opts.presignTtlSec = deps.refTtlSec
  // /~ref 中转 URL 工厂:token 密钥派生自 TB_SECRET_ENCRYPTION_KEY;密钥缺省则不提供
  // (presign 也缺时 core 对大对象 Get 报 unavailable)。
  const encKey = deps.encryptionKey
  if (encKey !== undefined) {
    const origin = new URL(requestUrl).origin
    const relayTtlSec = deps.refTtlSec ?? PRESIGN_TTL_SEC_DEFAULT
    opts.relayRefUrl = async (key) => {
      const exp = Math.floor(Date.now() / 1000) + relayTtlSec
      return `${origin}/~ref/${await signRefToken({ p: node.path, k: key, exp }, encKey)}`
    }
  }
  return createObjectContextProvider(objects, opts)
}

/** skillhub 的 keyPrefix:共桶隔离,r2 默认 `skills/<nodePath>`,s3 默认整桶。 */
export function skillhubKeyPrefix(cfg: SkillhubConfig, nodePath: TreePath): string {
  const prefix = (cfg.providerConfig as { prefix?: unknown } | undefined)?.prefix
  if (typeof prefix === 'string') return prefix
  return cfg.provider === 'r2' ? `skills/${nodePath}` : ''
}

/**
 * skillhub 节点的 SkillhubProvider 装配:底层对象存储与 $ref 中转 URL 工厂与 context 同源,
 * 只是 keyPrefix 落在 `skills/<path>` 且叠加 skill 单位语义(core skillhub/provider)。
 */
export async function skillhubProviderFor(
  node: TreeNode,
  cfg: SkillhubConfig,
  deps: TbAppDeps,
  requestUrl: string,
): Promise<SkillhubProvider> {
  const objects = await contextObjectStoreFor(cfg, deps)
  const opts: Parameters<typeof createSkillhubProvider>[1] = {
    nsPath: node.path,
    keyPrefix: skillhubKeyPrefix(cfg, node.path),
    readOnly: cfg.readOnly ?? false,
  }
  if (deps.refThresholdBytes !== undefined) opts.refThresholdBytes = deps.refThresholdBytes
  if (deps.refTtlSec !== undefined) opts.presignTtlSec = deps.refTtlSec
  const encKey = deps.encryptionKey
  if (encKey !== undefined) {
    const origin = new URL(requestUrl).origin
    const relayTtlSec = deps.refTtlSec ?? PRESIGN_TTL_SEC_DEFAULT
    opts.relayRefUrl = async (key) => {
      const exp = Math.floor(Date.now() / 1000) + relayTtlSec
      return `${origin}/~ref/${await signRefToken({ p: node.path, k: key, exp }, encKey)}`
    }
  }
  return createSkillhubProvider(objects, opts)
}

/** 数据面 {tool} → SkillhubProvider 方法派发;入参精细校验由 provider 承担。 */
export async function dispatchSkillhubCmd(
  provider: SkillhubProvider,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (tool) {
    case 'List':
      return await provider.List(args.opts as ListOptions | undefined)
    case 'Get':
      return typeof args.file === 'string'
        ? await provider.GetFile(args.id as string, args.file)
        : await provider.Get(args.id as string)
    case 'Search':
      return await provider.Search(args.query as string, args.opts as ListOptions | undefined)
    case 'Publish':
      if (!Array.isArray(args.files)) {
        throw new TBError('invalid_argument', 'Publish 需要数组 \'files\'')
      }
      return await provider.Publish({
        ...(typeof args.id === 'string' ? { id: args.id } : {}),
        files: args.files as SkillPublishFile[],
      })
    case 'Remove':
      return await provider.Remove(args.id as string)
    default:
      // skillhubScopeForCmd 已挡未知 cmd;此处为类型完备性兜底。
      throw new TBError('invalid_argument', `unknown cmd '${tool}'`)
  }
}

/**
 * 数据面 {tool} → ContextProvider 方法派发;入参精细校验由 provider 承担。
 * 可选方法(Search/Delete)未实现(plugin 未在 capabilities 声明)→ 按 unknown cmd 拒
 * (未声明的可选方法平台永不调用)。SDK 设备侧 handler 派发同形复用(导出)。
 */
export async function dispatchContextCmd(
  provider: ContextProvider,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  // 全动词可选:未实现的动词一律按 unknown cmd 拒绝(与"~help 只列真实存在的操作"一致,
  // 调用方看到的动词表与可调用集合始终吻合)。
  const unimplemented = (): never => {
    throw new TBError('invalid_argument', `unknown cmd '${tool}'(provider 未实现)`)
  }
  switch (tool) {
    case 'List':
      if (provider.List === undefined) return unimplemented()
      return await provider.List((args.path as string) ?? '', args.opts as ListOptions | undefined)
    case 'Get':
      if (provider.Get === undefined) return unimplemented()
      return await provider.Get(args.path as string)
    case 'Write':
      if (provider.Write === undefined) return unimplemented()
      if (typeof args.entry !== 'object' || args.entry === null) {
        throw new TBError('invalid_argument', 'Write 需要对象 \'entry\'')
      }
      return await provider.Write(args.path as string, args.entry as ContextEntryInput)
    case 'Update':
      if (provider.Update === undefined) return unimplemented()
      if (typeof args.patch !== 'object' || args.patch === null) {
        throw new TBError('invalid_argument', 'Update 需要对象 \'patch\'')
      }
      return await provider.Update(args.path as string, args.patch as ContextPatch)
    case 'Delete':
      if (provider.Delete === undefined) return unimplemented()
      return await provider.Delete(args.path as string)
    case 'Search':
      if (provider.Search === undefined) return unimplemented()
      return await provider.Search(args.query as string, args.opts as SearchOptions | undefined)
    default:
      // contextScopeForCmd 已挡未知 cmd;此处为类型完备性兜底。
      throw new TBError('invalid_argument', `unknown cmd '${tool}'`)
  }
}

/** ttl 懒回收单点判定:过期 → 删节点 + not_found;未过期 → 通过。context/skillhub 共用。 */
export async function assertContextAlive(
  node: TreeNode,
  cfg: { ttl?: number },
  registry: NodeRegistryStore,
): Promise<void> {
  if (!isContextExpired(node.createdAt, cfg.ttl, Date.now())) return
  await registry.delete(node.path)
  throw TBError.notFound('not found')
}

/** 列表面(~tree/目录 ~help)的 ttl 懒回收:过期 context/skillhub 节点剔除并删除。 */
export async function pruneExpiredContext(
  nodes: TreeNode[],
  registry: NodeRegistryStore,
): Promise<TreeNode[]> {
  const now = Date.now()
  const alive: TreeNode[] = []
  for (const n of nodes) {
    const cfg = n.config
    if (
      (n.kind === 'context' || n.kind === 'skillhub')
      && cfg?.kind === n.kind
      && isContextExpired(n.createdAt, (cfg as { ttl?: number }).ttl, now)
    ) {
      await registry.delete(n.path)
      continue
    }
    alive.push(n)
  }
  return alive
}
/**
 * 注册/更新 context 节点时的配置校验(注册时即拒):
 * provider = r2|s3 或已注册且启用的 context-provider plugin id;
 * s3 必填 endpoint/bucket/authRef,且做一次浅 list 连通探测(D8)——失败 →
 * unavailable(retryable);r2 与 plugin 不探测(plugin 在 PluginRegistry.Write 时已探活)。
 */
export async function assertContextConfig(config: unknown, deps: TbAppDeps): Promise<void> {
  if (config === null || typeof config !== 'object') return
  if ((config as { kind?: unknown }).kind !== 'context') return
  assertNoDeviceMarker(config)
  const cfg = config as ContextConfig
  if (cfg.provider !== 'r2' && cfg.provider !== 's3') {
    // plugin 挂载:不存在/kind 不符/禁用 → invalid_argument(device-fs 由网关代写、
    // SDK '@local' 由 registerContext 内部通道落库,均不经注册面)。
    await requirePluginExport(deps.state, cfg.provider, 'context', 'context', cfg.export)
    return
  }
  if (cfg.provider === 's3') {
    // 结构/凭证/https 校验失败 → invalid_argument(store 构造抛出)。
    const store = createS3ObjectStore(await s3StoreConfig(cfg, deps.secrets), {
      allowInsecure: deps.allowInsecureHttp,
    })
    try {
      await store.list(contextKeyPrefix(cfg, ''), { limit: 1 })
    } catch (err) {
      const detail = isTBError(err) ? err.message : String(err)
      throw new TBError('unavailable', `s3 连通探测失败:${detail}`, { retryable: true })
    }
  }
}

/**
 * 注册/更新 skillhub 节点时的配置校验:provider 仅 r2|s3(本期不支持 plugin/device);
 * s3 做一次浅 list 连通探测(与 context 同则),r2 用平台桶不探测。
 */
export async function assertSkillhubConfig(config: unknown, deps: TbAppDeps): Promise<void> {
  if (config === null || typeof config !== 'object') return
  if ((config as { kind?: unknown }).kind !== 'skillhub') return
  const cfg = config as SkillhubConfig
  if (cfg.provider !== 'r2' && cfg.provider !== 's3') {
    throw new TBError(
      'invalid_argument',
      `skillhub provider 仅支持 'r2' 或 's3',收到 '${cfg.provider}'`,
    )
  }
  if (cfg.provider === 's3') {
    const store = createS3ObjectStore(await s3StoreConfig(cfg, deps.secrets), {
      allowInsecure: deps.allowInsecureHttp,
    })
    try {
      await store.list(skillhubKeyPrefix(cfg, ''), { limit: 1 })
    } catch (err) {
      const detail = isTBError(err) ? err.message : String(err)
      throw new TBError('unavailable', `s3 连通探测失败:${detail}`, { retryable: true })
    }
  }
}
