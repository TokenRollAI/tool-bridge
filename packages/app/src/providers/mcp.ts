/**
 * mcp 内置 Provider:经官方 MCP SDK 的 Streamable HTTP client 连接 `config.url`。
 *
 * - `List` ← `tools/list`,`Call` ← `tools/call`;上游 `tools[].inputSchema` 已是 JSON Schema,
 *   直接进 `ToolSpec.inputSchema`;annotations 派生 effect(readOnlyHint→read、
 *   destructiveHint→destructive;无提示则不标注,避免过度声明)。
 *
 * - **era 判定与缓存**(`mcpera:<nodePath>`):SDK v2 的 `versionNegotiation` 默认 `'legacy'`,
 *   不显式开启就永远说 2025 系。故冷路径用 `mode:'auto'`——先探 `server/discover`,拿到
 *   确定性 modern 证据才走 2026-07-28,否则保守回落 `initialize`。判定结果按节点缓存:
 *   - modern:连同 `DiscoverResult` 一起存,后续经 `prior:{kind:'modern',discover}`
 *     **零协商往返**复连(实测:每次调用只剩 1 趟上游请求)。`DiscoverResult` 自带
 *     `capabilities`,所以能力已播种,不会踩到下面那条空列表陷阱。
 *     缓存时限取上游自己在 discover 上给的 `ttlMs`(SEP-2549);为 0 则不缓存。
 *   - legacy:只存判定本身,并**必须带时限**。SDK 明确警告:陈旧的 modern 判定会在首个
 *     请求响亮失败,而陈旧的 legacy 判定会永久静默成功(升级后的服务器照样应答
 *     `initialize`),即上游升级到 modern 我们永远发现不了。故按 `LEGACY_ERA_HORIZON_SEC`
 *     到期重探。
 *
 * - **不复用会话**。每次传输都保留 SDK 建立能力状态所需的握手；era cache 只跳过协议
 *   探测,不保存 `Mcp-Session-Id`。`~help` 的 `toolcache` 负责跨请求复用工具清单，调用结果
 *   永不缓存。
 *
 * - `enforceStrictCapabilities: true`:能力门一旦落空就抛错,不返回空列表。空工具清单是
 *   我们踩过的事故类型,宁可响亮失败也不静默交付一个空目录。
 *
 * - 上游请求头 = `headers`(静态明文,如上游要求的工具白名单头)+ `authRef` 凭证头
 *   (`authHeaderFor` 语义:默认 `Authorization: Bearer`,可经 `authHeader`/`authScheme`
 *   改头名/前缀,空 scheme 原样注入;凭证头覆盖同名静态头)。
 *   `auth:'oauth'` 时改挂网关托管 OAuthClientProvider(oauth.ts;mode:'deny'):SDK 自动带
 *   token、401 时自动 refresh;需要交互(重新)授权 → reauthorizeRequired 指引 `tb tool auth`。
 * - **单一 choke point**(`guard`):一切传输/协议错误经 `normalizeUpstreamError` 归一为 TBError;
 *   MCP RPC 业务错误(`result.isError`)不是错误——落 `ToolResult.isError`,正常返回。
 */

import {
  assertSecureUrl,
  authHeaderFor,
  isTBError,
  normalizeUpstreamError,
  type SecretStoreImpl,
  type StateStore,
  TBError,
  type ToolResult,
  type ToolSpec,
  type TreePath,
} from '@tool-bridge/core'
import {
  Client,
  type DiscoverResult,
  type ProtocolEra,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from '@modelcontextprotocol/client'
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/client/validators/cf-worker'
import type { UpstreamProvider } from './types'
import { GatewayMcpOAuthProvider, reauthorizeRequired } from '../oauth'

/** mcp 节点 config。auth:'oauth' → 凭证走网关托管 OAuth(oauth.ts),authRef 忽略。 */
export interface McpConfig {
  auth?: 'oauth'
  /** authRef 凭证注入的头名(默认 Authorization)。 */
  authHeader?: string
  authRef?: string
  /** 凭证前缀;空串 = 原样注入(默认 Bearer)。 */
  authScheme?: string
  /** 静态明文请求头(非机密);authRef 凭证头覆盖同名项。 */
  headers?: Record<string, string>
  url: string
}

/** MCP SDK 返回的单个工具形状(仅取我们用到的字段)。 */
interface McpTool {
  annotations?: { destructiveHint?: boolean, readOnlyHint?: boolean }
  description?: string
  inputSchema?: unknown
  name: string
  /** MCP 2025-06-18 起的结构化输出声明;归一进 ToolSpec 后经工具级 `~help` 披露。 */
  outputSchema?: unknown
}

/** annotations → effect 词汇;无明确提示则返回 undefined(不臆测 write)。 */
function effectFromAnnotations(a: McpTool['annotations']): string | undefined {
  if (!a) return undefined
  if (a.readOnlyHint === true) return 'read'
  if (a.destructiveHint === true) return 'destructive'
  return undefined
}

function toSpec(t: McpTool): ToolSpec {
  const spec: ToolSpec = { name: t.name }
  if (t.description !== undefined) spec.description = t.description
  if (t.inputSchema !== undefined) spec.inputSchema = t.inputSchema
  if (t.outputSchema !== undefined) spec.outputSchema = t.outputSchema
  const effect = effectFromAnnotations(t.annotations)
  if (effect !== undefined) spec.effect = effect
  return spec
}

/** callTool 结果 → ToolResult:全 text 片段拼接;含非 text 片段则结构化原样返回。 */
function toToolResult(res: {
  content?: unknown
  isError?: boolean
  structuredContent?: Record<string, unknown>
}): ToolResult {
  const parts = Array.isArray(res.content)
    ? (res.content as Array<{ text?: string, type: string }>)
    : []
  const allText = parts.length > 0 && parts.every(p => p.type === 'text')
  const content: unknown = allText ? parts.map(p => p.text ?? '').join('') : res.content
  const out: ToolResult = { content }
  if (Array.isArray(res.content)) out.contentBlocks = res.content
  if (res.isError === true) out.isError = true
  if (res.structuredContent !== undefined) out.structuredContent = res.structuredContent
  return out
}

/**
 * 我们只使用 request/response 能力(listTools/callTool),不消费服务端主动消息流。
 * legacy era 的 SDK 在 initialize 后会自动尝试 GET 打开可选 standalone SSE;这里对 SSE GET
 * (Accept: text/event-stream)直接返回 405(协议允许:服务器不提供 SSE),避免关闭时中止一条
 * 无用网络连接。只拦 SSE:authProvider 的 OAuth discovery/token 刷新也复用本 fetch,
 * 其 GET(.well-known)必须放行。
 */
const noStandaloneSseFetch: typeof fetch = (input, init) => {
  const method
    = init?.method
      ?? (input instanceof Request
        ? input.method
        : typeof input === 'object' && 'method' in input
          ? input.method
          : 'GET')
  const accept
    = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get(
      'accept',
    ) ?? ''
  if (String(method).toUpperCase() === 'GET' && accept.includes('text/event-stream')) {
    return Promise.resolve(new Response(null, { status: 405, statusText: 'Method Not Allowed' }))
  }
  return fetch(input, init)
}

/** era 判定缓存的存取(key `mcpera:<nodePath>`)。缓存的是协议 era 判定,不是任何调用结果。 */
export interface McpSessionStore {
  nodePath: TreePath
  store: StateStore
}

interface CachedEra {
  /** modern 判定必带:replay 给 `prior` 用(自带 capabilities,省一趟且播种能力)。 */
  discover?: DiscoverResult
  era: ProtocolEra
  /** 到期时刻(epoch 秒)。到期即重探,不做过期供给。 */
  expiresAt: number
  updatedAt: string
}

const ERA_KEY_PREFIX = 'mcpera:'

/**
 * legacy 判定的策略时限:上游从 2025 系升级到 2026-07-28 时,陈旧的 legacy 判定不会报错、
 * 只会让我们一直用老 era 说话。5 分钟重探一次即可发现升级,代价是每节点每 5 分钟多一趟探测。
 */
const LEGACY_ERA_HORIZON_SEC = 300

function eraKey(nodePath: TreePath): string {
  return `${ERA_KEY_PREFIX}${nodePath}`
}

function isCachedEra(v: unknown): v is CachedEra {
  if (typeof v !== 'object' || v === null) return false
  const c = v as CachedEra
  return (c.era === 'modern' || c.era === 'legacy') && typeof c.expiresAt === 'number'
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

async function loadEra(s: McpSessionStore | undefined): Promise<CachedEra | null> {
  if (s === undefined) return null
  const raw = await s.store.get(eraKey(s.nodePath))
  if (!isCachedEra(raw)) return null
  if (raw.expiresAt <= nowSec()) return null
  // modern 判定没带 discover 就无法零往返复连,当作未缓存重探。
  if (raw.era === 'modern' && raw.discover === undefined) return null
  return raw
}

async function saveEra(
  s: McpSessionStore | undefined,
  era: ProtocolEra,
  discover: DiscoverResult | undefined,
): Promise<void> {
  if (s === undefined) return
  if (era === 'modern') {
    // 时限取上游自己在 server/discover 上给的 ttlMs(SEP-2549;公开类型上没有这两个字段,
    // 但运行时确实携带)。上游给 0(最保守默认)就不缓存,老老实实每次重探。
    const ttlMs = (discover as { ttlMs?: number } | undefined)?.ttlMs ?? 0
    if (discover === undefined || !Number.isFinite(ttlMs) || ttlMs <= 0) return
    await s.store.put(eraKey(s.nodePath), {
      era,
      discover,
      expiresAt: nowSec() + Math.floor(ttlMs / 1000),
      updatedAt: new Date().toISOString(),
    } satisfies CachedEra)
    return
  }
  await s.store.put(eraKey(s.nodePath), {
    era,
    expiresAt: nowSec() + LEGACY_ERA_HORIZON_SEC,
    updatedAt: new Date().toISOString(),
  } satisfies CachedEra)
}

async function clearEra(s: McpSessionStore | undefined): Promise<void> {
  if (s === undefined) return
  await s.store.delete(eraKey(s.nodePath))
}

/** 删除某节点的 era 判定缓存(注册面 Write/Update/Delete 时调用:URL 变更后旧判定作废)。 */
export async function invalidateMcpEra(store: StateStore, nodePath: string): Promise<void> {
  await store.delete(`${ERA_KEY_PREFIX}${nodePath}`)
}

/**
 * era 协商失败:缓存的 modern 判定对不上上游实际支持的版本,或探测本身被上游用不合规的
 * 方式打断(HTTP 5xx / HTTP 200 + 非 JSON content-type)。
 *
 * 实测 SDK 的 `mode:'auto'` 只对「像老服务端」的反应回落——JSON-RPC `-32601` 与
 * HTTP 400/404/405 都能正确落到 `initialize`;5xx 与 content-type 异常则一律硬失败。
 */
function isEraNegotiationFailure(err: unknown): boolean {
  return err instanceof SdkError && err.code === SdkErrorCode.EraNegotiationFailed
}

/**
 * 从已连接的 modern client 复原一份可 replay 的 `DiscoverResult`。
 *
 * SDK 不直接把探测结果交还给调用方,但 `prior` 只消费 `supportedVersions` /
 * `capabilities` / `instructions`,而这三者都能从 client 的读取面拿到;协商版本即本次
 * 确定可用的那个 modern 版本。
 */
function discoverOf(client: Client): DiscoverResult | undefined {
  const version = client.getNegotiatedProtocolVersion()
  const capabilities = client.getServerCapabilities()
  if (version === undefined || capabilities === undefined) return undefined
  const instructions = client.getInstructions()
  return {
    supportedVersions: [version],
    capabilities,
    ...(instructions !== undefined ? { instructions } : {}),
  } as DiscoverResult
}

/** withUpstream 的上游认证形态:静态请求头(headers+authRef 拼装)或网关托管 OAuth provider(二选一)。 */
interface UpstreamAuth {
  headers?: Record<string, string>
  oauth?: GatewayMcpOAuthProvider
}

/**
 * 连上上游执行 `fn`。有可用 era 判定就按判定直连(modern 零协商往返 / legacy 直接握手);
 * 没有则 `mode:'auto'` 探测并回填判定。
 *
 * 缓存的 modern 判定过期失配时(上游降级/换实现)SDK 抛 `EraNegotiationFailed`——清判定、
 * 完整重探一次。legacy 判定不会失配报错,由 `LEGACY_ERA_HORIZON_SEC` 时限兜住。
 */
async function withUpstream<T>(
  url: string,
  auth: UpstreamAuth,
  session: McpSessionStore | undefined,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const makeTransport = (): StreamableHTTPClientTransport =>
    new StreamableHTTPClientTransport(new URL(url), {
      fetch: noStandaloneSseFetch,
      ...(auth.oauth !== undefined ? { authProvider: auth.oauth } : {}),
      ...(auth.headers !== undefined ? { requestInit: { headers: auth.headers } } : {}),
    })

  // SDK 默认的 Ajv 校验器经 new Function 编译 schema,workerd 禁 eval——上游工具一旦声明
  // outputSchema,tools/list 阶段就会抛 "Code generation from strings disallowed"。
  // 换 SDK 自带的 @cfworker/json-schema 解释执行实现。
  const makeClient = (probing: boolean): Client =>
    new Client(
      { name: 'tool-bridge', version: '0.0.0' },
      {
        jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
        // 空工具列表是我们踩过的事故;能力门落空要响亮失败,不要静默回空。
        enforceStrictCapabilities: true,
        ...(probing ? { versionNegotiation: { mode: 'auto' as const } } : {}),
      },
    )

  const cached = await loadEra(session)
  if (cached !== null) {
    const client = makeClient(false)
    await client.connect(makeTransport(), {
      prior: cached.era === 'modern'
        ? { kind: 'modern', discover: cached.discover as DiscoverResult }
        : { kind: 'legacy' },
    })
    try {
      return await fn(client)
    } catch (err) {
      if (!isEraNegotiationFailure(err)) throw err
      await clearEra(session)
      // 落回下面的完整重探
    }
  }

  /** 跳过探测,直接按 legacy 连——不合规上游的兜底,也是迁移前的等价行为。 */
  const runLegacy = async (): Promise<T> => {
    const client = makeClient(false)
    await client.connect(makeTransport(), { prior: { kind: 'legacy' } })
    await saveEra(session, 'legacy', undefined)
    return await fn(client)
  }

  const client = makeClient(true)
  try {
    await client.connect(makeTransport())
  } catch (err) {
    if (!isEraNegotiationFailure(err)) throw err
    // 上游用不合规的方式回绝了探测(见 isEraNegotiationFailure)。迁移前我们根本不探测,
    // 不该因为新增了一趟探测就连不上原本能用的老上游——保守当 legacy,并记住判定,
    // 使这趟失败的探测在时限内只发生一次。
    return await runLegacy()
  }
  const era = client.getProtocolEra()
  if (era !== undefined) {
    await saveEra(session, era, era === 'modern' ? discoverOf(client) : undefined)
  }
  return await fn(client)
}

/** 单一 choke point:把传输/协议错误归一为 TBError(已是 TBError 的原样抛出)。 */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isTBError(err)) throw err
    if (err instanceof SdkHttpError) {
      throw normalizeUpstreamError({ kind: 'http', status: err.status, message: err.message })
    }
    // SdkHttpError 之外还有一类:HTTP 200 但 content-type 不对(不合规上游),SDK 抛的是
    // 基类 SdkError 而非 SdkHttpError。归到 network 而不是漏成裸错误。
    throw normalizeUpstreamError({
      kind: 'network',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * 构造 mcp Provider。`allowInsecure`(env `TB_ALLOW_INSECURE_HTTP=true`)放行 http:// 上游。
 * 构造即做 https 强制:非法 url → 抛 invalid_argument(在 guard 之外,快速失败)。
 * `config.auth==='oauth'` 需要 opts.oauth(StateStore + 加密密钥);缺省 → unavailable。
 */
export function createMcpProvider(
  config: McpConfig,
  secrets: SecretStoreImpl,
  opts: {
    allowInsecure: boolean
    /** 托管 OAuth 的存取面(auth:'oauth' 节点必需;encryptionKey 缺省时不传)。 */
    oauth?: { encryptionKey: string, store: StateStore }
    session?: McpSessionStore
  },
): UpstreamProvider {
  const secErr = assertSecureUrl(config.url, opts.allowInsecure)
  if (secErr) throw secErr

  const nodePath = opts.session?.nodePath ?? ''
  const makeAuth = async (): Promise<UpstreamAuth> => {
    if (config.auth === 'oauth') {
      if (opts.oauth === undefined) {
        throw new TBError('unavailable', 'OAuth-backed mcp 需要 TB_SECRET_ENCRYPTION_KEY', {
          retryable: false,
        })
      }
      return {
        oauth: new GatewayMcpOAuthProvider({
          store: opts.oauth.store,
          nodePath,
          encryptionKey: opts.oauth.encryptionKey,
          mode: 'deny',
        }),
      }
    }
    // 静态头形态:headers(明文)+ authRef 凭证头(authHeaderFor 语义,覆盖同名)。
    const h: Record<string, string> = { ...(config.headers ?? {}) }
    if (config.authRef !== undefined) {
      const cred = await secrets.resolve(config.authRef)
      // fail closed:声明了 authRef 却解析不到 → unavailable,不静默以无凭证/仅静态头出站
      // (上游可能据此当匿名放行或返回误导性结果)。与 pluginClient 同语义:配置错误快速失败。
      if (cred === undefined) {
        throw new TBError('unavailable', `mcp authRef '${config.authRef}' 无法解析`, {
          retryable: false,
        })
      }
      const [hn, hv] = authHeaderFor(config, cred)
      h[hn] = hv
    }
    return Object.keys(h).length > 0 ? { headers: h } : {}
  }

  // SDK 静默刷新失败/无 token 时抛 UnauthorizedError(非 OAuthError 子类,guard 会归一成
  // network)——在 guard 之前显式映射为「重新授权」指引。
  const mapUnauthorized = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (err) {
      if (config.auth === 'oauth' && err instanceof UnauthorizedError) {
        throw reauthorizeRequired(nodePath)
      }
      throw err
    }
  }

  return {
    list: () =>
      guard(() =>
        mapUnauthorized(async () => {
          const auth = await makeAuth()
          const res = await withUpstream(
            config.url,
            auth,
            opts.session,
            c => c.listTools(),
          ) as { tools: McpTool[] }
          return res.tools.map(toSpec)
        }),
      ),
    call: (name, args) =>
      guard(() =>
        mapUnauthorized(async () => {
          const auth = await makeAuth()
          const value = await withUpstream(config.url, auth, opts.session, c =>
            c.callTool({ name, arguments: args }),
          )
          return toToolResult(value as {
            content?: unknown
            isError?: boolean
            structuredContent?: Record<string, unknown>
          })
        }),
      ),
  }
}
