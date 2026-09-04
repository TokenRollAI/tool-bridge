import {
  type BuiltinCatalog,
  MemoryMailboxRepository,
  MemoryObjectStore,
  MemoryStateStore,
  MemoryStoreRepository,
  type ObjectStore,
  type SearchIndex,
  SecretStoreImpl,
  type StateStore,
  TBError,
} from '@tool-bridge/core'
import { createTbApp, type PluginBindings, type RemoteSettings, runBootstrap, type TbAppDeps } from '../src/index'
import { TEST_ADMIN_SK, TEST_ENCRYPTION_KEY } from './fixtures'

/**
 * Node 宿主下的中立层测试装配。
 *
 * 模块顶层 `await createTestApp()` 创建文件级 app 实例，用例之间可共享内存状态。
 * 需要独立状态的用例显式创建新实例。真实 Node socket、PG 与 S3 行为由 server 套件覆盖。
 * remote 白名单与 instanceId 使用下方固定值，避免依赖本机部署配置。
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
  /** 显式放行测试中的 http:// 上游。 */
  allowInsecureHttp?: boolean
  /** 静态资源桩；缺省不注入 → /ui 404，真实资源接线由 server UI 套件覆盖。 */
  assets?: (request: Request) => Promise<Response>
  canonicalOrigin?: string
  /** 设备通道桩；缺省不注入 → device 能力禁用，真实 WebSocket 由 server 套件覆盖。 */
  device?: TbAppDeps['device']
  /** 缺省注入 MemoryObjectStore;传 null 则不注入(模拟宿主无对象存储)。 */
  objects?: ObjectStore | null
  /** 自定义对象工厂；用于验证请求期失败与调用次数。给出时优先于 objects。 */
  objectsFactory?: TbAppDeps['objects']
  pluginBindings?: PluginBindings
  /** 内置集成目录;缺省不注入 → `system/catalog` 回空页(未装内置插件的宿主)。 */
  pluginCatalog?: BuiltinCatalog
  /** Provider OAuth 出站桩；缺省不注入，以覆盖生产 fail-closed 语义。 */
  providerOAuthFetch?: typeof fetch
  refThresholdBytes?: number
  refTtlSec?: number
  remote?: Partial<RemoteSettings>
  search?: SearchIndex
  storeCallAllowedContentTypes?: string[]
  storeCallMaxBytes?: number
  storeCallMaxObjectBytes?: number
  storeCallMaxObjects?: number
  storeMaxObjectBytes?: number
  storeReadTtlSec?: number
  storeRelayMaxBytes?: number
  storeShareTtlSec?: number
  storeTokenSecret?: string
  storeUploadTtlSec?: number
  toolCacheTtlSec?: number
  uploadGrantTtlSec?: number
}

export interface TestApp {
  app: ReturnType<typeof createTbApp>
  deps: TbAppDeps
  objects: MemoryObjectStore | undefined
  /** `SELF.fetch` 的等价物:签名一致,直接打中立层 Hono app。 */
  request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  secrets: SecretStoreImpl
  state: StateStore
}

/** 引导 + 装配一个中立层实例;Admin SK 固定为 TEST_ADMIN_SK。 */
export async function createTestApp(opts: TestAppOpts = {}): Promise<TestApp> {
  const state = new MemoryStateStore()
  await runBootstrap(state, { adminSk: TEST_ADMIN_SK })
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
    storeRepository: new MemoryStoreRepository(),
    mailboxRepository: new MemoryMailboxRepository(),
  }
  if (opts.objectsFactory !== undefined) deps.objects = opts.objectsFactory
  else if (objects !== undefined) deps.objects = () => objects
  if (deps.objects) {
    const resolve = deps.objects
    deps.defaultObjectBackend = async () => ({ id: 'test-backend', objects: await resolve() })
    deps.storeBackends = { defaultBackend: deps.defaultObjectBackend, resolveBackend: async () => resolve() }
    deps.objectStoreForBackend = (id) => {
      if (id !== 'test-backend') throw TBError.notFound('Storage backend not found')
      return resolve()
    }
  }
  if (opts.assets !== undefined) deps.assets = opts.assets
  if (opts.canonicalOrigin !== undefined) deps.canonicalOrigin = opts.canonicalOrigin
  if (opts.device !== undefined) deps.device = opts.device
  if (opts.pluginBindings !== undefined) deps.pluginBindings = opts.pluginBindings
  if (opts.pluginCatalog !== undefined) deps.pluginCatalog = opts.pluginCatalog
  if (opts.providerOAuthFetch !== undefined) deps.providerOAuthFetch = opts.providerOAuthFetch
  if (opts.refThresholdBytes !== undefined) deps.refThresholdBytes = opts.refThresholdBytes
  if (opts.refTtlSec !== undefined) deps.refTtlSec = opts.refTtlSec
  if (opts.search !== undefined) deps.search = opts.search
  if (opts.storeCallAllowedContentTypes !== undefined) {
    deps.storeCallAllowedContentTypes = opts.storeCallAllowedContentTypes
  }
  if (opts.storeCallMaxBytes !== undefined) deps.storeCallMaxBytes = opts.storeCallMaxBytes
  if (opts.storeCallMaxObjectBytes !== undefined) {
    deps.storeCallMaxObjectBytes = opts.storeCallMaxObjectBytes
  }
  if (opts.storeCallMaxObjects !== undefined) deps.storeCallMaxObjects = opts.storeCallMaxObjects
  if (opts.storeMaxObjectBytes !== undefined) deps.storeMaxObjectBytes = opts.storeMaxObjectBytes
  if (opts.storeReadTtlSec !== undefined) deps.storeReadTtlSec = opts.storeReadTtlSec
  if (opts.storeRelayMaxBytes !== undefined) deps.storeRelayMaxBytes = opts.storeRelayMaxBytes
  if (opts.storeShareTtlSec !== undefined) deps.storeShareTtlSec = opts.storeShareTtlSec
  if (opts.storeTokenSecret !== undefined) deps.storeTokenSecret = opts.storeTokenSecret
  if (opts.storeUploadTtlSec !== undefined) deps.storeUploadTtlSec = opts.storeUploadTtlSec
  if (opts.toolCacheTtlSec !== undefined) deps.toolCacheTtlSec = opts.toolCacheTtlSec
  if (opts.uploadGrantTtlSec !== undefined) deps.uploadGrantTtlSec = opts.uploadGrantTtlSec

  const app = createTbApp(deps)
  return {
    app,
    deps,
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
