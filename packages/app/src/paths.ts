/**
 * 树路径与保留段的解析、注册路径判定,以及列表面的可见性裁剪。
 * 纯函数为主:输入是 URL pathname / 节点数组,输出是树路径或裁剪后的集合。
 */
import {
  type BuiltinModule,
  type CallContext,
  checkRegisterPath,
  checkScopes,
  type CmdSpec,
  derivePresence,
  NodeRegistryStore,
  TBError,
  type TreeEntry,
  type TreeNode,
  type TreePath,
} from '@tool-bridge/core'
import type { TbAppDeps } from './deps'

/** cmd → scope 表(builtin help() 静态声明);未知 cmd → undefined。 */
export function scopeForCmd(mod: BuiltinModule, nodePath: TreePath, cmd: string): CmdSpec | undefined {
  return mod.help(nodePath).cmds.find(c => c.name === cmd)
}
/**
 * 逐段 decodeURIComponent 树路径(注册的树路径可含空格等,URL 里被百分号编码)。
 * 逐段解码(而非整段)以免把编码的 '/'(%2F)误解为路径分隔。decode 失败 → 400 invalid_argument。
 */
export function decodePath(path: TreePath): TreePath {
  if (path === '') return ''
  try {
    return path
      .split('/')
      .map(seg => decodeURIComponent(seg))
      .join('/')
  } catch {
    throw new TBError('invalid_argument', `malformed percent-encoding in path '${path}'`)
  }
}

/** 根路径与保留段:从 URL pathname 提取树路径与保留段(如 "docs/x/~help" → { path:"docs/x", seg:"~help" })。 */
export function splitReserved(pathname: string, seg: string): TreePath | null {
  const p = pathname.replace(/^\/+|\/+$/g, '')
  if (p === seg) return '' // 根级 /~help、/~tree
  if (p.endsWith(`/${seg}`)) return decodePath(p.slice(0, -(seg.length + 1)))
  return null
}

/**
 * 解析 ~feedback 保留段 URL(feedback 是 per-path 一级协议能力):
 * `/<path>/~feedback` → { path };`/<path>/~feedback/<id>` → { path, id };其余形状 → null。
 */
export function splitFeedback(pathname: string): { id?: string, path: TreePath } | null {
  const p = pathname.replace(/^\/+|\/+$/g, '')
  const segs = p.split('/')
  const last = segs[segs.length - 1] ?? ''
  if (last === '~feedback') {
    return { path: decodePath(segs.slice(0, -1).join('/')) }
  }
  if (segs.length >= 2 && segs[segs.length - 2] === '~feedback' && !last.startsWith('~')) {
    return { path: decodePath(segs.slice(0, -2).join('/')), id: decodeURIComponent(last) }
  }
  return null
}
/** 反向注册路径判定(查 existing 占用者;deps.reservedRoots 追加保留根)。allow=false 则抛其 error。 */
export async function assertRegisterPath(
  registry: NodeRegistryStore,
  ctx: CallContext,
  targetPath: TreePath,
  action: 'write' | 'delete',
  deps: TbAppDeps,
): Promise<void> {
  let existing: { registeredBy: string } | null = null
  try {
    existing = await registry.get(targetPath)
  } catch {
    existing = null
  }
  const res = checkRegisterPath({
    sk: {
      scopes: ctx.scopes,
      id: ctx.keyId,
      ...(ctx.registerPaths !== undefined ? { registerPaths: ctx.registerPaths } : {}),
    },
    targetPath,
    action,
    existing,
    ...(deps.reservedRoots !== undefined ? { reservedRoots: deps.reservedRoots } : {}),
  })
  if (!res.allow) throw res.error
}

/**
 * TreeNode → TreeEntry(丢弃 config 等,仅保留 tree 视图字段)。
 * device 节点的 online 位在此投影为三态 presence:结合 lastSeenAt 与 now,把过期的 online
 * 降级为 stale(纯投影,不回写权威状态)。只有带 online 位的节点(device mount 根)才出 presence。
 */
export function toEntry(n: TreeNode, now: string): TreeEntry {
  const e: TreeEntry = { path: n.path, kind: n.kind, description: n.description }
  if (n.online !== undefined) {
    e.presence = derivePresence({
      online: n.online,
      ...(n.lastSeenAt !== undefined ? { lastSeenAt: n.lastSeenAt } : {}),
      now,
    })
  }
  return e
}

/**
 * 目录/~tree 展示裁剪。无 call 权限的 SK 对同一调用节点 `tb call` 为 403,
 * 且 `tb ls` 不可见;因此 mcp/http/remote 节点在列表面同时要求 read+call。
 * 直接访问节点本身仍由 handler 保持 read→404 / call→403 次序。
 */
export function filterListVisible(nodes: TreeNode[], scopes: CallContext['scopes']): TreeNode[] {
  return nodes.filter((node) => {
    if (!checkScopes(scopes, node.path, 'read')) return false
    if (
      (node.kind === 'mcp'
        || node.kind === 'http'
        || node.kind === 'remote'
        || node.kind === 'device'
        || node.kind === 'tool')
      && !checkScopes(scopes, node.path, 'call')
    ) {
      return false
    }
    return true
  })
}
/**
 * 按直接父路径索引子树节点(父 = 去掉最后一段;顶层节点父为 '')。
 * `~tree` 一次读入子树后在内存建此索引,getChildren 从中取直接子,避免每层递归各扫 KV。
 */
export function indexByParent(nodes: TreeNode[]): Map<TreePath, TreeNode[]> {
  const byParent = new Map<TreePath, TreeNode[]>()
  for (const n of nodes) {
    const segs = n.path.split('/')
    const parent = segs.slice(0, -1).join('/')
    const bucket = byParent.get(parent)
    if (bucket) bucket.push(n)
    else byParent.set(parent, [n])
  }
  return byParent
}
