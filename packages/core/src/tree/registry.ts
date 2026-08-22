/**
 * NodeRegistry 纯逻辑实现。
 *
 * 以注入的 {@link StateStore} 为后端(key = `node:<path>`)。core 不做 I/O 策略,
 * 存储批量成本(全量 scan)由宿主实现承担;判定/物化/回收全在本层完成。
 *
 * 权限判定(register / read + 反向注册路径规则)不在此——那是网关中间件的事;
 * 本类只负责数据结构语义:幂等 upsert、中间 directory 自动物化与级联回收、
 * 最长前缀 resolve、按段前缀 list。
 */

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
import { canonicalizePath, isPrefixOf, normalizePath, parentPaths, segments, validatePath } from './path'
import { KEY_NODE, type StateStore } from '../store'
import { TBError } from '../errors'

/** limit 钳制:缺省 50、上限 200 静默钳制、非正数回落默认。 */
function clampLimit(limit?: number): number {
  if (limit === undefined || limit < 1) return LIST_LIMIT_DEFAULT
  return limit > LIST_LIMIT_MAX ? LIST_LIMIT_MAX : limit
}

/** config 存在时,其 kind 必须与节点 kind 一致。 */
function assertKindConfig(node: Pick<NodeInput, 'kind' | 'config'>): void {
  if (node.config === undefined) return
  if (node.config.kind !== node.kind) {
    throw new TBError(
      'invalid_argument',
      `kind='${node.kind}' 与 config.kind='${node.config.kind}' 不一致`,
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
    return this.scanPrefix(KEY_NODE)
  }

  /**
   * 翻页扫描给定 KV 键前缀下的所有 TreeNode。
   *
   * 只扫子树(前缀限定),不再对全树做内存过滤——避免 children/hasChildren/subtree 的
   * O(N²)(每层各扫全树)。`opts.limit` 传给底层 `store.list` 以小步取(hasChildren 短路用)。
   *
   * **Workers 查询预算约束**:D1StateStore.list 是单条 SQL 直接带值返回(ADR-001 迁 D1 后
   * 不再逐键 get),每页只花一次 D1 查询;但 Workers 单请求仍有查询/子请求预算,深翻页的
   * 页数应远小于预算——当前树规模小(节点数十级)可接受。
   */
  private async scanPrefix(
    keyPrefix: string,
    opts?: { limit?: number, maxNodes?: number, truncate?: boolean },
  ): Promise<TreeNode[]> {
    const out: TreeNode[] = []
    let cursor: string | undefined
    do {
      const limit = opts?.maxNodes === undefined
        ? opts?.limit ?? LIST_LIMIT_MAX
        : Math.min(
            opts.limit ?? LIST_LIMIT_MAX,
            opts.maxNodes - out.length + (opts.truncate === true ? 0 : 1),
          )
      if (limit < 1) return out
      const page = await this.store.list(keyPrefix, {
        limit,
        ...(cursor !== undefined ? { cursor } : {}),
      })
      for (const { value } of page.items) out.push(value as TreeNode)
      if (opts?.truncate === true && out.length >= (opts.maxNodes ?? Number.POSITIVE_INFINITY)) {
        return out
      }
      if (opts?.maxNodes !== undefined && out.length > opts.maxNodes) {
        throw new TBError(
          'rate_limited',
          `registry scan 最多读取 ${opts.maxNodes} 个节点`,
        )
      }
      cursor = page.cursor
    } while (cursor)
    return out
  }

  /** KV 前缀:某路径的子树(含中间 directory)= `node:<path>/`;根('')= `node:`。 */
  private subtreePrefix(norm: string): string {
    return norm === '' ? KEY_NODE : `${KEY_NODE}${norm}/`
  }

  private async hasChildren(path: string): Promise<boolean> {
    const norm = normalizePath(path)
    // 只扫子树前缀,小步取(limit=1);拿到任一后代即短路(存在直接/间接子都算有子)。
    const page = await this.store.list(this.subtreePrefix(norm), { limit: 1 })
    return page.items.length > 0
  }

  /** 取单个;不存在 → not_found。路径大小写不敏感(规范化为小写后查)。 */
  async get(path: TreePath): Promise<TreeNode> {
    const norm = canonicalizePath(path)
    const node = await this.read(norm)
    if (!node) throw new TBError('not_found', `节点不存在:'${norm}'`)
    return node
  }

  /** 批量取节点；路径先规范化(小写)去重，不存在的节点不进入返回 Map。 */
  async getMany(paths: readonly TreePath[]): Promise<Map<TreePath, TreeNode>> {
    const canonical = [...new Set(paths.map(path => canonicalizePath(path)))]
    const values = await this.store.getMany(canonical.map(path => this.keyOf(path)))
    const out = new Map<TreePath, TreeNode>()
    for (const path of canonical) {
      const value = values.get(this.keyOf(path))
      if (value !== undefined) out.set(path, value as TreeNode)
    }
    return out
  }

  /**
   * 枚举 `prefix` 之下(含 prefix 自身,按段前缀匹配)的节点,分页。
   * 无 prefix = 全树。cursor 为上一页末节点的 path。
   */
  async list(prefix?: TreePath, opts?: ListOptions): Promise<Page<TreeNode>> {
    const normPrefix = prefix === undefined ? '' : canonicalizePath(prefix)
    const limit = clampLimit(opts?.limit)
    const all = (await this.scanAll()).filter(n => isPrefixOf(normPrefix, n.path)).sort(byPath)
    const cursor = opts?.cursor
    const start = cursor ? all.findIndex(n => n.path === cursor) + 1 : 0
    const items = all.slice(start, start + limit)
    const hasMore = start + limit < all.length
    return {
      items,
      cursor: hasMore ? items[items.length - 1]?.path : undefined,
    }
  }

  /** 直接子节点(段深恰好 +1);~help 列子节点用。只扫子树前缀,不扫全树。 */
  async children(path: TreePath): Promise<TreeNode[]> {
    const norm = canonicalizePath(path)
    const depth = segments(norm).length
    const sub = await this.scanPrefix(this.subtreePrefix(norm))
    return sub.filter(n => segments(n.path).length === depth + 1).sort(byPath)
  }

  /**
   * 一次性取整棵子树的节点数组(含 `path` 自身 + 全部后代),按 path 排序。
   * 供 `~tree` 建树一次读入内存(而非每层递归各扫一遍)。根('')= 全树。
   * 不存在的根返回空数组(调用方自行判 not_found)。
   */
  async subtree(path: TreePath, opts?: { maxNodes?: number }): Promise<TreeNode[]> {
    const norm = canonicalizePath(path)
    if (
      opts?.maxNodes !== undefined
      && (!Number.isInteger(opts.maxNodes) || opts.maxNodes < 1)
    ) {
      throw new TBError('invalid_argument', 'maxNodes 必须是正整数')
    }
    const descendants = await this.scanPrefix(this.subtreePrefix(norm), opts)
    if (norm === '') return descendants.sort(byPath)
    const self = await this.read(norm)
    const all = self ? [self, ...descendants] : descendants
    if (opts?.maxNodes !== undefined && all.length > opts.maxNodes) {
      throw new TBError(
        'rate_limited',
        `registry scan 最多读取 ${opts.maxNodes} 个节点`,
      )
    }
    return all.sort(byPath)
  }

  /**
   * 取按 key 确定排序的有界根快照，并显式报告是否截断。派生索引用 truncated
   * 选择保留 last-known-good，不把 canonical registry 的规模限制反向施加到主数据面。
   */
  async rootSnapshot(maxNodes: number): Promise<{ items: TreeNode[], truncated: boolean }> {
    if (!Number.isInteger(maxNodes) || maxNodes < 1) {
      throw new TBError('invalid_argument', 'maxNodes 必须是正整数')
    }
    const items = await this.scanPrefix(KEY_NODE, { maxNodes: maxNodes + 1, truncate: true })
    return {
      items: items.slice(0, maxNodes).sort(byPath),
      truncated: items.length > maxNodes,
    }
  }

  /**
   * 幂等 upsert:
   * - 校验路径(空/空段/保留段)与 kind↔config 一致性;
   * - 自动物化 parentPaths 中缺失的中间 directory(registeredBy=system:auto,description='');
   *   已存在的祖先(无论显式或自动)一律不动;
   * - createdAt 保留原值(存在时)否则取 now;updatedAt 始终刷新为 now;
   * - registeredBy 由调用方注入(device 节点由 Gateway 代写)。
   *
   * conflict(覆盖他人节点)判定在网关注册路径层,不在此——本层是幂等 upsert。
   */
  async write(
    node: NodeInput,
    registeredBy: string,
    now: Timestamp,
    opts: { lastSeenAt?: Timestamp, online?: boolean } = {},
  ): Promise<TreeNode> {
    const invalid = validatePath(node.path)
    if (invalid) throw invalid
    const path = canonicalizePath(node.path)
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
      ...(opts.online !== undefined ? { online: opts.online } : {}),
      ...(opts.lastSeenAt !== undefined ? { lastSeenAt: opts.lastSeenAt } : {}),
      registeredBy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await this.store.put(this.keyOf(path), full)
    return full
  }

  /** 部分更新(patch);不存在 → not_found;path 不可改。 */
  async update(path: TreePath, patch: Partial<NodeInput>, now: Timestamp): Promise<TreeNode> {
    const norm = canonicalizePath(path)
    const existing = await this.read(norm)
    if (!existing) throw new TBError('not_found', `节点不存在:'${norm}'`)
    if (patch.path !== undefined && canonicalizePath(patch.path) !== norm) {
      throw new TBError('invalid_argument', 'path 不可通过 Update 变更')
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
   * 设备生命周期专用:更新节点 online 状态,不存在 → not_found。
   * online 翻 true 时视为一次存活观察,同步把 `lastSeenAt` 刷到 now;翻 false 时保留原
   * `lastSeenAt`(用于展示"最后在线于")。
   */
  async setOnline(path: TreePath, online: boolean, now: Timestamp): Promise<TreeNode> {
    const norm = canonicalizePath(path)
    const existing = await this.read(norm)
    if (!existing) throw new TBError('not_found', `节点不存在:'${norm}'`)
    const updated: TreeNode = {
      ...existing,
      online,
      ...(online ? { lastSeenAt: now } : {}),
      updatedAt: now,
    }
    await this.store.put(this.keyOf(norm), updated)
    return updated
  }

  /**
   * 设备心跳专用:只把 `lastSeenAt` 刷到 now,不改 online 也不动 updatedAt(心跳不是元数据变更,
   * 不该扰动 updatedAt 的语义)。节点不存在时静默返回——心跳晚于节点删除是正常竞态,不报错。
   */
  async touchSeen(path: TreePath, now: Timestamp): Promise<void> {
    const norm = canonicalizePath(path)
    const existing = await this.read(norm)
    if (!existing) return
    await this.store.put(this.keyOf(norm), { ...existing, lastSeenAt: now })
  }

  /**
   * 卸载;不存在 → not_found。删除后自底向上级联回收:
   * 仅回收 registeredBy=system:auto 且再无子节点的 directory,遇显式节点/仍有子节点即停。
   *
   * 实现决策(待回写 docs):被删节点若仍有后代 → conflict
   * (不允许删除非空子树;显式 directory 同理)。
   */
  async delete(path: TreePath): Promise<void> {
    const norm = canonicalizePath(path)
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
   * 设备回收专用:删除一个已知子树(含根与全部后代),再按普通 delete 规则回收自动目录。
   * 普通管理面仍使用 delete(),不允许误删非空子树。
   */
  async deleteSubtree(path: TreePath): Promise<void> {
    const norm = canonicalizePath(path)
    const existing = await this.read(norm)
    if (!existing) throw new TBError('not_found', `节点不存在:'${norm}'`)
    const descendants = await this.scanPrefix(this.subtreePrefix(norm))
    descendants.sort((a, b) => segments(b.path).length - segments(a.path).length || byPath(b, a))
    for (const n of descendants) await this.store.delete(this.keyOf(n.path))
    await this.store.delete(this.keyOf(norm))
    for (const parent of [...parentPaths(norm)].reverse()) {
      const p = await this.read(parent)
      if (!p || p.registeredBy !== SYSTEM_AUTO || p.kind !== 'directory') break
      if (await this.hasChildren(parent)) break
      await this.store.delete(this.keyOf(parent))
    }
  }

  /**
   * 最长前缀匹配:返回命中节点与剩余段('/' 连接)。
   * 完全匹配 → rest=''。无任何匹配 → not_found。
   */
  async resolve(path: TreePath): Promise<{ node: TreeNode, rest: string }> {
    const norm = canonicalizePath(path)
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
