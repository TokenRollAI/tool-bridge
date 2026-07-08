/**
 * FeedbackStore:Agent 使用反馈(纯逻辑,经注入 StateStore 读写)。
 *
 * 每 path 一份 FeedbackEntry[],key = `feedback:<path>`,单 key 整存整取
 * (allowlist 先例:~help 热路径 1 次 get 即可注入,排序在内存做)。
 * **最终一致权衡**:KV 宿主 last-write-wins,同 path 并发 submit/vote 最坏丢一票/一条;
 * feedback 是低频非关键数据(允许改票、可重投),接受该窗口,不做 CAS。
 *
 * 排序(~help 默认区块的唯一真源 = {@link FeedbackStore.helpItems}):
 * score = up-down 降序,at 降序 tie-break;score ≤ FEEDBACK_HIDE_SCORE 隐藏;取前
 * FEEDBACK_HELP_LIMIT 条。list 不过滤(隐藏条目仍可查)。
 */

import { TBError } from '../errors'
import { KEY_FEEDBACK, type StateStore } from '../store'
import { normalizePath, validatePath } from '../tree/path'
import type { OwnerRef, Timestamp, TreePath } from '../types'

/** WebCrypto 全局(Workers 与 Node ≥19 均有);core 不引宿主类型,按 sk.ts 惯例局部声明。 */
declare const crypto: {
  getRandomValues<T extends Uint8Array>(array: T): T
}

/** 一条反馈。up/down 是投票人集合(每身份一票、可改票的真源);净分为派生值不落库。 */
export interface FeedbackEntry {
  id: string
  title: string
  detail: string
  /** 提交者(ctx.owner,如 'agent:researcher')。 */
  by: OwnerRef
  at: Timestamp
  up: OwnerRef[]
  down: OwnerRef[]
}

/** list/get 的视图:投票人集合不外露,只回计数与净分。 */
export interface FeedbackView {
  id: string
  title: string
  by: OwnerRef
  at: Timestamp
  up: number
  down: number
  score: number
}

/** ~help 默认区块的单条形态(只露 id+title+score,省 token)。 */
export interface FeedbackHelpItem {
  id: string
  title: string
  score: number
}

export const FEEDBACK_TITLE_MAX = 80
export const FEEDBACK_DETAIL_MAX = 500
/** 净分 ≤ 此值的条目不进 ~help 默认区块(list 仍可查)。 */
export const FEEDBACK_HIDE_SCORE = -3
/** ~help 默认区块条数上限。 */
export const FEEDBACK_HELP_LIMIT = 5
/** 每 (path, owner) 活跃条数上限(防刷)。 */
export const FEEDBACK_PER_OWNER_MAX = 10

export type FeedbackVote = 'up' | 'down' | 'clear'

/** 规范化并校验 feedback 目标路径(不允许根:反馈总是针对具体能力)。 */
export function normalizeFeedbackPath(path: string): TreePath {
  const norm = normalizePath(path)
  const invalid = validatePath(norm)
  if (invalid) throw invalid
  return norm
}

export function scoreOf(entry: Pick<FeedbackEntry, 'up' | 'down'>): number {
  return entry.up.length - entry.down.length
}

/** score 降序,at 降序 tie-break(新的在前)。返回新数组。 */
export function sortFeedback(entries: FeedbackEntry[]): FeedbackEntry[] {
  return [...entries].sort((a, b) => scoreOf(b) - scoreOf(a) || b.at.localeCompare(a.at))
}

/** ~help 默认区块选条:排序 → 过滤隐藏阈值 → 截前 N。 */
export function selectHelpItems(entries: FeedbackEntry[]): FeedbackHelpItem[] {
  return sortFeedback(entries)
    .filter((e) => scoreOf(e) > FEEDBACK_HIDE_SCORE)
    .slice(0, FEEDBACK_HELP_LIMIT)
    .map((e) => ({ id: e.id, title: e.title, score: scoreOf(e) }))
}

function toView(entry: FeedbackEntry): FeedbackView {
  return {
    id: entry.id,
    title: entry.title,
    by: entry.by,
    at: entry.at,
    up: entry.up.length,
    down: entry.down.length,
    score: scoreOf(entry),
  }
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** 'fb_' + 6 位 base36 随机(crypto 熵源;path 内查重由调用方负责)。 */
function randomFeedbackId(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  let out = 'fb_'
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length]
  return out
}

function requireShort(value: string, field: string, max: number): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new TBError('invalid_argument', `${field} 不能为空`)
  }
  if (trimmed.length > max) {
    throw new TBError('invalid_argument', `${field} 过长(${trimmed.length} > ${max} 字符)`)
  }
  return trimmed
}

export class FeedbackStore {
  constructor(private readonly store: StateStore) {}

  private keyOf(path: TreePath): string {
    return KEY_FEEDBACK + path
  }

  /** 读全部条目(缺省/脏值 → 空数组;跳过坏形状条目)。 */
  async listFor(path: TreePath): Promise<FeedbackEntry[]> {
    const norm = normalizeFeedbackPath(path)
    const raw = await this.store.get(this.keyOf(norm))
    if (!Array.isArray(raw)) return []
    const out: FeedbackEntry[] = []
    for (const item of raw) {
      if (item === null || typeof item !== 'object') continue
      const e = item as FeedbackEntry
      if (typeof e.id !== 'string' || typeof e.title !== 'string') continue
      out.push({
        id: e.id,
        title: e.title,
        detail: typeof e.detail === 'string' ? e.detail : '',
        by: typeof e.by === 'string' ? e.by : '',
        at: typeof e.at === 'string' ? e.at : '',
        up: Array.isArray(e.up) ? e.up.filter((v): v is string => typeof v === 'string') : [],
        down: Array.isArray(e.down) ? e.down.filter((v): v is string => typeof v === 'string') : [],
      })
    }
    return out
  }

  /** list 视图:全部条目(含隐藏阈值以下)按 score/at 排序,不含 detail。 */
  async listViews(path: TreePath): Promise<FeedbackView[]> {
    return sortFeedback(await this.listFor(path)).map(toView)
  }

  /** ~help 默认区块选条(网关注入用;1 次 get)。 */
  async helpItems(path: TreePath): Promise<FeedbackHelpItem[]> {
    return selectHelpItems(await this.listFor(path))
  }

  /** 取单条完整条目(含 detail);不存在 → not_found。 */
  async get(path: TreePath, id: string): Promise<FeedbackEntry> {
    const entries = await this.listFor(path)
    const entry = entries.find((e) => e.id === id)
    if (!entry) throw TBError.notFound(`feedback 不存在:'${id}'(path '${path}')`)
    return entry
  }

  /** 提交(title/detail 强制短;每 owner 每 path 上限防刷)。 */
  async submit(
    path: TreePath,
    input: { title: string; detail: string },
    by: OwnerRef,
    now: Timestamp,
  ): Promise<FeedbackEntry> {
    const norm = normalizeFeedbackPath(path)
    const title = requireShort(input.title, 'title', FEEDBACK_TITLE_MAX)
    const detail = requireShort(input.detail, 'detail', FEEDBACK_DETAIL_MAX)
    const entries = await this.listFor(norm)
    const mine = entries.filter((e) => e.by === by).length
    if (mine >= FEEDBACK_PER_OWNER_MAX) {
      throw new TBError(
        'rate_limited',
        `该路径下你已有 ${mine} 条反馈(上限 ${FEEDBACK_PER_OWNER_MAX});可先对已有条目投票或请管理员清理`,
        { retryable: true },
      )
    }
    let id = randomFeedbackId()
    for (let i = 0; entries.some((e) => e.id === id); i++) {
      if (i >= 3) throw new TBError('internal', 'feedback id 生成碰撞', { retryable: true })
      id = randomFeedbackId()
    }
    const entry: FeedbackEntry = { id, title, detail, by, at: now, up: [], down: [] }
    entries.push(entry)
    await this.store.put(this.keyOf(norm), entries)
    return entry
  }

  /** 投票:每 owner 一票,改票 = 先从两集合摘除再加入;'clear' 撤票。不存在 → not_found。 */
  async vote(
    path: TreePath,
    id: string,
    voter: OwnerRef,
    value: FeedbackVote,
  ): Promise<FeedbackView> {
    const norm = normalizeFeedbackPath(path)
    const entries = await this.listFor(norm)
    const entry = entries.find((e) => e.id === id)
    if (!entry) throw TBError.notFound(`feedback 不存在:'${id}'(path '${norm}')`)
    entry.up = entry.up.filter((v) => v !== voter)
    entry.down = entry.down.filter((v) => v !== voter)
    if (value === 'up') entry.up.push(voter)
    if (value === 'down') entry.down.push(voter)
    await this.store.put(this.keyOf(norm), entries)
    return toView(entry)
  }

  /** 删除单条;不存在 → not_found。删空后回收整 key。 */
  async remove(path: TreePath, id: string): Promise<void> {
    const norm = normalizeFeedbackPath(path)
    const entries = await this.listFor(norm)
    const next = entries.filter((e) => e.id !== id)
    if (next.length === entries.length) {
      throw TBError.notFound(`feedback 不存在:'${id}'(path '${norm}')`)
    }
    if (next.length === 0) {
      await this.store.delete(this.keyOf(norm))
    } else {
      await this.store.put(this.keyOf(norm), next)
    }
  }
}
