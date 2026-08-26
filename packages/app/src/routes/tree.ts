/**
 * `~tree`:根级与子树的可见节点树投影。
 *
 * 一次读入整棵子树后在内存建 parent→子 索引再裁剪(而非逐层递归各扫一遍);
 * 子树根必须真实存在,否则 `~tree` 可伪造任意根。remote 节点在深度边界不做远端探测,
 * 直接标 truncated——聚合树因此不会因联邦深度产生 N 次边界往返。
 */
import {
  buildTree,
  check,
  clampDepth,
  contentTypeFor,
  negotiate,
  NodeRegistryStore,
  TBError,
  type TreeEntry,
  type TreeJson,
  type TreeNode,
  type TreePath,
} from '@tool-bridge/core'
import { treeJsonSchema } from '@tool-bridge/core/protocol'
import type { AppContext } from '../deps'
import type { RouteEnv } from './env'
import {
  remotePassthroughIfMatch,
  remotePathProjectorIfMatch,
  remoteProtocolError,
  remoteTreeChildren,
} from '../federation'
import { filterListVisible, indexByParent, splitReserved, toEntry } from '../paths'
import { assertContextAlive, pruneExpiredContext } from '../contextNodes'
import { renderTreeDsl } from '../responses'

/** buildTree 的深度边界免探测 kind:remote 子树由远端自述,本地不代为展开。 */
const REMOTE_OPAQUE_KINDS = new Set(['remote'])

function renderTree(tree: TreeJson, rep: ReturnType<typeof negotiate>): Response {
  if (rep === 'json') {
    return new Response(JSON.stringify(treeJsonSchema.parse(tree)), {
      headers: { 'content-type': contentTypeFor('json') },
    })
  }
  if (rep === 'dsl') {
    return new Response(renderTreeDsl(tree), {
      headers: { 'content-type': contentTypeFor('dsl') },
    })
  }
  return new Response(`\`\`\`text\n${renderTreeDsl(tree)}\`\`\`\n`, {
    headers: { 'content-type': contentTypeFor('markdown') },
  })
}

// --- ~tree(根级与子树)---
export async function handleTree(c: AppContext, env: RouteEnv): Promise<Response> {
  const { deps } = env
  const path = splitReserved(new URL(c.req.url).pathname, '~tree')
  if (path === null) throw TBError.notFound('no such path')
  const ctx = c.get('ctx')
  const store = c.get('store')
  const rep = negotiate(c.req.header('accept'))
  // 根路径('')免 read 判定(整棵树入口);非根节点需 (path,'read')。
  if (path !== '' && !check(ctx, path, 'read').allow) throw TBError.notFound('not found')
  const registry = new NodeRegistryStore(store)
  const now = new Date().toISOString()

  // remote 成功响应固定取 JSON，逐层校验、rebase 并按本地调用者 scope 重新裁剪；
  // 错误响应仍原样透传。query（如 depth）由 transport 保留。
  if (path !== '') {
    const projector = await remotePathProjectorIfMatch(registry, path)
    if (projector !== null) {
      const headers = new Headers(c.req.raw.headers)
      headers.set('accept', 'application/json')
      const remote = await remotePassthroughIfMatch(c, ctx, registry, path, '~tree', deps, headers)
      if (remote === null) throw remoteProtocolError('remote ~tree lost its mount owner')
      if (!remote.ok) return remote
      const parsed = treeJsonSchema.safeParse(await remote.json().catch(() => null))
      if (!parsed.success) throw remoteProtocolError('remote ~tree returned invalid JSON')
      return renderTree(projector.projectTree(parsed.data, path, ctx), rep)
    }
  }

  // 子树根必须真实存在(否则 ~tree 可伪造任意根)。非根 path 不存在 → 404;
  // 存在则以真实节点元数据作 rootEntry(kind/description/online),不再伪造为 directory。
  let rootEntry: TreeEntry | undefined
  if (path !== '') {
    let rootNode: TreeNode
    try {
      rootNode = await registry.get(path)
    } catch {
      throw TBError.notFound('not found')
    }
    // 子树根本身是 ttl 到期的 context 节点 → 懒回收 + 404。
    if (rootNode.kind === 'context' && rootNode.config?.kind === 'context') {
      await assertContextAlive(rootNode, rootNode.config, registry)
    }
    rootEntry = toEntry(rootNode, now)
  }

  // 一次性读入整棵子树(而非每层递归各扫一遍),内存建 parent→直接子 索引 + 可见性裁剪。
  const nodes = await pruneExpiredContext(await registry.subtree(path), registry)
  const byParent = indexByParent(nodes)
  const getChildren = async (p: TreePath): Promise<TreeEntry[]> => {
    const localKids = filterListVisible(byParent.get(p) ?? [], ctx.scopes)
    const remoteKids = await remoteTreeChildren(c, ctx, registry, p, deps)
    return [...localKids.map(n => toEntry(n, now)), ...remoteKids]
  }

  const depth = clampDepth(Number(c.req.query('depth')))
  const tree = await buildTree({
    root: path,
    depth,
    getChildren,
    // remote 节点在深度边界免 fetch 探测,直接标 truncated(消除聚合树里对 remote 的边界远端往返)。
    opaqueKinds: REMOTE_OPAQUE_KINDS,
    ...(rootEntry !== undefined ? { rootEntry } : {}),
  })
  return renderTree(tree, rep)
}
