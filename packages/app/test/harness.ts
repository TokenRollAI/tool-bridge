import {
  type BuiltinCatalog,
  MemoryObjectStore,
  MemoryStateStore,
  type ObjectStore,
  type SearchIndex,
  SecretStoreImpl,
  type StateStore,
} from '@tool-bridge/core'
import { createTbApp, type PluginBindings, type RemoteSettings, runBootstrap, type TbAppDeps } from '../src/index'
import { TEST_ADMIN_SK, TEST_ENCRYPTION_KEY } from './fixtures'

/**
 * Node 宿主下的中立层测试装配。
 *
 * 语义对齐 `packages/gateway/test` 的 `SELF.fetch`:那边一个测试文件共享一个 Worker
 * 实例与一份持久 KV,故这里也按**文件级单实例**用(模块顶层 `await createTestApp()`),
 * 用例之间状态累积。需要隔离的用例自己再建一个。
 *
 * remote 白名单与 instanceId 取值与 gateway `vitest.config.ts` 注入的 miniflare
 * bindings 一致(`example.com` / `tb-test-instance`),同一批断言两边可直接对照。
 */

/**
 * `/healthz` 与 `system/status` 回显的版本号。宿主中立层没有"自己的部署版本"概念
 * (版本由宿主 package.json 单一真源提供),测试固定一个值即可。
 */
export const TEST_VERSION = 'test'

export const TEST_REMOTE: RemoteSettings = {
  allowlist: ['example.com'],
  maxHops: 4,
  instanceId: 'tb-test-instance',
  allowInsecure: false,
}

export interface TestAppOpts {
  /** 放行 http:// 上游(对应 gateway 的 TB_ALLOW_INSECURE_HTTP)。 */
  allowInsecureHttp?: boolean
  /** Static Assets 桩(缺省不注入 → /ui 404;真资源接线由 gateway 的 ui 套件覆盖)。 */
  assets?: (request: Request) => Promise<Response>
  canonicalOrigin?: string
  /** 设备通道桩(缺省不注入 → device 能力禁用;真 DO 行为由 gateway 套件覆盖)。 */
  device?: TbAppDeps['device']
  /** 缺省注入 MemoryObjectStore;传 null 则不注入(模拟宿主无对象存储)。 */
  objects?: ObjectStore | null
  pluginBindings?: PluginBindings
  /** 内置集成目录;缺省不注入 → `system/catalog` 回空页(未装内置插件的宿主)。 */
  pluginCatalog?: BuiltinCatalog
  refThresholdBytes?: number
  refTtlSec?: number
  remote?: Partial<RemoteSettings>
  search?: SearchIndex
  toolCacheTtlSec?: number
}

export interface TestApp {
  app: ReturnType<typeof createTbApp>
  objects: MemoryObjectStore | undefined
  /** `SELF.fetch` 的等价物:签名一致,直接打中立层 Hono app。 */
  request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  secrets: SecretStoreImpl
  state: StateStore
}

/** 引导 + 装配一个中立层实例;Admin SK 固定为 TEST_ADMIN_SK。 */
export async function createTestApp(opts: TestAppOpts = {}): Promise<TestApp> {
  const state = new MemoryStateStore()
  await runBootstrap(state, { adminSk: TEST_ADMIN_SK, requireAdminSk: true })
  const secrets = new SecretStoreImpl(state, TEST_ENCRYPTION_KEY)
  const objects = opts.objects === null
    ? undefined
    : (opts.objects ?? new MemoryObjectStore())

  const deps: TbAppDeps = {
    allowInsecureHttp: opts.allowInsecureHttp ?? false,
    encryptionKey: TEST_ENCRYPTION_KEY,
    remote: { ...TEST_REMOTE, ...opts.remote },
    secrets,
    state,
    version: TEST_VERSION,
  }
  if (objects !== undefined) deps.objects = () => objects
  if (opts.assets !== undefined) deps.assets = opts.assets
  if (opts.canonicalOrigin !== undefined) deps.canonicalOrigin = opts.canonicalOrigin
  if (opts.device !== undefined) deps.device = opts.device
  if (opts.pluginBindings !== undefined) deps.pluginBindings = opts.pluginBindings
  if (opts.pluginCatalog !== undefined) deps.pluginCatalog = opts.pluginCatalog
  if (opts.refThresholdBytes !== undefined) deps.refThresholdBytes = opts.refThresholdBytes
  if (opts.refTtlSec !== undefined) deps.refTtlSec = opts.refTtlSec
  if (opts.search !== undefined) deps.search = opts.search
  if (opts.toolCacheTtlSec !== undefined) deps.toolCacheTtlSec = opts.toolCacheTtlSec

  const app = createTbApp(deps)
  return {
    app,
    objects: objects instanceof MemoryObjectStore ? objects : undefined,
    request: async (input, init) => await app.request(input as never, init),
    secrets,
    state,
  }
}

/** Bearer 头(默认 Admin SK)。 */
export function bearer(sk: string = TEST_ADMIN_SK, extra: RequestInit = {}): RequestInit {
  return {
    ...extra,
    headers: { authorization: `Bearer ${sk}`, ...(extra.headers ?? {}) },
  }
}
