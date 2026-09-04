import {
  adminBootstrapInput,
  AnnotationStore,
  type BuiltinCatalog,
  type BuiltinDeps,
  checkScopes,
  KEY_BOOTSTRAPPED,
  KEY_SK_HASH,
  KEY_SK_ID,
  mintKey,
  type NodeInput,
  NodeRegistryStore,
  RemoteAllowlistStore,
  type SecretKey,
  type SecretStoreImpl,
  sha256Hex,
  SKRegistryStore,
  type StateStore,
  TBError,
} from '@tool-bridge/core'
import { fetchPluginContract, type PluginBindings, probePlugin } from './providers/pluginClient'

/** 引导时注册的内置节点(system directory + builtin;feedback 走 ~feedback 保留段,非 builtin)。 */
const BUILTIN_MODULES = [
  'sk',
  'secret',
  'registry',
  'status',
  'plugin',
  'catalog',
  'federation',
  'annotation',
  'store',
] as const

const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  sk: 'SecretKey registry',
  secret: 'Upstream credential store',
  registry: 'Node registry',
  status: 'Gateway health and summary',
  plugin: 'Plugin registry (external plugins)',
  catalog: 'Built-in integration catalog (read-only)',
  federation: 'Remote federation host allowlist',
  annotation: 'Admin notes shown in ~help of any path',
  store: 'Deployment-level private object Store',
  config: 'Instance settings and apply status',
  deployment: 'Local deployment executor and apply status',
  maintenance: 'Database and service maintenance',
  keys: 'Encryption and signing key lifecycle',
  storage: 'Storage backend configuration and validation',
}

/**
 * 用固定明文签发 Admin SK(便于部署自动化);hash 入库,不生成随机明文。
 *
 * 并发引导去重(多 Pod / 多 isolate 同时冷启动):hash key 是天然的去重键——同一
 * TB_BOOTSTRAP_ADMIN_SK 得到同一 sha256。经 putIfAbsent 抢写,输者直接收手,
 * 不再写自己的 sk:i:<id> 索引(id 每次随机,重复铸造会给同一 Admin SK 留下多条
 * 管理面索引)。后端无 putIfAbsent(无 CAS 的自定义 store)时回退 get-miss→put:窗口仍在,
 * 但 hash key 写入是同值幂等,残余危害只剩重复索引条目。
 */
async function mintAdminWithPlaintext(
  store: StateStore,
  plaintext: string,
  now: string,
): Promise<void> {
  const { key } = await mintKey(adminBootstrapInput(), now)
  const adminKey: SecretKey = { ...key, hash: await sha256Hex(plaintext) }
  const hashKey = KEY_SK_HASH + adminKey.hash
  let won: boolean
  if (store.putIfAbsent !== undefined) {
    won = await store.putIfAbsent(hashKey, adminKey)
  } else {
    won = (await store.get(hashKey)) === null
    if (won) await store.put(hashKey, adminKey)
  }
  if (won) await store.put(KEY_SK_ID + adminKey.id, adminKey.hash)
}

/**
 * 内置节点幂等 ensure(Q15):已引导实例(幂等标志已置位)升级后也要
 * 补挂新加入的内置节点(如 system/plugin)。只写缺失节点(get miss → write),
 * 不覆盖既有节点——避免每个 isolate 冷启动都重写状态,也不动管理面改过的描述。
 */
async function ensureBuiltinNodes(registry: NodeRegistryStore, now: string, management: boolean, additionalModules: string[]): Promise<void> {
  const ensure = async (node: NodeInput): Promise<void> => {
    try {
      await registry.get(node.path)
    } catch {
      await registry.write(node, 'system:boot', now)
    }
  }
  await ensure({ path: 'system', kind: 'directory', description: 'Platform admin' })
  for (const module of [...BUILTIN_MODULES, ...(management ? ['config', 'storage', 'deployment'] : []), ...additionalModules]) {
    await ensure({
      path: `system/${module}`,
      kind: 'builtin',
      description: BUILTIN_DESCRIPTIONS[module] ?? module,
      config: { kind: 'builtin', module },
    })
  }
}

async function doBootstrap(
  store: StateStore,
  adminSk: string | undefined,
  management = false,
  additionalModules: string[] = [],
): Promise<void> {
  const now = new Date().toISOString()
  const bootstrapped = (await store.get(KEY_BOOTSTRAPPED)) !== null

  if (!bootstrapped) {
    if (!adminSk) throw new TBError('unavailable', 'first bootstrap requires an explicitly supplied admin credential', { retryable: false })
    await mintAdminWithPlaintext(store, adminSk, now)
  }

  // 2) 内置节点:system directory + 各 builtin;已引导实例也幂等 ensure(Q15)。
  await ensureBuiltinNodes(new NodeRegistryStore(store), now, management, additionalModules)

  // 3) 幂等标志(Admin SK 引导不重复;E2E-1③ 重跑不重复输出明文)。
  if (!bootstrapped) await store.put(KEY_BOOTSTRAPPED, true)
}

/**
 * 宿主中立的一次性引导(SDK 等嵌入宿主直接调用;幂等,但不做并发去重——
 * 嵌入宿主自管 once,Workers 用下方 ensureBootstrapped 的模块级 once)。
 */
export function runBootstrap(
  store: StateStore,
  opts?: { additionalModules?: string[], adminSk?: string, management?: boolean },
): Promise<void> {
  return doBootstrap(store, opts?.adminSk, opts?.management ?? false, opts?.additionalModules ?? [])
}

/** builtin 装配入参(宿主解析后注入;不吃 Workers Env)。 */
export interface BuiltinAssemblyOpts {
  /** 放行 http:// plugin endpoint(仅本地开发)。 */
  allowInsecureHttp: boolean
  /** 进程内插件装配表;binding: endpoint 的探活/契约抓取经此直调。 */
  pluginBindings?: PluginBindings
  /** 内置插件目录 descriptor;`system/catalog` 的数据源(只读)。 */
  pluginCatalog?: BuiltinCatalog
  /** remote 联邦白名单的 env 基线(TB_REMOTE_ALLOWLIST 解析后;供 system/federation list 标注不可删)。 */
  remoteAllowlistBase: string[]
  secrets: SecretStoreImpl
  store: StateStore
  /** 网关 version(单一真源:package.json)。 */
  version: string
}

/** 装配 BuiltinDeps(供 createBuiltins)。 */
export function buildDeps(opts: BuiltinAssemblyOpts): BuiltinDeps {
  return {
    sk: new SKRegistryStore(opts.store),
    secret: opts.secrets,
    registry: new NodeRegistryStore(opts.store),
    version: () => opts.version,
    // registry 管理通道也走可见性裁剪(list 裁剪 / get→not_found)。
    visibility: checkScopes,
    // plugin 模块:探活/契约抓取的 I/O 回调在此注入,core 保持无 I/O。
    plugin: {
      store: opts.store,
      probe: manifest => probePlugin(manifest, opts.pluginBindings),
      fetchContract: manifest => fetchPluginContract(manifest, opts.pluginBindings),
      allowInsecureHttp: opts.allowInsecureHttp,
    },
    // federation 模块:remote host 白名单运行时存储 + env 基线。
    federation: { store: new RemoteAllowlistStore(opts.store), base: opts.remoteAllowlistBase },
    // annotation 模块:Path 补充说明(registry 复用上方注入做 path 校验)。
    annotation: { store: new AnnotationStore(opts.store) },
    // catalog 模块:内置目录的只读浏览面。装配了目录才挂 —— 没装内置插件的宿主
    // 不该多一个恒空的节点(引导仍会建 system/catalog 节点,但 dispatch 回空页)。
    catalog: { catalog: () => opts.pluginCatalog ?? {} },
  }
}
