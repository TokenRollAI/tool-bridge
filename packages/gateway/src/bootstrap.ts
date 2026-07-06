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
  SecretStoreImpl,
  SKRegistryStore,
  type StateStore,
  sha256Hex,
} from '@tool-bridge/core'
import type { Env } from './app'
import { KvStateStore } from './kvStateStore'

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

/** 引导时注册的内置节点(system directory + 四个 builtin;plugin 在 Phase 5)。 */
const BUILTIN_MODULES = ['sk', 'secret', 'registry', 'status'] as const

const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  sk: 'SecretKey registry',
  secret: 'Upstream credential store',
  registry: 'Node registry',
  status: 'Gateway health and summary',
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

async function doBootstrap(store: StateStore, env: BootstrapEnv): Promise<void> {
  if ((await store.get(KEY_BOOTSTRAPPED)) !== null) return

  const now = new Date().toISOString()
  const sk = new SKRegistryStore(store)

  // 1) Admin SK:提供明文则用之,否则随机生成;明文只输出一次。
  if (env.TB_BOOTSTRAP_ADMIN_SK !== undefined && env.TB_BOOTSTRAP_ADMIN_SK.length > 0) {
    await mintAdminWithPlaintext(store, env.TB_BOOTSTRAP_ADMIN_SK, now)
    console.log('[tool-bridge] bootstrapped: Admin SK = <provided via TB_BOOTSTRAP_ADMIN_SK>')
  } else {
    const { secret } = await sk.write(adminBootstrapInput(), now)
    console.log(`[tool-bridge] bootstrapped: Admin SK (shown once) = ${secret}`)
  }

  // 2) 内置节点:system directory + 四个 builtin。registeredBy = system:boot。
  const registry = new NodeRegistryStore(store)
  const systemDir: NodeInput = { path: 'system', kind: 'directory', description: 'Platform admin' }
  await registry.write(systemDir, 'system:boot', now)
  for (const module of BUILTIN_MODULES) {
    const node: NodeInput = {
      path: `system/${module}`,
      kind: 'builtin',
      description: BUILTIN_DESCRIPTIONS[module] ?? module,
      config: { kind: 'builtin', module },
    }
    await registry.write(node, 'system:boot', now)
  }

  // 3) 幂等标志。
  await store.put(KEY_BOOTSTRAPPED, true)
}

/**
 * 首个请求时惰性引导(幂等 + 并发安全)。返回后 store 已就绪。
 * env 传入以取 TB_BOOTSTRAP_ADMIN_SK / TB_SECRET_ENCRYPTION_KEY(后者供 secret 能力)。
 */
export function ensureBootstrapped(store: StateStore, env: BootstrapEnv): Promise<void> {
  if (bootstrapOnce === undefined) {
    bootstrapOnce = doBootstrap(store, env).catch((err) => {
      // 引导失败:重置 once 以便下个请求重试(避免永久卡死)。
      bootstrapOnce = undefined
      throw err
    })
  }
  return bootstrapOnce
}

/** 装配 BuiltinDeps(供 createBuiltins);version 由调用方注入。 */
export function buildDeps(store: StateStore, env: Env, version: string): BuiltinDeps {
  return {
    sk: new SKRegistryStore(store),
    secret: new SecretStoreImpl(store, env.TB_SECRET_ENCRYPTION_KEY),
    registry: new NodeRegistryStore(store),
    version: () => version,
    // registry 管理通道也走 §2.3 裁剪(list 裁剪 / get→not_found)。
    visibility: checkScopes,
  }
}

/** 测试辅助:重置模块级 once(每个测试 isolate 独立,一般无需;导出以备用)。 */
export function resetBootstrapForTest(): void {
  bootstrapOnce = undefined
}

export { KvStateStore }
