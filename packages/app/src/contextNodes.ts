/**
 * context / skillhub 节点:对象存储装配、四动词(+ Search/Delete)派发、ttl 懒回收,
 * 以及注册面的配置校验(含 s3 连通探测)。
 *
 * 语义真源在 core 的 objectProvider / skillhub;这里只负责把宿主注入的 ObjectStore、
 * keyPrefix、$ref 阈值与中转 URL 工厂接上。命令校验与派发由 core 注册真源完成。
 */
import {
  type ContextProvider,
  type ContextUploadGrant,
  type ContextUploadInput,
  createObjectContextProvider,
  createObjectContextUploadGrant,
  createSkillhubProvider,
  isContextExpired,
  isTBError,
  type NodeConfig,
  NodeRegistryStore,
  type ObjectStore,
  PRESIGN_TTL_SEC_DEFAULT,
  type SecretStoreImpl,
  type SkillhubProvider,
  TBError,
  type TreeNode,
  type TreePath,
} from '@tool-bridge/core'
import type { S3StoreConfig, TbAppDeps } from './deps'
import { assertPluginMountContract, requirePluginExport } from './toolNodes'
import { assertNoDeviceMarker } from './deviceNodes'
import { signRefToken } from './refToken'

// ---------- SDK 进程内 Provider ----------

/** 按节点路径查 SDK 进程内 ContextProvider(未注入/未命中 → null)。 */
export function localContext(deps: TbAppDeps, node: TreeNode): ContextProvider | null {
  return deps.locals?.context?.(node.path) ?? null
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

/** Bind platform nodes once. Configuration updates preserve the original backend. */
export async function bindPlatformStorageConfig(config: unknown, previous: unknown, deps: TbAppDeps): Promise<void> {
  if (!config || typeof config !== 'object') return
  const cfg = config as ObjectNodeConfig
  if (!['context', 'skillhub'].includes(cfg.kind) || cfg.provider !== 'storage') return
  let backendId = cfg.providerConfig?.backendId
  if (backendId === undefined && previous && typeof previous === 'object') {
    const prior = previous as ObjectNodeConfig
    if (prior.kind === cfg.kind && prior.provider === 'storage') backendId = prior.providerConfig?.backendId
  }
  if (backendId === undefined) {
    if (!deps.defaultObjectBackend) throw new TBError('unavailable', 'Default storage backend is not configured')
    backendId = (await deps.defaultObjectBackend()).id
  }
  if (typeof backendId !== 'string' || !backendId.trim()) throw new TBError('invalid_argument', 'Storage backendId must be a non-empty string')
  if (!deps.objectStoreForBackend) throw new TBError('unavailable', 'Storage backend resolver is not configured')
  await deps.objectStoreForBackend(backendId)
  cfg.providerConfig = { ...cfg.providerConfig, backendId }
}

/** providerConfig.prefix(共桶隔离);缺省 storage 按节点路径隔离,s3 为空(整桶即 namespace)。 */
export function contextKeyPrefix(cfg: ContextConfig, nodePath: TreePath): string {
  const prefix = (cfg.providerConfig as { prefix?: unknown } | undefined)?.prefix
  if (typeof prefix === 'string') return prefix
  return cfg.provider === 'storage' ? `ctx/${nodePath}` : ''
}

async function createHostS3Store(cfg: ObjectNodeConfig, deps: TbAppDeps): Promise<ObjectStore> {
  if (!deps.s3Objects) throw new TBError('unavailable', 'S3 object adapter not configured')
  return await deps.s3Objects(await s3StoreConfig(cfg, deps.secrets))
}

/** 按 config.provider 构造底层 ObjectStore('storage' = 宿主注入的平台对象存储)。 */
export async function contextObjectStoreFor(cfg: ObjectNodeConfig, deps: TbAppDeps): Promise<ObjectStore> {
  if (cfg.provider === 'storage') {
    const backendId = cfg.providerConfig?.backendId
    if (typeof backendId !== 'string' || !backendId || !deps.objectStoreForBackend) {
      throw new TBError('unavailable', 'Context storage backend binding is missing')
    }
    return await deps.objectStoreForBackend(backendId)
  }
  if (cfg.provider === 's3') {
    return createHostS3Store(cfg, deps)
  }
  throw TBError.unimplemented(`context provider '${cfg.provider}' not implemented yet`)
}

/** 内置对象 context 是否具备限时直传签名能力。 */
export async function contextDirectUploadAvailable(
  cfg: ObjectNodeConfig,
  deps: TbAppDeps,
): Promise<boolean> {
  // Custom S3 endpoints use gateway relay until their complete browser wire
  // contract has been verified; discovery never resolves their credentials.
  if (cfg.provider === 's3') return false
  try {
    return (await contextObjectStoreFor(cfg, deps)).presignPut !== undefined
  } catch {
    // ~help/~describe/MCP tools/list 是控制面。对象存储或签名凭证异常只隐藏可选
    // direct-upload，不能让一个坏 context 拖垮整个发现面。
    return false
  }
}

/** 为内置 storage/s3 context 签发定路径 PUT；不经过 ContextProvider 的 JSON 内容接口。 */
export async function createContextUploadGrant(
  node: TreeNode,
  cfg: ContextConfig,
  deps: TbAppDeps,
  input: ContextUploadInput,
): Promise<ContextUploadGrant> {
  const objects = await contextObjectStoreFor(cfg, deps)
  const uploadGrantTtlSec = deps.uploadGrantTtlSec
    ?? Math.min(deps.refTtlSec ?? PRESIGN_TTL_SEC_DEFAULT, PRESIGN_TTL_SEC_DEFAULT)
  return createObjectContextUploadGrant(objects, {
    nsPath: node.path,
    keyPrefix: contextKeyPrefix(cfg, node.path),
    readOnly: cfg.readOnly ?? false,
    uploadGrantTtlSec,
  }, input)
}

/** context/skillhub provider 共用的对象存储 opts 形状(core 两个工厂的公共子集)。 */
interface ObjectProviderAssembly {
  keyPrefix: string
  nsPath: TreePath
  presignTtlSec?: number
  readOnly: boolean
  refThresholdBytes?: number
  relayRefUrl?: (key: string) => Promise<string>
}

/**
 * context 与 skillhub 装配共用的 opts 组装:$ref 阈值/有效期与 /~ref 中转 URL 工厂
 * (token 密钥派生自 TB_SECRET_ENCRYPTION_KEY;密钥缺省则不提供——presign 也缺时
 * core 对大对象 Get 报 unavailable)。keyPrefix 语义两侧不同,由调用方传入。
 */
function objectProviderOpts(
  node: TreeNode,
  keyPrefix: string,
  readOnly: boolean,
  deps: TbAppDeps,
  requestUrl: string,
): ObjectProviderAssembly {
  const opts: ObjectProviderAssembly = { nsPath: node.path, keyPrefix, readOnly }
  if (deps.refThresholdBytes !== undefined) opts.refThresholdBytes = deps.refThresholdBytes
  if (deps.refTtlSec !== undefined) opts.presignTtlSec = deps.refTtlSec
  const encKey = deps.encryptionKey
  if (encKey !== undefined) {
    const origin = new URL(requestUrl).origin
    const relayTtlSec = deps.refTtlSec ?? PRESIGN_TTL_SEC_DEFAULT
    opts.relayRefUrl = async (key) => {
      const exp = Math.floor(Date.now() / 1000) + relayTtlSec
      return `${origin}/~ref/${await signRefToken({ p: node.path, k: key, exp }, deps.storeTokenKeyring ?? encKey)}`
    }
  }
  return opts
}

/**
 * context 节点的 ContextProvider 装配:四动词语义在 core objectProvider,这里只注入
 * ObjectStore 与共用 opts(objectProviderOpts)。
 */
export async function contextProviderFor(
  node: TreeNode,
  cfg: ContextConfig,
  deps: TbAppDeps,
  requestUrl: string,
): Promise<ContextProvider> {
  const objects = await contextObjectStoreFor(cfg, deps)
  return createObjectContextProvider(objects, objectProviderOpts(
    node,
    contextKeyPrefix(cfg, node.path),
    cfg.readOnly ?? false,
    deps,
    requestUrl,
  ))
}

/** skillhub 的 keyPrefix:共桶隔离,storage 默认 `skills/<nodePath>`,s3 默认整桶。 */
export function skillhubKeyPrefix(cfg: SkillhubConfig, nodePath: TreePath): string {
  const prefix = (cfg.providerConfig as { prefix?: unknown } | undefined)?.prefix
  if (typeof prefix === 'string') return prefix
  return cfg.provider === 'storage' ? `skills/${nodePath}` : ''
}

/**
 * skillhub 节点的 SkillhubProvider 装配:底层对象存储与共用 opts 与 context 同源
 * (objectProviderOpts),只是 keyPrefix 落在 `skills/<path>` 且叠加 skill 单位语义
 * (core skillhub/provider)。
 */
export async function skillhubProviderFor(
  node: TreeNode,
  cfg: SkillhubConfig,
  deps: TbAppDeps,
  requestUrl: string,
): Promise<SkillhubProvider> {
  const objects = await contextObjectStoreFor(cfg, deps)
  return createSkillhubProvider(objects, objectProviderOpts(
    node,
    skillhubKeyPrefix(cfg, node.path),
    cfg.readOnly ?? false,
    deps,
    requestUrl,
  ))
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
 * provider = storage|s3 或已注册且启用的 context-provider plugin id;
 * s3 必填 endpoint/bucket/authRef,且做一次浅 list 连通探测(D8)——失败 →
 * unavailable(retryable);storage 与 plugin 不探测(plugin 在 PluginRegistry.Write 时已探活)。
 */
export async function assertContextConfig(config: unknown, deps: TbAppDeps): Promise<void> {
  if (config === null || typeof config !== 'object') return
  if ((config as { kind?: unknown }).kind !== 'context') return
  assertNoDeviceMarker(config)
  const cfg = config as ContextConfig
  if (cfg.provider !== 'storage' && cfg.provider !== 's3') {
    // plugin 挂载:不存在/kind 不符/禁用 → invalid_argument(device-fs 由网关代写、
    // SDK '@local' 由 registerContext 内部通道落库,均不经注册面)。
    // 传 deps 而不是 deps.state:内置 binding 插件未注册时在这里自动补齐(免手工注册)。
    const { export: exported } = await requirePluginExport(
      deps,
      cfg.provider,
      'context',
      'context',
      cfg.export,
    )
    await assertPluginMountContract(exported, cfg, deps)
    return
  }
  if (cfg.provider === 's3') {
    // 结构/凭证/https 校验失败 → invalid_argument(store 构造抛出)。
    const store = await createHostS3Store(cfg, deps)
    try {
      await store.list(contextKeyPrefix(cfg, ''), { limit: 1 })
    } catch (err) {
      const detail = isTBError(err) ? err.message : String(err)
      throw new TBError('unavailable', `s3 连通探测失败:${detail}`, { retryable: true })
    }
  }
}

/**
 * 注册/更新 skillhub 节点时的配置校验:provider 仅 storage|s3(本期不支持 plugin/device);
 * s3 做一次浅 list 连通探测(与 context 同则),storage 用平台桶不探测。
 */
export async function assertSkillhubConfig(config: unknown, deps: TbAppDeps): Promise<void> {
  if (config === null || typeof config !== 'object') return
  if ((config as { kind?: unknown }).kind !== 'skillhub') return
  const cfg = config as SkillhubConfig
  if (cfg.provider !== 'storage' && cfg.provider !== 's3') {
    throw new TBError(
      'invalid_argument',
      `skillhub provider 仅支持 'storage' 或 's3',收到 '${cfg.provider}'`,
    )
  }
  if (cfg.provider === 's3') {
    const store = await createHostS3Store(cfg, deps)
    try {
      await store.list(skillhubKeyPrefix(cfg, ''), { limit: 1 })
    } catch (err) {
      const detail = isTBError(err) ? err.message : String(err)
      throw new TBError('unavailable', `s3 连通探测失败:${detail}`, { retryable: true })
    }
  }
}
