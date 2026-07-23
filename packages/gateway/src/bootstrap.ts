import {
  adminBootstrapInput,
  AnnotationStore,
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
import { fetchPluginContract, probePlugin } from './providers/pluginClient'

interface BootstrapEnv {
  TB_BOOTSTRAP_ADMIN_SK?: string
  TB_SECRET_ENCRYPTION_KEY?: string
}

/**
 * Admin SK 引导 + 内置节点物化(先引导 Admin SK,再物化内置节点)。
 *
 * Workers 无启动钩子,故在首个请求时惰性执行;模块级 promise 防并发重入(单 isolate 内
 * 只跑一次真正的引导逻辑)。幂等标志 KEY_BOOTSTRAPPED 存在即整体跳过(E2E-1③ 重跑不重复
 * 输出 Admin SK 明文)。
 *
 * Workers 首次引导必须提供 TB_BOOTSTRAP_ADMIN_SK(sha256 后入库),不把最高权限凭证
 * 写入持久日志。宿主中立 runBootstrap 仍为 Node/SDK 保留随机生成并向本地 stdout
 * 展示一次的兼容路径。
 */

/** 引导时注册的内置节点(system directory + 七个 builtin,含 annotation;feedback 走 ~feedback 保留段,非 builtin)。 */
const BUILTIN_MODULES = [
  'sk',
  'secret',
  'registry',
  'status',
  'plugin',
  'federation',
  'annotation',
] as const

const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  sk: 'SecretKey registry',
  secret: 'Upstream credential store',
  registry: 'Node registry',
  status: 'Gateway health and summary',
  plugin: 'Plugin registry',
  federation: 'Remote federation host allowlist',
  annotation: 'Admin notes shown in ~help of any path',
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
 * 内置节点幂等 ensure(Q15):已引导实例(幂等标志已置位)升级后也要
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

async function doBootstrap(
  store: StateStore,
  adminSk: string | undefined,
  requireAdminSk: boolean,
): Promise<void> {
  const now = new Date().toISOString()
  const bootstrapped = (await store.get(KEY_BOOTSTRAPPED)) !== null

  // 1) Admin SK(仅首次引导):Workers 要求预置;Node/SDK 兼容路径可随机生成并显示一次。
  if (!bootstrapped) {
    const sk = new SKRegistryStore(store)
    if (adminSk !== undefined && adminSk.length > 0) {
      await mintAdminWithPlaintext(store, adminSk, now)
      console.log('[tool-bridge] bootstrapped: Admin SK = <provided via TB_BOOTSTRAP_ADMIN_SK>')
    } else {
      if (requireAdminSk) {
        throw new TBError(
          'unavailable',
          'first Worker bootstrap requires TB_BOOTSTRAP_ADMIN_SK; set it with `wrangler secret put TB_BOOTSTRAP_ADMIN_SK`',
          { retryable: false },
        )
      }
      const { secret } = await sk.write(adminBootstrapInput(), now)
      // 随机路径下明文只能在此处展示一次(不输出即永久丢失);但 console 日志会进
      // `wrangler tail` 与 Cloudflare Dashboard,任何有账户访问权者可读到。故显式告警,
      // 引导部署者改用 TB_BOOTSTRAP_ADMIN_SK 预置(该路径不落明文日志)。
      console.warn(
        '[tool-bridge] SECURITY: a random Admin SK was generated and printed to the log below. '
        + 'Worker logs are visible via `wrangler tail` and the Cloudflare dashboard — capture this '
        + 'value now, then rotate it, or redeploy with TB_BOOTSTRAP_ADMIN_SK set to avoid plaintext logs.',
      )
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
export function runBootstrap(
  store: StateStore,
  opts?: { adminSk?: string, requireAdminSk?: boolean },
): Promise<void> {
  // Node/SDK 有部署者可见的本地 stdout,为兼容现有一次性引导流程默认仍允许随机生成。
  return doBootstrap(store, opts?.adminSk, opts?.requireAdminSk ?? false)
}

/**
 * 首个请求时惰性引导(幂等 + 并发安全)。返回后 store 已就绪。
 * env 传入以取 TB_BOOTSTRAP_ADMIN_SK / TB_SECRET_ENCRYPTION_KEY(后者供 secret 能力)。
 */
export function ensureBootstrapped(store: StateStore, env: BootstrapEnv): Promise<void> {
  if (bootstrapOnce === undefined) {
    // Workers 日志会被账户成员与日志系统读取:新实例必须显式预置 Admin SK,禁止把
    // 随机生成的最高权限凭证写入 console。已引导实例不再需要保留该 env secret。
    bootstrapOnce = doBootstrap(store, env.TB_BOOTSTRAP_ADMIN_SK, true).catch((err) => {
      // 引导失败:重置 once 以便下个请求重试(避免永久卡死)。
      bootstrapOnce = undefined
      throw err
    })
  }
  return bootstrapOnce
}

/** builtin 装配入参(宿主解析后注入;不吃 Workers Env)。 */
export interface BuiltinAssemblyOpts {
  /** 放行 http:// plugin endpoint(仅本地开发)。 */
  allowInsecureHttp: boolean
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
      probe: probePlugin,
      fetchContract: fetchPluginContract,
      allowInsecureHttp: opts.allowInsecureHttp,
    },
    // federation 模块:remote host 白名单运行时存储 + env 基线。
    federation: { store: new RemoteAllowlistStore(opts.store), base: opts.remoteAllowlistBase },
    // annotation 模块:Path 补充说明(registry 复用上方注入做 path 校验)。
    annotation: { store: new AnnotationStore(opts.store) },
  }
}

/** 测试辅助:重置模块级 once(每个测试 isolate 独立,一般无需;导出以备用)。 */
export function resetBootstrapForTest(): void {
  bootstrapOnce = undefined
}
