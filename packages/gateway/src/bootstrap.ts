import {
  adminBootstrapInput,
  type BuiltinDeps,
  checkScopes,
  KEY_BOOTSTRAPPED,
  KEY_SK_HASH,
  KEY_SK_ID,
  mintKey,
  type NodeInput,
  NodeRegistryStore,
  type SecretKey,
  type SecretStoreImpl,
  SKRegistryStore,
  type StateStore,
  sha256Hex,
} from '@tool-bridge/core'
import { fetchPluginContract, probePlugin } from './providers/pluginClient'

interface BootstrapEnv {
  TB_BOOTSTRAP_ADMIN_SK?: string
  TB_SECRET_ENCRYPTION_KEY?: string
}

/**
 * Admin SK 引导 + 内置节点物化(Proto §2.3 Admin SK 引导、Arch:304 引导顺序)。
 *
 * Workers 无启动钩子,故在首个请求时惰性执行;模块级 promise 防并发重入(单 isolate 内
 * 只跑一次真正的引导逻辑)。幂等标志 KEY_BOOTSTRAPPED 存在即整体跳过(E2E-1③ 重跑不重复
 * 输出 Admin SK 明文)。
 *
 * Admin SK 明文只在首次引导时 console.log 一次:
 * - env.TB_BOOTSTRAP_ADMIN_SK 提供 → 以它为明文(sha256 后入库,便于部署自动化);
 * - 否则由 mintKey 生成随机明文。
 */

/** 引导时注册的内置节点(system directory + 五个 builtin;plugin 自 Phase 5 加入,Arch:313)。 */
const BUILTIN_MODULES = ['sk', 'secret', 'registry', 'status', 'plugin'] as const

const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  sk: 'SecretKey registry',
  secret: 'Upstream credential store',
  registry: 'Node registry',
  status: 'Gateway health and summary',
  plugin: 'Plugin registry',
}

let bootstrapOnce: Promise<void> | undefined

/** 用固定明文签发 Admin SK(便于部署自动化);hash 入库,不生成随机明文。 */
async function mintAdminWithPlaintext(
  store: StateStore,
  plaintext: string,
  now: string,
): Promise<void> {
  const { key } = await mintKey(adminBootstrapInput(), now)
  const adminKey: SecretKey = { ...key, hash: await sha256Hex(plaintext) }
  await store.put(KEY_SK_HASH + adminKey.hash, adminKey)
  await store.put(KEY_SK_ID + adminKey.id, adminKey.hash)
}

/**
 * 内置节点幂等 ensure(Q15,Phase 5 定型):已引导实例(幂等标志已置位)升级后也要
 * 补挂新加入的内置节点(如 system/plugin)。只写缺失节点(get miss → write),
 * 不覆盖既有节点——避免每个 isolate 冷启动都重写 KV,也不动管理面改过的描述。
 */
async function ensureBuiltinNodes(registry: NodeRegistryStore, now: string): Promise<void> {
  const ensure = async (node: NodeInput): Promise<void> => {
    try {
      await registry.get(node.path)
    } catch {
      await registry.write(node, 'system:boot', now)
    }
  }
  await ensure({ path: 'system', kind: 'directory', description: 'Platform admin' })
  for (const module of BUILTIN_MODULES) {
    await ensure({
      path: `system/${module}`,
      kind: 'builtin',
      description: BUILTIN_DESCRIPTIONS[module] ?? module,
      config: { kind: 'builtin', module },
    })
  }
}

async function doBootstrap(store: StateStore, adminSk: string | undefined): Promise<void> {
  const now = new Date().toISOString()
  const bootstrapped = (await store.get(KEY_BOOTSTRAPPED)) !== null

  // 1) Admin SK(仅首次引导):提供明文则用之,否则随机生成;明文只输出一次。
  if (!bootstrapped) {
    const sk = new SKRegistryStore(store)
    if (adminSk !== undefined && adminSk.length > 0) {
      await mintAdminWithPlaintext(store, adminSk, now)
      console.log('[tool-bridge] bootstrapped: Admin SK = <provided via TB_BOOTSTRAP_ADMIN_SK>')
    } else {
      const { secret } = await sk.write(adminBootstrapInput(), now)
      console.log(`[tool-bridge] bootstrapped: Admin SK (shown once) = ${secret}`)
    }
  }

  // 2) 内置节点:system directory + 各 builtin;已引导实例也幂等 ensure(Q15)。
  await ensureBuiltinNodes(new NodeRegistryStore(store), now)

  // 3) 幂等标志(Admin SK 引导不重复;E2E-1③ 重跑不重复输出明文)。
  if (!bootstrapped) await store.put(KEY_BOOTSTRAPPED, true)
}

/**
 * 宿主中立的一次性引导(SDK 等嵌入宿主直接调用;幂等,但不做并发去重——
 * 嵌入宿主自管 once,Workers 用下方 ensureBootstrapped 的模块级 once)。
 */
export function runBootstrap(store: StateStore, opts?: { adminSk?: string }): Promise<void> {
  return doBootstrap(store, opts?.adminSk)
}

/**
 * 首个请求时惰性引导(幂等 + 并发安全)。返回后 store 已就绪。
 * env 传入以取 TB_BOOTSTRAP_ADMIN_SK / TB_SECRET_ENCRYPTION_KEY(后者供 secret 能力)。
 */
export function ensureBootstrapped(store: StateStore, env: BootstrapEnv): Promise<void> {
  if (bootstrapOnce === undefined) {
    bootstrapOnce = doBootstrap(store, env.TB_BOOTSTRAP_ADMIN_SK).catch((err) => {
      // 引导失败:重置 once 以便下个请求重试(避免永久卡死)。
      bootstrapOnce = undefined
      throw err
    })
  }
  return bootstrapOnce
}

/** builtin 装配入参(宿主解析后注入;不吃 Workers Env)。 */
export interface BuiltinAssemblyOpts {
  store: StateStore
  secrets: SecretStoreImpl
  /** 网关 version(单一真源:package.json)。 */
  version: string
  /** 放行 http:// plugin endpoint(仅本地开发)。 */
  allowInsecureHttp: boolean
}

/** 装配 BuiltinDeps(供 createBuiltins)。 */
export function buildDeps(opts: BuiltinAssemblyOpts): BuiltinDeps {
  return {
    sk: new SKRegistryStore(opts.store),
    secret: opts.secrets,
    registry: new NodeRegistryStore(opts.store),
    version: () => opts.version,
    // registry 管理通道也走 §2.3 裁剪(list 裁剪 / get→not_found)。
    visibility: checkScopes,
    // plugin 模块(Proto §8.1):探活/契约抓取的 I/O 回调在此注入,core 保持无 I/O。
    plugin: {
      store: opts.store,
      probe: probePlugin,
      fetchContract: fetchPluginContract,
      allowInsecureHttp: opts.allowInsecureHttp,
    },
  }
}

/** 测试辅助:重置模块级 once(每个测试 isolate 独立,一般无需;导出以备用)。 */
export function resetBootstrapForTest(): void {
  bootstrapOnce = undefined
}
