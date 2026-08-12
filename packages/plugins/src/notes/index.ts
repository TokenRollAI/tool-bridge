/**
 * 样例 plugin:**一个部署同时导出 tools 与 context**,且不写一行协议样板。
 *
 * 作者在本文件里只做三件事:声明操作的名字与 Zod schema、写 handler、写业务逻辑。
 * 平台协议的一整套 —— 健康检查、`/~describe`(v2 exports)、`/~help`、envelope 编解码、
 * Bearer 鉴权、`X-TB-Request-Id` 去重、上游凭证解包、JSON Schema 派生、入参校验、
 * 错误归一、export 路由 —— 全部由 `@tool-bridge/plugin-sdk` 接管。
 *
 * 对照 plugin-feishu 的 v1 手写实现(~300 行里大半是协议):这里零协议代码。
 *
 * 两个 export:
 * - `actions`(tools/v1):create_note / count_notes,入参 schema 即 Zod,JSON Schema 自动派生;
 * - `notes`(context/v1):只实现 list/get/write/search —— **不实现 update/delete**,
 *   于是这个 export 如实自报为"可写但不可改不可删"(append-only),平台按声明裁剪动词表。
 *
 * 存储用进程内 Map:样例要能独立跑起来,不引入 KV/D1 绑定。真实 plugin 把
 * `notes` 换成 KV/D1/上游 API 即可,其余代码不动。
 */

import { createPlugin, type Plugin, TBError } from '@tool-bridge/plugin-sdk'
import { z } from 'zod/v4'

export interface Env {
  /** 平台调用本 plugin 时携带的 Bearer token(注册时由平台 mint)。 */
  PLUGIN_TOKEN?: string
}

interface Note {
  body: string
  tags: string[]
  title: string
  updatedAt: string
  version: number
}

/** context 条目的 uri:node://<挂载路径>/<条目路径>(挂载路径由平台在调用上下文里给)。 */
function uriOf(mountPath: string | undefined, path: string): string {
  return `node://${mountPath ?? 'notes'}/${path}`
}

function metaOf(mountPath: string | undefined, path: string, note: Note): {
  contentType: string
  metadata: Record<string, string>
  size: number
  updatedAt: string
  uri: string
  version: string
} {
  return {
    uri: uriOf(mountPath, path),
    contentType: 'text/markdown',
    version: String(note.version),
    updatedAt: note.updatedAt,
    metadata: { title: note.title, tags: note.tags.join(',') },
    size: note.body.length,
  }
}

/**
 * 工厂形态:每个实例自带存储,便于测试起多份;部署只用下面的默认实例。
 *
 * **存储按 `providerConfig.workspace` 分区**,不是按 mountPath。
 *
 * 为什么不是 mountPath:这个 plugin 的两个 export(tools 与 context)会被挂在**不同路径**
 * (`tools/notes` 写、`docs/notes` 读),而它们本该看到同一份数据 —— 那正是"一个部署同时
 * 导出动作面与内容面"的意义。按 mountPath 分区会把这条能力切断。
 *
 * 而 `export default` 是单例,多个团队挂同一部署时又确实需要隔离。归属只能由**挂载方**声明:
 * `providerConfig: { workspace: 'team-a' }`。同 workspace 的挂载共享数据,不同的互不可见;
 * 没声明的落到默认区(单团队用法零配置)。真实 plugin 用 KV/D1 时同理:key 带这个前缀。
 */
export function createNotesPlugin(): Plugin<Env> {
  /** workspace → 该工作区的笔记表。 */
  const byWorkspace = new Map<string, Map<string, Note>>()
  const notesOf = (config: Record<string, unknown> | undefined): Map<string, Note> => {
    const raw = config?.workspace
    const key = typeof raw === 'string' && raw !== '' ? raw : ''
    let store = byWorkspace.get(key)
    if (store === undefined) {
      store = new Map<string, Note>()
      byWorkspace.set(key, store)
    }
    return store
  }
  const plugin = createPlugin<Env>({ token: env => env.PLUGIN_TOKEN })

  plugin
    .tools('actions', { description: '记事本动作' })
    .register(
      'create_note',
      {
        description: '新建一条笔记,返回它在 context export 里的路径',
        inputSchema: z.object({
          title: z.string().min(1).describe('笔记标题'),
          body: z.string().describe('Markdown 正文'),
          tags: z.array(z.string()).optional().describe('标签'),
        }),
        effect: 'write',
      },
      ({ title, body, tags }, ctx) => {
        const notes = notesOf(ctx.mountConfig)
        const path = title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        const existing = notes.get(path)
        const note: Note = {
          title,
          body,
          tags: tags ?? [],
          version: (existing?.version ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        }
        notes.set(path, note)
        // 裸返回值由 SDK 包成 ToolResult,作者不碰协议形状。
        return { path, version: note.version }
      },
    )
    .register(
      'count_notes',
      {
        description: '统计笔记条数(可按标签过滤)',
        inputSchema: z.object({ tag: z.string().optional().describe('只数带此标签的') }),
        effect: 'read',
      },
      ({ tag }, ctx) => ({
        count: [...notesOf(ctx.mountConfig).values()]
          .filter(n => tag === undefined || n.tags.includes(tag)).length,
      }),
    )

  plugin.context('notes', {
    description: '笔记内容面(append-only:可读可写,不可改不可删)',

    list: ({ path }, ctx) => ({
      items: [...notesOf(ctx.mountConfig).entries()]
        .filter(([key]) => key.startsWith(path))
        .map(([key, note]) => metaOf(ctx.mountPath, key, note)),
    }),

    get: ({ path }, ctx) => {
      const note = notesOf(ctx.mountConfig).get(path)
      if (note === undefined) throw TBError.notFound(`no such note: '${path}'`)
      return { ...metaOf(ctx.mountPath, path, note), content: note.body }
    },

    write: ({ path, entry }, ctx) => {
      const notes = notesOf(ctx.mountConfig)
      const existing = notes.get(path)
      const note: Note = {
        title: entry.metadata?.title ?? existing?.title ?? path,
        body: typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content),
        tags: existing?.tags ?? [],
        version: (existing?.version ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      }
      notes.set(path, note)
      return metaOf(ctx.mountPath, path, note)
    },

    search: ({ query }, ctx) => {
      const needle = query.toLowerCase()
      return {
        items: [...notesOf(ctx.mountConfig).entries()]
          .filter(([, note]) =>
            note.title.toLowerCase().includes(needle) || note.body.toLowerCase().includes(needle))
          .map(([key, note]) => metaOf(ctx.mountPath, key, note)),
      }
    },
  })

  return plugin
}

/** Worker / Deno / Bun 入口。 */
export default createNotesPlugin()
