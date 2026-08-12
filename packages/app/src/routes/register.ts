/**
 * `~register`(HTTP 反向注册,等价 NodeRegistry.Write)与 `~authorize`(mcp 托管 OAuth 发起)。
 *
 * 两者同权:都要求对目标节点持 register。注册链路的顺序是硬约束——权限判定在前,
 * 出站探测(s3 连通性)与落库在后;Secret Reference 绑定另需 system/secret admin
 * (confused-deputy 阻断项)。
 */
import {
  assertSecretRefUse,
  check,
  contentTypeFor,
  NodeRegistryStore,
  parseNodeInput,
  TBError,
  type TreeNode,
} from '@tool-bridge/core'
import type { AppContext } from '../deps'
import type { RouteEnv } from './env'
import { assertRemoteConfigAllowed, resolveRemoteSettings } from '../federation'
import { assertContextConfig, assertSkillhubConfig } from '../contextNodes'
import { assertToolConfig, refreshDynamicSearchNode } from '../toolNodes'
import { invalidateMcpOAuth, startMcpAuthorization } from '../oauth'
import { assertRegisterPath, splitReserved } from '../paths'
import { invalidateToolCache } from '../providers/toolCache'
import { invalidateMcpEra } from '../providers/mcp'

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
  // 挂载 remote 节点时校验 baseUrl 白名单(注册时即拒;env 基线 ∪ 运行时条目)。
  assertRemoteConfigAllowed(body.config, await resolveRemoteSettings(store, deps.remote))
  // register 判定 + 注册路径规则(含 existing 查询)。
  if (!check(ctx, path, 'register').allow) {
    throw new TBError('permission_denied', `no scope grants 'register' on '${path}'`)
  }
  await assertRegisterPath(registry, ctx, body.path, 'write', deps)
  // Secret Reference 使用授权:绑定 authRef/skRef 须持 system/secret admin(注册路径
  // 判定之后、落库之前)。受限注册者不得引用平台已有 Secret(confused-deputy 合入阻断项)。
  assertSecretRefUse(ctx.scopes, body.config)
  // context 配置校验 + s3 连通探测:探测出站网络,须在权限判定之后。
  await assertContextConfig(body.config, deps)
  // skillhub 配置校验(provider r2/s3;s3 连通探测)。
  await assertSkillhubConfig(body.config, deps)
  // kind:'tool' 挂载校验:provider 必须是已注册且启用的 tool-provider plugin。
  await assertToolConfig(body.config, store)
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
  // 注册变更 → 失效该节点工具缓存 + mcp 会话/OAuth 缓存。
  await invalidateToolCache(store, body.path)
  await invalidateMcpEra(store, body.path)
  await invalidateMcpOAuth(store, body.path)
  await searchSync?.reconcileNodeQuietly(body.path, { marker })
  if (await refreshDynamicSearchNode(node, ctx, deps)) await searchSync?.abort(marker)
  return new Response(JSON.stringify(node), {
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
  if (node.kind !== 'mcp' || node.config?.kind !== 'mcp' || node.config.auth !== 'oauth') {
    throw new TBError('invalid_argument', `'${path}' 不是 auth:'oauth' 的 mcp 挂载`)
  }
  // 可选 body {redirectUri}:CLI 本地回调通道(严格上游只放行 loopback 回调时)。
  const body = (await c.req.json().catch(() => null)) as { redirectUri?: unknown } | null
  const redirectUri
    = body !== null && typeof body.redirectUri === 'string' ? body.redirectUri : undefined
  const result = await startMcpAuthorization({
    store,
    encryptionKey: encKey,
    nodePath: path,
    serverUrl: node.config.url,
    origin: deps.canonicalOrigin ?? new URL(c.req.url).origin,
    ...(redirectUri !== undefined ? { redirectUri } : {}),
  })
  return new Response(JSON.stringify(result), {
    headers: { 'content-type': contentTypeFor('json') },
  })
}
