/**
 * `~help`:根级(虚拟 directory)与节点级帮助,含工具级两级披露。
 *
 * 不可见(read 判不过)一律 404,不泄露存在性;remote 命中即透传。
 * 非注册路径先尝试工具级 `~help`(最长前缀命中 mcp/http 节点且剩余恰一段)。
 */
import {
  check,
  type HelpModel,
  negotiate,
  NodeRegistryStore,
  TBError,
  type TreeNode,
} from '@tool-bridge/core'
import type { AppContext } from '../deps'
import type { RouteEnv } from './env'
import { commandHelpModelFor, helpModelFor } from '../helpModel'
import { filterListVisible, splitReserved } from '../paths'
import { remotePassthroughIfMatch } from '../federation'
import { pruneExpiredContext } from '../contextNodes'
import { enrichHelp, renderHelp } from '../responses'
import { toolHelpModelFor } from '../toolNodes'

// --- ~help(根级与节点)---
export async function handleHelp(c: AppContext, env: RouteEnv): Promise<Response> {
  const { builtinsOf, deps } = env
  const path = splitReserved(new URL(c.req.url).pathname, '~help')
  if (path === null) throw TBError.notFound('no such path')
  const ctx = c.get('ctx')
  const store = c.get('store')
  const registry = new NodeRegistryStore(store)
  const rep = negotiate(c.req.header('accept'))

  if (path === '') {
    // 根:虚拟 directory,列出可见的顶层子节点。
    const children = filterListVisible(
      await pruneExpiredContext(await registry.children(''), registry),
      ctx.scopes,
    )
    const model: HelpModel = {
      node: { path: '', kind: 'directory', description: 'tool-bridge root' },
      cmds: [],
      children: children.map(n => ({ path: n.path, kind: n.kind, description: n.description })),
      hint: 'GET /<child-path>/~help describes a child node; GET /~tree?depth=N shows the subtree. Every path also serves ~feedback: GET /<path>/~feedback lists pitfalls other agents hit — check it before using a tool; POST /<path>/~feedback {"title","detail"} to share your own',
    }
    return renderHelp(await enrichHelp(model, '', store), rep)
  }

  // 不可见(read 判不过)→ 404 不泄露存在性(v1 教训:deny==not_found)。
  if (!check(ctx, path, 'read').allow) throw TBError.notFound('not found')

  // remote 透传:命中 remote 节点(或其后代)→ 改写 ~help 打到 baseUrl。
  const remote = await remotePassthroughIfMatch(c, ctx, registry, path, '~help', deps)
  if (remote) return remote

  const builtins = builtinsOf(store)
  const refresh = c.req.query('refresh') === '1'
  const schemas = c.req.query('schemas') === '1'

  let node: TreeNode
  try {
    node = await registry.get(path)
  } catch {
    // 非注册路径:命令级 ~help(两级披露)。命令是节点下的虚拟叶子:
    // - mcp/http/tool 上游工具:toolHelpModelFor 命中缓存工具表(不额外打上游);
    // - builtin/context/skillhub:resolve 到父节点,取其 HelpModel 里的单条 cmd。
    const toolModel = await toolHelpModelFor(c, ctx, registry, path, deps)
    if (toolModel !== null) return renderHelp(await enrichHelp(toolModel, path, store), rep)
    const cmdModel = await commandHelpModelFor(registry, ctx, builtins, deps, path, {
      refresh,
      schemas,
    })
    if (cmdModel !== null) return renderHelp(await enrichHelp(cmdModel, path, store), rep)
    throw TBError.notFound('not found')
  }
  const model = await helpModelFor(node, registry, ctx, builtins, deps, {
    refresh,
    schemas,
    now: new Date().toISOString(),
  })
  return renderHelp(await enrichHelp(model, path, store), rep)
}
