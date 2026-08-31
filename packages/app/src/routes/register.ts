/**
 * `~register`(HTTP 反向注册,等价 NodeRegistry.Write)与 `~authorize`(mcp 托管 OAuth 发起)。
 *
 * 两者同权:都要求对目标节点持 register。注册链路的顺序是硬约束——权限判定在前,
 * 出站探测(s3 连通性)与落库在后;Secret Reference 绑定另需 system/secret admin
 * (confused-deputy 阻断项)。
 */
import {
  check,
  contentTypeFor,
  NodeRegistryStore,
  parseNodeInput,
  TBError,
  type TreeNode,
} from '@tool-bridge/core'
import {
  oauthAuthorizeRequestSchema,
  oauthAuthorizeResponseSchema,
  registryNodeSchema,
} from '@tool-bridge/core/protocol'
import type { AppContext } from '../deps'
import type { RouteEnv } from './env'
import { assertNodeConfigMutation, invalidateNodeDerivedState } from '../registryMutation'
import { refreshDynamicSearchNode, requirePluginExport } from '../toolNodes'
import { startProviderAuthorization } from '../providerOAuth'
import { startMcpAuthorization } from '../oauth'
import { splitReserved } from '../paths'

/**
 * provider 型 OAuth 的发起段(kind:'tool' 且 export 声明了 `oauth`)。
 *
 * 与 mcp 那条的差别都在"配置从哪来":端点取自 plugin 的 `~describe`,client 凭证取自挂载
 * `authRef` 指向的 secret(固定 clientId/clientSecret 两字段)。
 */
async function authorizeToolNode(
  c: AppContext,
  env: RouteEnv,
  node: TreeNode,
  encryptionKey: string,
): Promise<Response> {
  const { deps } = env
  const config = node.config as { authRef?: string, export?: string, provider: string }
  const { export: exported } = await requirePluginExport(
    deps,
    config.provider,
    'tool',
    'tool',
    config.export,
  )
  if (exported.oauth === undefined) {
    throw new TBError(
      'invalid_argument',
      `plugin '${config.provider}' 的 export '${exported.id}' 未声明 oauth,无需授权`,
    )
  }
  if (config.authRef === undefined) {
    throw new TBError(
      'invalid_argument',
      'OAuth 挂载须配 config.authRef 指向存有 clientId/clientSecret 的 secret',
    )
  }
  const result = await startProviderAuthorization({
    authRef: config.authRef,
    config: exported.oauth,
    encryptionKey,
    fetcher: deps.providerOAuthFetch,
    nodePath: node.path,
    now: new Date(),
    origin: deps.canonicalOrigin ?? new URL(c.req.url).origin,
    secrets: deps.secrets,
    store: deps.state,
  })
  return new Response(JSON.stringify(oauthAuthorizeResponseSchema.parse(result)), {
    headers: { 'content-type': contentTypeFor('json') },
  })
}

// --- POST ~register(HTTP 反向注册入口,等价 NodeRegistry.Write)---
export async function handleRegister(c: AppContext, env: RouteEnv): Promise<Response> {
  const { deps, searchSync } = env
  const path = splitReserved(new URL(c.req.url).pathname, '~register')
  if (path === null || path === '') throw TBError.notFound('no such path')
  const ctx = c.get('ctx')
  const store = c.get('store')
  const registry = new NodeRegistryStore(store)
  const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object') {
    throw new TBError('invalid_argument', 'body must be a NodeInput object')
  }
  // body.path 必须等于 URL path;先于 NodeInput 结构校验(路径一致是通道契约)。
  if (raw.path !== path) {
    throw new TBError(
      'invalid_argument',
      `body.path '${String(raw.path)}' must equal URL path '${path}'`,
    )
  }
  // 复用与 system/registry write 相同的 NodeInput 校验(kind/description 必填、kind 枚举合法)。
  const body = parseNodeInput(raw)
  // 通道 scope 判定在先(register);其后与 system/registry write 共享同一条安全链
  // (remote 白名单 → 注册路径 → SecretRef → 各 kind 校验),单点实现见 registryMutation.ts。
  if (!check(ctx, path, 'register').allow) {
    throw new TBError('permission_denied', `no scope grants 'register' on '${path}'`)
  }
  await assertNodeConfigMutation({
    action: 'write',
    config: body.config,
    ctx,
    deps,
    registry,
    targetPath: body.path,
  })
  await searchSync?.ensureSeeded()
  const now = new Date().toISOString()
  const marker = await searchSync?.markNode(body.path)
  let node: TreeNode
  try {
    node = await registry.write(body, ctx.keyId, now)
  } catch (error) {
    await searchSync?.abort(marker)
    throw error
  }
  // 注册变更 → 失效该节点工具缓存 + mcp 会话/两套 OAuth 令牌。
  await invalidateNodeDerivedState(store, body.path)
  await searchSync?.reconcileNodeQuietly(body.path, { marker })
  if (await refreshDynamicSearchNode(node, ctx, deps, searchSync)) await searchSync?.abort(marker)
  return new Response(JSON.stringify(registryNodeSchema.parse(node)), {
    headers: { 'content-type': contentTypeFor('json') },
  })
}

// --- POST ~authorize(mcp 托管 OAuth 发起;需对节点有 register 权限——与挂载同权)---
export async function handleAuthorize(c: AppContext, env: RouteEnv): Promise<Response> {
  const { deps } = env
  const path = splitReserved(new URL(c.req.url).pathname, '~authorize')
  if (path === null || path === '') throw TBError.notFound('no such path')
  const ctx = c.get('ctx')
  const store = c.get('store')
  if (!check(ctx, path, 'read').allow) throw TBError.notFound('not found')
  if (!check(ctx, path, 'register').allow) {
    throw new TBError('permission_denied', `no scope grants 'register' on '${path}'`)
  }
  const encKey = deps.encryptionKey
  if (encKey === undefined) {
    throw new TBError('unavailable', 'OAuth 托管需要 TB_SECRET_ENCRYPTION_KEY', {
      retryable: false,
    })
  }
  const registry = new NodeRegistryStore(store)
  let node: TreeNode
  try {
    node = await registry.get(path)
  } catch {
    throw TBError.notFound('not found')
  }
  const rawBody = await c.req.json().catch(() => ({}))
  const body = oauthAuthorizeRequestSchema.safeParse(rawBody)
  if (!body.success) {
    throw new TBError('invalid_argument', 'body only accepts optional redirectUri string')
  }
  // kind:'tool' 且 export 声明了 oauth → provider 型托管流程(与 mcp 那条是两套机制,
  // 见 providerOAuth.ts 头注)。
  if (node.kind === 'tool' && node.config?.kind === 'tool') {
    return await authorizeToolNode(c, env, node, encKey)
  }
  if (node.kind !== 'mcp' || node.config?.kind !== 'mcp' || node.config.auth !== 'oauth') {
    throw new TBError(
      'invalid_argument',
      `'${path}' 既不是 auth:'oauth' 的 mcp 挂载,也不是声明了 oauth 的 tool 挂载`,
    )
  }
  // 可选 body {redirectUri}:CLI 本地回调通道(严格上游只放行 loopback 回调时)。
  const redirectUri = body.data.redirectUri
  const result = await startMcpAuthorization({
    store,
    encryptionKey: encKey,
    nodePath: path,
    serverUrl: node.config.url,
    secrets: deps.secrets,
    origin: deps.canonicalOrigin ?? new URL(c.req.url).origin,
    ...(node.config.oauthClient !== undefined ? { oauthClient: node.config.oauthClient } : {}),
    ...(redirectUri !== undefined ? { redirectUri } : {}),
  })
  return new Response(JSON.stringify(oauthAuthorizeResponseSchema.parse(result)), {
    headers: { 'content-type': contentTypeFor('json') },
  })
}
