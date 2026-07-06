/**
 * `~tree` 深度受限树视图的构建(Proto §1.1、§1.3 TreeJson)。
 *
 * 纯逻辑:节点数据经注入的 `getChildren` 拉取(宿主对接 NodeRegistry + 可见性裁剪)。
 * 约束:默认 depth=2、上限 8;节点上限默认 500;深度到底 / 超节点上限 / 环 → `truncated:true`。
 */

import type { NodeKind, TreePath } from '../types'

/** `~tree` 深度默认值(Proto §1.1)。 */
export const DEFAULT_TREE_DEPTH = 2
/** `~tree` 深度上限(Proto §1.1)。 */
export const MAX_TREE_DEPTH = 8
/** 树节点总数上限(Proto §1.1);超限则该节点 `truncated`。 */
export const DEFAULT_MAX_NODES = 500

/**
 * 钳制 depth(Proto §1.1):默认 2、上限 8。
 * undefined / 非整数 / < 1 视为非法 → 默认 2;> 8 → 8。
 */
export function clampDepth(depth: number | undefined): number {
  if (depth === undefined || !Number.isInteger(depth) || depth < 1) return DEFAULT_TREE_DEPTH
  if (depth > MAX_TREE_DEPTH) return MAX_TREE_DEPTH
  return depth
}

/** `getChildren` 返回的子节点条目。 */
export interface TreeEntry {
  path: TreePath
  kind: NodeKind
  description: string
  /** 仅 device:连接状态。 */
  online?: boolean
}

/** `~tree` 响应形状(Proto §1.3,规范性);递归。 */
export interface TreeJson {
  path: TreePath
  kind: NodeKind
  description: string
  online?: boolean
  /** 深度上限 / 节点上限 / 环检测截断。 */
  truncated?: boolean
  children?: TreeJson[]
}

export interface BuildTreeOpts {
  root: TreePath
  /** 已钳制的深度(调用方先过 clampDepth)。 */
  depth: number
  /** 节点上限,缺省 500。 */
  maxNodes?: number
  /** 拉取某路径的直接子节点(宿主已做可见性裁剪)。 */
  getChildren: (path: TreePath) => Promise<TreeEntry[]>
  /**
   * 根节点自身的元数据(kind/description/online)。提供则用它——网关传真实节点,
   * 避免子树根被伪造为 `directory`;缺省回退 `kind:'directory', description:''`。
   */
  rootEntry?: TreeEntry
}

/**
 * 构建受限深度树(Proto §1.1)。
 *
 * 语义:根为 depthLeft=depth;每下一层 depthLeft-1;depthLeft<=0 时不再展开,
 * 若该节点确有子节点则标 `truncated`。节点计数达 `maxNodes` → 停止展开并标父节点
 * `truncated`。环检测用 visited Set:子节点路径已在集合中 → 作为 `truncated` 叶子收入、不递归
 * (本地树理论无环,此为防 provider 异常,见 Proto §1.1)。
 *
 * 根节点自身元数据:优先用 `opts.rootEntry`(网关传真实节点的 kind/description/online);
 * 缺省回退 `kind:'directory'`、`description:''`。
 */
export async function buildTree(opts: BuildTreeOpts): Promise<TreeJson> {
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES
  const visited = new Set<TreePath>()
  let count = 0

  async function build(entry: TreeEntry, depthLeft: number): Promise<TreeJson> {
    visited.add(entry.path)
    count++
    const node: TreeJson = { path: entry.path, kind: entry.kind, description: entry.description }
    if (entry.online !== undefined) node.online = entry.online

    if (depthLeft <= 0) {
      // 达深度上限:不展开,仅探测是否存在子节点以决定 truncated
      const kids = await opts.getChildren(entry.path)
      if (kids.length > 0) node.truncated = true
      return node
    }

    const kids = await opts.getChildren(entry.path)
    const children: TreeJson[] = []
    for (const kid of kids) {
      if (count >= maxNodes) {
        // 节点上限:停止展开更多子节点
        node.truncated = true
        break
      }
      if (visited.has(kid.path)) {
        // 环检测:已访问路径 → 截断叶子,不递归
        const cyc: TreeJson = {
          path: kid.path,
          kind: kid.kind,
          description: kid.description,
          truncated: true,
        }
        if (kid.online !== undefined) cyc.online = kid.online
        count++
        children.push(cyc)
        continue
      }
      children.push(await build(kid, depthLeft - 1))
    }
    if (children.length > 0) node.children = children
    return node
  }

  const rootEntry: TreeEntry = opts.rootEntry ?? {
    path: opts.root,
    kind: 'directory',
    description: '',
  }
  return build(rootEntry, opts.depth)
}
