/**
 * NodeRegistry 纯逻辑实现(Proto §3.3)。
 *
 * 以注入的 {@link StateStore} 为后端(key = `node:<path>`)。core 不做 I/O 策略,
 * 存储批量成本(全量 scan)由宿主实现承担;判定/物化/回收全在本层完成。
 *
 * 权限判定(register / read + §2.4 路径规则)不在此——那是网关中间件的事;
 * 本类只负责数据结构语义:幂等 upsert、中间 directory 自动物化与级联回收、
 * 最长前缀 resolve、按段前缀 list。
 */

import { TBError } from '../errors'
import { KEY_NODE, type StateStore } from '../store'
import {
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  type ListOptions,
  type NodeInput,
  type Page,
  SYSTEM_AUTO,
  type Timestamp,
  type TreeNode,
  type TreePath,
} from '../types'
import { isPrefixOf, normalizePath, parentPaths, segments, validatePath } from './path'

/** limit 钳制:缺省 50、上限 200 静默钳制、非正数回落默认(Proto §0.3)。 */
function clampLimit(limit?: number): number {
  if (limit === undefined || limit < 1) return LIST_LIMIT_DEFAULT
  return limit > LIST_LIMIT_MAX ? LIST_LIMIT_MAX : limit
}

/** config 存在时,其 kind 必须与节点 kind 一致(Proto §3.2)。 */
function assertKindConfig(node: Pick<NodeInput, 'kind' | 'config'>): void {
  if (node.config === undefined) return
  if (node.config.kind !== node.kind) {
    throw new TBError(
      'invalid_argument',
      `kind='${node.kind}' 与 config.kind='${node.config.kind}' 不一致(Proto §3.2)`,
    )
  }
}

function byPath(a: TreeNode, b: TreeNode): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
}

export class NodeRegistryStore {
  constructor(private readonly store: StateStore) {}

  private keyOf(path: string): string {
    return KEY_NODE + path
  }

  private async read(path: string): Promise<TreeNode | null> {
    return (await this.store.get(this.keyOf(path))) as TreeNode | null
  }

  /** 翻页取尽 node:* 全量。 */
  private async scanAll(): Promise<TreeNode[]> {
    const out: TreeNode[] = []
    let cursor: string | undefined
    do {
      const page = await this.store.list(KEY_NODE, { cursor, limit: LIST_LIMIT_MAX })
      for (const { value } of page.items) out.push(value as TreeNode)
      cursor = page.cursor
    } while (cursor)
    return out
  }

  private async hasChildren(path: string): Promise<boolean> {
    const norm = normalizePath(path)
    return (await this.scanAll()).some((n) => n.path !== norm && isPrefixOf(norm, n.path))
  }

  /** 取单个;不存在 → not_found(Proto §0.4)。 */
  async get(path: TreePath): Promise<TreeNode> {
    const norm = normalizePath(path)
    const node = await this.read(norm)
    if (!node) throw new TBError('not_found', `节点不存在:'${norm}'`)
    return node
  }

  /**
   * 枚举 `prefix` 之下(含 prefix 自身,按段前缀匹配)的节点,分页。
   * 无 prefix = 全树。cursor 为上一页末节点的 path。
   */
  async list(prefix?: TreePath, opts?: ListOptions): Promise<Page<TreeNode>> {
    const normPrefix = prefix === undefined ? '' : normalizePath(prefix)
    const limit = clampLimit(opts?.limit)
    const all = (await this.scanAll()).filter((n) => isPrefixOf(normPrefix, n.path)).sort(byPath)
    const cursor = opts?.cursor
    const start = cursor ? all.findIndex((n) => n.path === cursor) + 1 : 0
    const items = all.slice(start, start + limit)
    const hasMore = start + limit < all.length
    return {
      items,
      cursor: hasMore ? items[items.length - 1]?.path : undefined,
    }
  }

  /** 直接子节点(段深恰好 +1);~help 列子节点用。 */
  async children(path: TreePath): Promise<TreeNode[]> {
    const norm = normalizePath(path)
    const depth = segments(norm).length
    return (await this.scanAll())
      .filter(
        (n) => n.path !== norm && isPrefixOf(norm, n.path) && segments(n.path).length === depth + 1,
      )
      .sort(byPath)
  }

  /**
   * 幂等 upsert(Proto §0.4 / §3.3):
   * - 校验路径(空/空段/保留段)与 kind↔config 一致性;
   * - 自动物化 parentPaths 中缺失的中间 directory(registeredBy=system:auto,description='');
   *   已存在的祖先(无论显式或自动)一律不动;
   * - createdAt 保留原值(存在时)否则取 now;updatedAt 始终刷新为 now;
   * - registeredBy 由调用方注入(device 节点由 Gateway 代写)。
   *
   * §2.4d 的 conflict(覆盖他人节点)判定在网关注册路径层,不在此——本层是幂等 upsert。
   */
  async write(node: NodeInput, registeredBy: string, now: Timestamp): Promise<TreeNode> {
    const path = normalizePath(node.path)
    const invalid = validatePath(path)
    if (invalid) throw invalid
    assertKindConfig(node)

    for (const parent of parentPaths(path)) {
      if (!(await this.read(parent))) {
        const dir: TreeNode = {
          path: parent,
          kind: 'directory',
          description: '',
          registeredBy: SYSTEM_AUTO,
          createdAt: now,
          updatedAt: now,
        }
        await this.store.put(this.keyOf(parent), dir)
      }
    }

    const existing = await this.read(path)
    const full: TreeNode = {
      path,
      kind: node.kind,
      description: node.description,
      ...(node.config !== undefined ? { config: node.config } : {}),
      ...(node.virtualize !== undefined ? { virtualize: node.virtualize } : {}),
      registeredBy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await this.store.put(this.keyOf(path), full)
    return full
  }

  /** 部分更新(patch);不存在 → not_found;path 不可改(Proto §0.4)。 */
  async update(path: TreePath, patch: Partial<NodeInput>, now: Timestamp): Promise<TreeNode> {
    const norm = normalizePath(path)
    const existing = await this.read(norm)
    if (!existing) throw new TBError('not_found', `节点不存在:'${norm}'`)
    if (patch.path !== undefined && normalizePath(patch.path) !== norm) {
      throw new TBError('invalid_argument', 'path 不可通过 Update 变更(Proto §0.4)')
    }
    const merged: TreeNode = {
      ...existing,
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.config !== undefined ? { config: patch.config } : {}),
      ...(patch.virtualize !== undefined ? { virtualize: patch.virtualize } : {}),
      path: norm,
      updatedAt: now,
    }
    assertKindConfig(merged)
    await this.store.put(this.keyOf(norm), merged)
    return merged
  }

  /**
   * 卸载(Proto §3.3);不存在 → not_found。删除后自底向上级联回收:
   * 仅回收 registeredBy=system:auto 且再无子节点的 directory,遇显式节点/仍有子节点即停。
   *
   * 实现决策(Proto 未明写,待回写 docs):被删节点若仍有后代 → conflict
   * (不允许删除非空子树;显式 directory 同理)。
   */
  async delete(path: TreePath): Promise<void> {
    const norm = normalizePath(path)
    const existing = await this.read(norm)
    if (!existing) throw new TBError('not_found', `节点不存在:'${norm}'`)
    if (await this.hasChildren(norm)) {
      throw new TBError('conflict', `节点 '${norm}' 仍有子节点,不允许删除非空子树`)
    }
    await this.store.delete(this.keyOf(norm))
    for (const parent of [...parentPaths(norm)].reverse()) {
      const p = await this.read(parent)
      if (!p || p.registeredBy !== SYSTEM_AUTO || p.kind !== 'directory') break
      if (await this.hasChildren(parent)) break
      await this.store.delete(this.keyOf(parent))
    }
  }

  /**
   * 最长前缀匹配(Proto §3.3):返回命中节点与剩余段('/' 连接)。
   * 完全匹配 → rest=''。无任何匹配 → not_found。
   */
  async resolve(path: TreePath): Promise<{ node: TreeNode; rest: string }> {
    const norm = normalizePath(path)
    const candidates = [norm, ...parentPaths(norm).reverse()]
    for (const cand of candidates) {
      const node = await this.read(cand)
      if (node) {
        const rest = segments(norm).slice(segments(cand).length).join('/')
        return { node, rest }
      }
    }
    throw new TBError('not_found', `无匹配节点:'${norm}'`)
  }
}
