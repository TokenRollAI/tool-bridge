/**
 * `~skill`(占位/透传)与 `~describe`(可选能力自述)。
 *
 * `~describe` 只对"有可选能力"的节点有意义:根回全局搜索能力,context/skillhub 回
 * provider 自报能力,其余 kind 一律 404。
 */
import {
  check,
  contentTypeFor,
  CONTEXT_CAPABILITIES,
  NodeRegistryStore,
  SKILLHUB_CAPABILITIES,
  TBError,
  type TreeNode,
} from '@tool-bridge/core'
import type { AppContext } from '../deps'
import type { RouteEnv } from './env'
import { assertContextAlive, localCapabilities, localContext } from '../contextNodes'
import { remotePassthroughIfMatch } from '../federation'
import { requirePluginExport } from '../toolNodes'
import { deviceMarkerOf } from '../deviceNodes'
import { tbErrorResponse } from '../responses'
import { splitReserved } from '../paths'

// --- ~skill:remote 透传;本地占位 501 ---
export async function handleSkill(c: AppContext, env: RouteEnv): Promise<Response> {
  const { deps } = env
  const path = splitReserved(new URL(c.req.url).pathname, '~skill')
  if (path === null) throw TBError.notFound('no such path')
  const ctx = c.get('ctx')
  const store = c.get('store')
  const registry = new NodeRegistryStore(store)
  if (path !== '') {
    const remote = await remotePassthroughIfMatch(c, ctx, registry, path, '~skill', deps)
    if (remote) return remote
  }
  return tbErrorResponse(TBError.unimplemented('~skill not implemented yet'))
}

// --- ~describe:有可选能力的节点返回 { kind, capabilities };其余 404 ---
export async function handleDescribe(c: AppContext, env: RouteEnv): Promise<Response> {
  const { deps, globalSearchCapabilities } = env
  const path = splitReserved(new URL(c.req.url).pathname, '~describe')
  if (path === null) throw TBError.notFound('no such path')
  if (path === '') {
    const capabilities = globalSearchCapabilities()
    if (capabilities.length === 0) throw TBError.notFound('no such path')
    return new Response(JSON.stringify({ kind: 'directory', capabilities }), {
      headers: { 'content-type': contentTypeFor('json') },
    })
  }
  const ctx = c.get('ctx')
  const store = c.get('store')
  const registry = new NodeRegistryStore(store)
  // 不可见(read 判不过)→ 404 不泄露存在性。
  if (!check(ctx, path, 'read').allow) throw TBError.notFound('not found')
  let node: TreeNode
  try {
    node = await registry.get(path)
  } catch {
    throw TBError.notFound('not found')
  }
  if (node.kind === 'context' && node.config?.kind === 'context') {
    await assertContextAlive(node, node.config, registry)
    // plugin-backed 节点回注册时抓取缓存的 capabilities(Q12);内置 provider 与
    // device 自定义 context 节点(带转发标记)回固定表;
    // SDK 进程内 Provider 按可选方法实现存在性推导。
    const cfg = node.config
    const local = cfg.provider !== 'r2' && cfg.provider !== 's3' ? localContext(deps, node) : null
    const capabilities
      = cfg.provider === 'r2'
        || cfg.provider === 's3'
        || cfg.provider === 'device-fs'
        || deviceMarkerOf(cfg.providerConfig) !== null
        ? CONTEXT_CAPABILITIES
        : local !== null
          ? localCapabilities(local)
          : (
              await requirePluginExport(store, cfg.provider, 'context', 'context', cfg.export)
            ).export.capabilities ?? []
    return new Response(JSON.stringify({ kind: 'context', capabilities }), {
      headers: { 'content-type': contentTypeFor('json') },
    })
  }
  if (node.kind === 'skillhub' && node.config?.kind === 'skillhub') {
    await assertContextAlive(node, node.config, registry)
    return new Response(
      JSON.stringify({ kind: 'skillhub', capabilities: SKILLHUB_CAPABILITIES }),
      { headers: { 'content-type': contentTypeFor('json') } },
    )
  }
  // 无可选能力的节点(其他 kind)→ 404。
  throw TBError.notFound(`no capabilities for kind '${node.kind}'`)
}
