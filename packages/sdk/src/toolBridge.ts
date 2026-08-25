import {
  type ContextProvider,
  type DeviceExpose,
  type DeviceNodeCmd,
  type DeviceNodeInput,
  isReadOnlyProvider,
  type NodeInput,
  NodeRegistryStore,
  normalizePath,
  OperationRegistry,
  SecretStoreImpl,
  TBError,
  type ToolResult,
  type TreePath,
  validatePath,
} from '@tool-bridge/core'
import {
  createTbApp,
  dispatchContextCmd,
  runBootstrap,
  type TbAppDeps,
  type UpstreamProvider,
} from '@tool-bridge/app'
import { hostname } from 'node:os'
import type {
  ConnectOptions,
  SdkConnection,
  ToolBridge,
  ToolBridgeConfig,
  ToolProviderLike,
  ToolSource,
} from './types'
import pkg from '../package.json' with { type: 'json' }
import { openConnection } from './connect'

/** SDK 进程内 Provider 的保留 provider id(不经注册面,只由 SDK 落库)。 */
const LOCAL_PROVIDER_ID = '@local'

/** SDK 代写节点的 registeredBy 标记(与 'system:boot'/'system:auto' 同一命名空间)。 */
const REGISTERED_BY_SDK = 'system:sdk'

const DEFAULT_MAX_HOPS = 4

type Registration
  = | { kind: 'tool', meta?: Partial<NodeInput>, path: TreePath, provider: ToolProviderLike }
    | { kind: 'context', meta?: Partial<NodeInput>, path: TreePath, provider: ContextProvider }

/**
 * 注册项 → NodeInput。**本地落库与 connect 上报共用同一构造** —— 此前两条路径各写一份,
 * 上报侧硬编码 config 且丢掉 virtualize / readOnly,导致"本地跑正常、连上远程后 ~help
 * 与权限变了"。context 的只读性按 handler 存在性推导(无写动词即 readOnly:true),
 * 让远端看到的能力与本地实现一致。
 */
function nodeInputOf(reg: Registration): NodeInput {
  const meta = reg.meta ?? {}
  const fallback: NodeInput['config']
    = reg.kind === 'tool'
      ? { kind: 'tool', provider: LOCAL_PROVIDER_ID }
      : {
          kind: 'context',
          provider: LOCAL_PROVIDER_ID,
          ...(isReadOnlyProvider(reg.provider) ? { readOnly: true } : {}),
        }
  return {
    path: reg.path,
    kind: reg.kind,
    description: meta.description ?? '',
    ...(meta.virtualize !== undefined ? { virtualize: meta.virtualize } : {}),
    config: meta.config ?? fallback,
  }
}

/** hostname 小写,非法路径段字符替换为 '-'(与 CLI 同规则,不持久化)。 */
function normalizeDeviceId(input: string): string {
  const id = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!id) throw new TBError('invalid_argument', 'device id is empty after normalization')
  return id
}

/**
 * 工具源归一:`OperationRegistry` → `ToolProviderLike`(registry 的 ctx 对嵌入式宿主无意义,
 * 传 undefined)。手写 Provider 原样返回。注册期归一,下游只认一种形状。
 */
function providerOf(source: ToolSource): ToolProviderLike {
  if (source instanceof OperationRegistry) {
    return {
      list: () => source.list(),
      call: async (name, args) => await source.call(name, args, undefined),
    }
  }
  return source
}

/** ToolProviderLike → gateway UpstreamProvider(list 产出的即对外名;'@local' 不虚拟化)。 */
function upstreamOf(provider: ToolProviderLike): UpstreamProvider {
  return {
    list: async () => await provider.list(),
    call: async (name, args) => await provider.call(name, args),
  }
}

/** ToolSpec → hello 帧 nodes[].cmds 元素(同形收窄;inputSchema 原样上送作 ~help 数据源)。 */
function cmdsOf(specs: Awaited<ReturnType<ToolProviderLike['list']>>): DeviceNodeCmd[] {
  return specs.map(t => ({
    name: t.name,
    ...(t.description !== undefined ? { description: t.description } : {}),
    ...(t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {}),
    ...(t.outputSchema !== undefined ? { outputSchema: t.outputSchema } : {}),
    ...(t.effect !== undefined ? { effect: t.effect } : {}),
    ...(t.confirm !== undefined ? { confirm: t.confirm } : {}),
  }))
}

/** 嵌入式运行一个 TB 实例。 */
export function createToolBridge(config: ToolBridgeConfig): ToolBridge {
  const state = config.state
  const secrets
    = config.secrets
      ?? new SecretStoreImpl(state, config.encryptionKey ?? process.env.TB_SECRET_ENCRYPTION_KEY)

  // 进程内 provider 表(Q14:register* 同步登记;NodeRegistry 写延迟到首次 fetch/connect 前)。
  const registrations = new Map<TreePath, Registration>()
  let unflushed: Registration[] = []

  const register = (reg: Registration): void => {
    const path = normalizePath(reg.path)
    const invalid = validatePath(path)
    if (invalid) throw invalid
    const normalized = { ...reg, path }
    registrations.set(path, normalized)
    unflushed.push(normalized)
  }

  // 引导(Admin SK + 内置节点)只跑一次;register* 的延迟写在每次就绪检查时增量 flush。
  let bootstrapped: Promise<void> | undefined
  const ensureReady = async (): Promise<void> => {
    if (bootstrapped === undefined) {
      const adminSk = config.adminSk ?? process.env.TB_BOOTSTRAP_ADMIN_SK
      bootstrapped = runBootstrap(state, adminSk !== undefined ? { adminSk } : {}).catch((err) => {
        bootstrapped = undefined
        throw err
      })
    }
    await bootstrapped
    if (unflushed.length === 0) return
    const batch = unflushed
    unflushed = []
    const registry = new NodeRegistryStore(state)
    const now = new Date().toISOString()
    for (const reg of batch) {
      await registry.write(nodeInputOf(reg), REGISTERED_BY_SDK, now)
    }
  }

  const deps: TbAppDeps = {
    state,
    secrets,
    version: pkg.version,
    ensureReady,
    remote: {
      allowlist: config.remoteAllowlist ?? [],
      maxHops: config.maxHops ?? DEFAULT_MAX_HOPS,
      ...(config.instanceId !== undefined ? { instanceId: config.instanceId } : {}),
      allowInsecure: config.allowInsecureHttp ?? false,
    },
    allowInsecureHttp: config.allowInsecureHttp ?? false,
    locals: {
      tool: (nodePath) => {
        const reg = registrations.get(nodePath)
        return reg?.kind === 'tool' ? upstreamOf(reg.provider) : undefined
      },
      context: (nodePath) => {
        const reg = registrations.get(nodePath)
        return reg?.kind === 'context' ? reg.provider : undefined
      },
    },
  }
  if (config.reservedRoots !== undefined) deps.reservedRoots = config.reservedRoots
  if (config.pluginBindings !== undefined) deps.pluginBindings = config.pluginBindings
  if (config.pluginCatalog !== undefined) deps.pluginCatalog = config.pluginCatalog
  if (config.providerOAuthFetch !== undefined) deps.providerOAuthFetch = config.providerOAuthFetch
  const objects = config.objects
  deps.objects = () => objects
  const encryptionKey = config.encryptionKey ?? process.env.TB_SECRET_ENCRYPTION_KEY
  if (encryptionKey !== undefined) deps.encryptionKey = encryptionKey
  if (config.uploadGrantTtlSec !== undefined) {
    deps.uploadGrantTtlSec = config.uploadGrantTtlSec
  }
  const app = createTbApp(deps)

  /** 缺省 expose:本实例注册的节点经 hello 帧 nodes+cmds 上报。 */
  const defaultExpose = async (): Promise<DeviceExpose> => {
    const nodes: DeviceNodeInput[] = []
    for (const reg of registrations.values()) {
      // 与本地落库同一构造:virtualize / readOnly / 自定义 config 一并上报,不再丢失。
      const node = nodeInputOf(reg)
      nodes.push(reg.kind === 'tool' ? { ...node, cmds: cmdsOf(await reg.provider.list()) } : node)
    }
    if (nodes.length === 0) {
      throw new TBError(
        'invalid_argument',
        'connect 前无可上报节点:先 registerTool/registerContext,或显式传 opts.expose',
      )
    }
    return { nodes }
  }

  /**
   * 设备侧 call 帧派发:call.path 相对 mountPath 且**含命令叶子段**(如 "<注册路径>/<命令>")。
   * 拆出注册路径(mount)与命令名(最后一段)。
   */
  const handler = async (call: {
    arguments: Record<string, unknown>
    path: string
  }): Promise<unknown> => {
    const slash = call.path.lastIndexOf('/')
    const mount = slash < 0 ? call.path : call.path.slice(0, slash)
    const cmd = slash < 0 ? '' : call.path.slice(slash + 1)
    const reg = registrations.get(normalizePath(mount))
    if (reg === undefined) throw TBError.notFound(`device path not exposed:'${call.path}'`)
    if (reg.kind === 'tool') {
      const result: ToolResult = await reg.provider.call(cmd, call.arguments)
      // 与本地 HTTP 调用同形:网关渲染的是 ToolResult.content(tbApp handleInvoke)。
      return result.content
    }
    return await dispatchContextCmd(reg.provider, cmd, call.arguments)
  }

  return {
    fetch: async (req: Request): Promise<Response> => await app.fetch(req),

    registerTool(path, source, meta) {
      const provider = providerOf(source)
      register({ kind: 'tool', path, provider, ...(meta !== undefined ? { meta } : {}) })
    },

    registerContext(path, provider, meta) {
      register({ kind: 'context', path, provider, ...(meta !== undefined ? { meta } : {}) })
    },

    connect(remoteBaseUrl: string, sk: string, opts?: ConnectOptions): SdkConnection {
      const deviceId
        = opts?.deviceId !== undefined && opts.deviceId.trim() !== ''
          ? normalizeDeviceId(opts.deviceId)
          : normalizeDeviceId(hostname())
      return openConnection({
        baseUrl: remoteBaseUrl,
        sk,
        deviceId,
        ...(opts?.mountPath !== undefined ? { mountPath: opts.mountPath } : {}),
        // 显式 expose 原样上送;缺省 = 注册节点表(建连前收集 cmds)。
        expose:
          opts?.expose !== undefined ? async () => opts.expose as DeviceExpose : defaultExpose,
        handler,
      })
    },
  }
}
