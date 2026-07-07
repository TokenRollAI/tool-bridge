import { hostname } from 'node:os'
import {
  type ContextProvider,
  type DeviceExpose,
  type DeviceNodeCmd,
  type DeviceNodeInput,
  type NodeInput,
  NodeRegistryStore,
  normalizePath,
  SecretStoreImpl,
  TBError,
  type ToolResult,
  type TreePath,
  validatePath,
} from '@tool-bridge/core'
import { runBootstrap } from '@tool-bridge/gateway/bootstrap'
import {
  createTbApp,
  dispatchContextCmd,
  type TbAppDeps,
  type UpstreamProvider,
} from '@tool-bridge/gateway/tbApp'
import pkg from '../package.json' with { type: 'json' }
import { openConnection } from './connect'
import type {
  ConnectOptions,
  SdkConnection,
  ToolBridge,
  ToolBridgeConfig,
  ToolProviderLike,
} from './types'

/** SDK 进程内 Provider 的保留 provider id(Proto §3.2 注记;不经注册面,只由 SDK 落库)。 */
const LOCAL_PROVIDER_ID = '@local'

/** SDK 代写节点的 registeredBy 标记(与 'system:boot'/'system:auto' 同一命名空间)。 */
const REGISTERED_BY_SDK = 'system:sdk'

const DEFAULT_MAX_HOPS = 4

type Registration =
  | { kind: 'tool'; path: TreePath; provider: ToolProviderLike; meta?: Partial<NodeInput> }
  | { kind: 'context'; path: TreePath; provider: ContextProvider; meta?: Partial<NodeInput> }

/** Proto §6.1 实现注记:hostname 小写,非法路径段字符替换为 '-'(与 CLI 同规则,不持久化)。 */
function normalizeDeviceId(input: string): string {
  const id = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!id) throw new TBError('invalid_argument', 'device id is empty after normalization')
  return id
}

/** ToolProviderLike → gateway UpstreamProvider(list 产出的即对外名;'@local' 不虚拟化)。 */
function upstreamOf(provider: ToolProviderLike): UpstreamProvider {
  return {
    list: async () => await provider.List(),
    call: async (name, args) => await provider.Call(name, args),
  }
}

/** ToolSpec → hello 帧 nodes[].cmds 元素(同形收窄;inputSchema 原样上送作 ~help 数据源)。 */
function cmdsOf(specs: Awaited<ReturnType<ToolProviderLike['List']>>): DeviceNodeCmd[] {
  return specs.map((t) => ({
    name: t.name,
    ...(t.description !== undefined ? { description: t.description } : {}),
    ...(t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {}),
    ...(t.effect !== undefined ? { effect: t.effect } : {}),
    ...(t.confirm !== undefined ? { confirm: t.confirm } : {}),
  }))
}

/** 嵌入式运行一个 TB 实例(Proto §7)。 */
export function createToolBridge(config: ToolBridgeConfig): ToolBridge {
  const state = config.state
  const secrets =
    config.secrets ??
    new SecretStoreImpl(state, config.encryptionKey ?? process.env.TB_SECRET_ENCRYPTION_KEY)

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
      const meta = reg.meta ?? {}
      const node: NodeInput = {
        path: reg.path,
        kind: reg.kind,
        description: meta.description ?? '',
        ...(meta.virtualize !== undefined ? { virtualize: meta.virtualize } : {}),
        config:
          meta.config ??
          (reg.kind === 'tool'
            ? { kind: 'tool', provider: LOCAL_PROVIDER_ID }
            : { kind: 'context', provider: LOCAL_PROVIDER_ID }),
      }
      await registry.write(node, REGISTERED_BY_SDK, now)
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
  if (config.objects !== undefined) {
    const objects = config.objects
    deps.objects = () => objects
  }
  const encryptionKey = config.encryptionKey ?? process.env.TB_SECRET_ENCRYPTION_KEY
  if (encryptionKey !== undefined) deps.encryptionKey = encryptionKey
  if (config.deviceTransport !== undefined) {
    throw TBError.unimplemented(
      'deviceTransport 宿主注入(网关侧设备通道)属 Docker 宿主(Phase 6);本轮 SDK 未实现',
    )
  }

  const app = createTbApp(deps)

  /** 缺省 expose:本实例注册的节点经 hello 帧 nodes+cmds 上报(Proto §6.3/§7)。 */
  const defaultExpose = async (): Promise<DeviceExpose> => {
    const nodes: DeviceNodeInput[] = []
    for (const reg of registrations.values()) {
      const meta = reg.meta ?? {}
      if (reg.kind === 'tool') {
        nodes.push({
          path: reg.path,
          kind: 'tool',
          description: meta.description ?? '',
          config: { kind: 'tool', provider: LOCAL_PROVIDER_ID },
          cmds: cmdsOf(await reg.provider.List()),
        })
      } else {
        nodes.push({
          path: reg.path,
          kind: 'context',
          description: meta.description ?? '',
          config: { kind: 'context', provider: LOCAL_PROVIDER_ID },
        })
      }
    }
    if (nodes.length === 0) {
      throw new TBError(
        'invalid_argument',
        'connect 前无可上报节点:先 registerTool/registerContext,或显式传 opts.expose',
      )
    }
    return { nodes }
  }

  /** 设备侧 call 帧派发:path 相对 mountPath = 本实例注册路径(Proto §6.3)。 */
  const handler = async (call: {
    path: string
    tool: string
    arguments: Record<string, unknown>
  }): Promise<unknown> => {
    const reg = registrations.get(normalizePath(call.path))
    if (reg === undefined) throw TBError.notFound(`device path not exposed:'${call.path}'`)
    if (reg.kind === 'tool') {
      const result: ToolResult = await reg.provider.Call(call.tool, call.arguments)
      // 与本地 HTTP 调用同形:网关渲染的是 ToolResult.content(tbApp handleInvoke)。
      return result.content
    }
    return await dispatchContextCmd(reg.provider, call.tool, call.arguments)
  }

  return {
    fetch: async (req: Request): Promise<Response> => await app.fetch(req),

    registerTool(path, provider, meta) {
      register({ kind: 'tool', path, provider, ...(meta !== undefined ? { meta } : {}) })
    },

    registerContext(path, provider, meta) {
      register({ kind: 'context', path, provider, ...(meta !== undefined ? { meta } : {}) })
    },

    connect(remoteBaseUrl: string, sk: string, opts?: ConnectOptions): SdkConnection {
      const deviceId =
        opts?.deviceId !== undefined && opts.deviceId.trim() !== ''
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
