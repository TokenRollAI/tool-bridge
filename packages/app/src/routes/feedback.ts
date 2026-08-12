/**
 * `~feedback`:per-path 的 Agent 反馈(一级协议能力)。
 *
 * 权限判定落在目标 path 本身(而非集中管理节点):窄 scope SK 对自己够得着的路径天然
 * 可读/可反馈。排序、隐藏阈值与防刷都在 core FeedbackStore;`~help` 默认区块经
 * enrichHelp 注入。写路径同时喂搜索派生态(dirty marker 协议)。
 */
import {
  check,
  contentTypeFor,
  FEEDBACK_HIDE_SCORE,
  FeedbackStore,
  NodeRegistryStore,
  TBError,
} from '@tool-bridge/core'
import type { AppContext } from '../deps'
import type { RouteEnv } from './env'
import { splitFeedback } from '../paths'

// --- ~feedback(保留段:per-path Agent 反馈,一级协议能力)---
// 权限判定落在目标 path 本身(而非集中管理节点):窄 scope SK(如仅 feishu/**)对
// 自己够得着的路径天然可读/可反馈。read 判不过 → 404 不泄露存在性(与 ~help 同则)。
// 排序/阈值/防刷在 core FeedbackStore;~help 默认区块经 enrichHelp 注入。

/** 反馈条目的线上视图:投票人集合不外露,只回计数与净分。 */
const feedbackJson = (value: unknown): Response =>
  new Response(JSON.stringify(value), { headers: { 'content-type': contentTypeFor('json') } })

// GET /<path>/~feedback → 列表(?hidden=1 含净分 ≤ 阈值的隐藏条目);GET .../~feedback/<id> → 单条详情。
export async function handleFeedbackGet(c: AppContext): Promise<Response> {
  const target = splitFeedback(new URL(c.req.url).pathname)
  if (target === null || target.path === '') throw TBError.notFound('no such path')
  const ctx = c.get('ctx')
  if (!check(ctx, target.path, 'read').allow) throw TBError.notFound('not found')
  const fb = new FeedbackStore(c.get('store'))
  if (target.id !== undefined) {
    const e = await fb.get(target.path, target.id)
    return feedbackJson({
      id: e.id,
      path: target.path,
      title: e.title,
      detail: e.detail,
      by: e.by,
      at: e.at,
      up: e.up.length,
      down: e.down.length,
      score: e.up.length - e.down.length,
    })
  }
  const views = await fb.listViews(target.path)
  const items
    = c.req.query('hidden') === '1' ? views : views.filter(v => v.score > FEEDBACK_HIDE_SCORE)
  return feedbackJson({ items })
}

// POST /<path>/~feedback {title,detail} → 提交;POST .../~feedback/<id> {vote} → 投票(每身份一票,可改票)。
export async function handleFeedbackPost(c: AppContext, env: RouteEnv): Promise<Response> {
  const { searchSync } = env
  const target = splitFeedback(new URL(c.req.url).pathname)
  if (target === null || target.path === '') throw TBError.notFound('no such path')
  const ctx = c.get('ctx')
  const store = c.get('store')
  if (!check(ctx, target.path, 'read').allow) throw TBError.notFound('not found')
  if (!check(ctx, target.path, 'call').allow) {
    throw new TBError('permission_denied', `no scope grants 'call' on '${target.path}'`)
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  if (body === null || typeof body !== 'object') {
    throw new TBError('invalid_argument', 'body must be a JSON object')
  }
  const marker = await searchSync?.markNode(target.path)
  try {
    const fb = new FeedbackStore(store, async (path, entries) => {
      await searchSync?.reconcileNodeQuietly(path, { feedback: entries, marker })
    })
    if (target.id !== undefined) {
      const vote = body.vote
      if (vote !== 'up' && vote !== 'down' && vote !== 'clear') {
        throw new TBError('invalid_argument', `body.vote must be 'up' | 'down' | 'clear'`)
      }
      return feedbackJson(await fb.vote(target.path, target.id, ctx.owner, vote))
    }
    if (typeof body.title !== 'string' || typeof body.detail !== 'string') {
      throw new TBError('invalid_argument', 'body must be { title: string, detail: string }')
    }
    // path 须挂在真实节点(或其工具子路径)下,防悬空路径积垃圾。
    await new NodeRegistryStore(store).resolve(target.path)
    const entry = await fb.submit(
      target.path,
      { title: body.title, detail: body.detail },
      ctx.owner,
      new Date().toISOString(),
    )
    return feedbackJson({ id: entry.id, path: target.path, title: entry.title, at: entry.at })
  } catch (error) {
    await searchSync?.abort(marker)
    throw error
  }
}

// DELETE /<path>/~feedback/<id> → 管理面清理(admin)。
export async function handleFeedbackDelete(c: AppContext, env: RouteEnv): Promise<Response> {
  const { searchSync } = env
  const target = splitFeedback(new URL(c.req.url).pathname)
  if (target === null || target.path === '' || target.id === undefined) {
    throw TBError.notFound('no such path')
  }
  const ctx = c.get('ctx')
  if (!check(ctx, target.path, 'read').allow) throw TBError.notFound('not found')
  if (!check(ctx, target.path, 'admin').allow) {
    throw new TBError('permission_denied', `no scope grants 'admin' on '${target.path}'`)
  }
  const marker = await searchSync?.markNode(target.path)
  try {
    await new FeedbackStore(c.get('store'), async (path, entries) => {
      await searchSync?.reconcileNodeQuietly(path, { feedback: entries, marker })
    }).remove(target.path, target.id)
  } catch (error) {
    await searchSync?.abort(marker)
    throw error
  }
  return feedbackJson({ ok: true })
}
