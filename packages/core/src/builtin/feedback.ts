/**
 * builtin 模块 "feedback" → Agent 使用反馈(挂载为 system/feedback 节点)。
 *
 * Agent 使用某 Path 的工具踩坑后提交 title + 简短 detail;其他 Agent 按 id 点赞/点踩
 * (每身份一票、可改票);网关把该 Path 头部条目注入其 `~help` 默认区块(只露 id+title,
 * 详情经本模块 get 下钻)。排序/隐藏阈值的唯一真源在 feedback/store.ts。
 *
 * scope 设计:submit/vote 用 `call`——典型 agent SK(`**` read+call)开箱可提交/投票,
 * 而 annotation 的写面(admin)碰不到;窄 scope SK(如仅 `feishu/**`)需显式补一条
 * `{pattern:'system/feedback', actions:['read','call']}`。
 */

import { TBError } from '../errors'
import {
  FEEDBACK_DETAIL_MAX,
  FEEDBACK_HIDE_SCORE,
  FEEDBACK_TITLE_MAX,
  type FeedbackStore,
  type FeedbackVote,
  scoreOf,
} from '../feedback/store'
import type { CmdSpec, HelpModel } from '../htbp/model'
import type { NodeRegistryStore } from '../tree/registry'
import type { CallContext, TreePath } from '../types'
import type { BuiltinModule } from './types'
import { cmdPath, requireString, VOID_ACK } from './util'

const DESCRIPTION =
  'Agent feedback on tool paths: submit pitfalls (short title + detail), vote, drill down by id; top entries show up in ~help of the path'

function feedbackCmds(nodePath: TreePath): CmdSpec[] {
  const path = cmdPath(nodePath)
  return [
    {
      name: 'submit',
      method: 'POST',
      path,
      h: `share a pitfall you hit on <path>; keep it short (title <= ${FEEDBACK_TITLE_MAX} chars, detail <= ${FEEDBACK_DETAIL_MAX})`,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          title: { type: 'string', maxLength: FEEDBACK_TITLE_MAX },
          detail: { type: 'string', maxLength: FEEDBACK_DETAIL_MAX },
        },
        required: ['path', 'title', 'detail'],
      },
      returns: '{ id, path, title, at }',
      scope: 'call',
    },
    {
      name: 'get',
      method: 'POST',
      path,
      h: 'full detail of one feedback (ids appear in ~help of the path)',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, id: { type: 'string' } },
        required: ['path', 'id'],
      },
      returns: '{ id, title, detail, by, at, up, down, score }',
      scope: 'read',
    },
    {
      name: 'list',
      method: 'POST',
      path,
      h: `all feedback of a path sorted by score; includeHidden also shows entries with score <= ${FEEDBACK_HIDE_SCORE}`,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          includeHidden: { type: 'boolean' },
        },
        required: ['path'],
      },
      returns: '{ items: Array<{ id, title, by, at, up, down, score }> } — no detail; use get',
      scope: 'read',
    },
    {
      name: 'vote',
      method: 'POST',
      path,
      h: 'rate a feedback once per identity; revote overrides, clear withdraws',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          id: { type: 'string' },
          value: { type: 'string', enum: ['up', 'down', 'clear'] },
        },
        required: ['path', 'id', 'value'],
      },
      returns: '{ id, title, by, at, up, down, score }',
      scope: 'call',
    },
    {
      name: 'remove',
      method: 'POST',
      path,
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, id: { type: 'string' } },
        required: ['path', 'id'],
      },
      returns: 'void',
      scope: 'admin',
    },
  ]
}

export interface FeedbackModuleDeps {
  store: FeedbackStore
  /** submit 时校验 path 最长前缀命中真实节点(工具子路径天然通过)。 */
  registry: NodeRegistryStore
  now: () => string
}

const VOTE_VALUES: readonly FeedbackVote[] = ['up', 'down', 'clear']

export function createFeedbackModule(deps: FeedbackModuleDeps): BuiltinModule {
  return {
    module: 'feedback',
    description: DESCRIPTION,
    help(nodePath: TreePath): HelpModel {
      return {
        node: { path: nodePath, kind: 'builtin', description: DESCRIPTION },
        cmds: feedbackCmds(nodePath),
      }
    },
    async dispatch(cmd: string, args: Record<string, unknown>, ctx: CallContext): Promise<unknown> {
      switch (cmd) {
        case 'submit': {
          const path = requireString(args, 'path')
          await deps.registry.resolve(path)
          const entry = await deps.store.submit(
            path,
            { title: requireString(args, 'title'), detail: requireString(args, 'detail') },
            ctx.owner,
            deps.now(),
          )
          return { id: entry.id, path, title: entry.title, at: entry.at }
        }
        case 'get': {
          const entry = await deps.store.get(requireString(args, 'path'), requireString(args, 'id'))
          return {
            id: entry.id,
            title: entry.title,
            detail: entry.detail,
            by: entry.by,
            at: entry.at,
            up: entry.up.length,
            down: entry.down.length,
            score: scoreOf(entry),
          }
        }
        case 'list': {
          const views = await deps.store.listViews(requireString(args, 'path'))
          const includeHidden = args.includeHidden === true
          return {
            items: includeHidden ? views : views.filter((v) => v.score > FEEDBACK_HIDE_SCORE),
          }
        }
        case 'vote': {
          const value = requireString(args, 'value') as FeedbackVote
          if (!VOTE_VALUES.includes(value)) {
            throw new TBError('invalid_argument', "field 'value' must be 'up' | 'down' | 'clear'")
          }
          return await deps.store.vote(
            requireString(args, 'path'),
            requireString(args, 'id'),
            ctx.owner,
            value,
          )
        }
        case 'remove': {
          await deps.store.remove(requireString(args, 'path'), requireString(args, 'id'))
          return VOID_ACK
        }
        default:
          throw new TBError('invalid_argument', `unknown cmd '${cmd}' on system/feedback`)
      }
    },
  }
}
