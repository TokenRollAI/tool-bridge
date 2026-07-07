/**
 * 示例 context-provider Plugin(Plugin.md §4;内存 stub 数据版)。
 *
 * 供真实 E2E 用(echo-mcp 同款模式,devDependency tsx 直跑,不进生产构建):
 * 实现 Plugin 通用契约(Plugin.md §3 / Proto §8.2/§8.3)——
 *   GET  /healthz     → { healthy: true }
 *   GET  /~describe   → { kind, interfaceVersion, capabilities: [search, delete] }
 *   GET  /~help       → Help DSL(Accept: application/json → HelpJson;复用 core 渲染器)
 *   POST /            → §8.3 envelope {"tool":"<Method>","arguments":{...}}
 * 数据是内存里的几条 markdown 条目(进程退出即失);List 支持 cursor 分页,
 * X-TB-Request-Id 幂等去重复用 core 的 RequestDedupe(重放返回首次结果,含错误)。
 *
 * 鉴权:envelope 调用必须带非空 `Authorization: Bearer <token>`;设了环境变量
 * STUB_PROVIDER_TOKEN(注册后由运维把平台 mint 的 pluginToken 配进来,Proto §8.1
 * platform-token 语义)时还要求逐字相等——无/错凭证一律 401 TBError。
 * 生命周期 GET(healthz/~describe/~help)不鉴权(平台注册探活即无凭证)。
 *
 * 用法:`pnpm stub-provider`(默认 127.0.0.1:39004);配合
 * `TB_ALLOW_INSECURE_HTTP=true` 的本地网关注册消费,见 scripts/verify-plugin.ts。
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  decodeCallContext,
  decodePluginCall,
  type HelpModel,
  isTBError,
  negotiate,
  RequestDedupe,
  renderHelpDsl,
  renderHelpJson,
  TBError,
} from '@tool-bridge/core'

const PORT = Number(process.env.STUB_PROVIDER_PORT ?? 39004)
const HOST = process.env.STUB_PROVIDER_HOST ?? '127.0.0.1'
/** 平台 mint 的 pluginToken(注册响应仅出现一次,由运维配进来);未配置时仅要求非空。 */
const EXPECTED_TOKEN = process.env.STUB_PROVIDER_TOKEN

const KIND = 'context-provider'
const INTERFACE_VERSION = 'context-provider/v1'
const CAPABILITIES = ['search', 'delete'] as const

// ---------- 内存 stub 数据 ----------

interface StoredEntry {
  contentType: string
  content: unknown
  metadata: Record<string, string>
  revision: number
  updatedAt: string
}

const entries = new Map<string, StoredEntry>()

const SEED: ReadonlyArray<[string, string]> = [
  ['guide/intro.md', '# Intro\n\ntool-bridge 示例 context-provider 的种子条目。'],
  ['guide/setup.md', '# Setup\n\n1. 注册 manifest\n2. 挂载到树\n3. 授权 scope'],
  ['guide/faq.md', '# FAQ\n\nQ: 数据存哪?\nA: 进程内存,重启即失(stub)。'],
  ['notes/roadmap.md', '# Roadmap\n\n- [ ] Watch 能力\n- [ ] search:semantic'],
  ['notes/changelog.md', '# Changelog\n\n- v1: List/Get/Write/Update + Search/Delete'],
]
for (const [path, content] of SEED) {
  entries.set(path, {
    contentType: 'text/markdown',
    content,
    metadata: {},
    revision: 1,
    updatedAt: new Date().toISOString(),
  })
}

/** 落盘条目 → ContextEntryMeta(Proto §5.1;uri 用 stub 自己的命名空间)。 */
function toMeta(path: string, e: StoredEntry): Record<string, unknown> {
  return {
    uri: `node://stub/${path}`,
    contentType: e.contentType,
    ...(typeof e.content === 'string' ? { size: Buffer.byteLength(e.content) } : {}),
    version: String(e.revision),
    updatedAt: e.updatedAt,
    metadata: e.metadata,
  }
}

// ---------- 方法实现(动词映射语义见 Plugin.md §4:由 Plugin 自定,合理即可) ----------

function requirePath(args: Record<string, unknown>): string {
  const path = args.path
  if (typeof path !== 'string' || path === '') {
    throw new TBError('invalid_argument', "field 'path' must be a non-empty string")
  }
  return path
}

function requireEntry(path: string): StoredEntry {
  const e = entries.get(path)
  if (e === undefined) throw new TBError('not_found', `entry '${path}' not found`)
  return e
}

/** cursor = 上一页最后一个 entry path;limit 缺省 50、上限 200(Proto §0.3)。 */
function pageOf(keys: string[], opts: Record<string, unknown>): Record<string, unknown> {
  const rawLimit = typeof opts.limit === 'number' ? opts.limit : 50
  const limit = Math.min(Math.max(1, rawLimit), 200)
  let start = 0
  if (typeof opts.cursor === 'string' && opts.cursor !== '') {
    const idx = keys.indexOf(opts.cursor)
    if (idx < 0) throw new TBError('invalid_argument', `unknown cursor '${opts.cursor}'`)
    start = idx + 1
  }
  const slice = keys.slice(start, start + limit)
  const items = slice.map((k) => toMeta(k, requireEntry(k)))
  return start + limit < keys.length && slice.length > 0
    ? { items, cursor: slice[slice.length - 1] }
    : { items }
}

function optsOf(args: Record<string, unknown>): Record<string, unknown> {
  return typeof args.opts === 'object' && args.opts !== null
    ? (args.opts as Record<string, unknown>)
    : {}
}

function doWrite(args: Record<string, unknown>): Record<string, unknown> {
  const path = requirePath(args)
  const input = args.entry
  if (typeof input !== 'object' || input === null) {
    throw new TBError('invalid_argument', "Write 需要对象 'entry'")
  }
  const { content, contentType, metadata, ifVersion } = input as Record<string, unknown>
  if (content === undefined) {
    throw new TBError('invalid_argument', 'entry.content is required(Proto §5.1)')
  }
  const prev = entries.get(path)
  if (typeof ifVersion === 'string' && prev !== undefined && String(prev.revision) !== ifVersion) {
    throw new TBError('conflict', `version mismatch: expected ${ifVersion}, at ${prev.revision}`)
  }
  const next: StoredEntry = {
    contentType:
      typeof contentType === 'string'
        ? contentType
        : typeof content === 'string'
          ? 'text/plain'
          : 'application/json',
    content,
    metadata:
      typeof metadata === 'object' && metadata !== null ? (metadata as Record<string, string>) : {},
    revision: (prev?.revision ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  }
  entries.set(path, next)
  return toMeta(path, next)
}

function doUpdate(args: Record<string, unknown>): Record<string, unknown> {
  const path = requirePath(args)
  const patch = args.patch
  if (typeof patch !== 'object' || patch === null) {
    throw new TBError('invalid_argument', "Update 需要对象 'patch'")
  }
  const prev = requireEntry(path) // 不存在 → not_found(Proto §5.1)
  const { content, metadata, ifVersion } = patch as Record<string, unknown>
  if (typeof ifVersion === 'string' && String(prev.revision) !== ifVersion) {
    throw new TBError('conflict', `version mismatch: expected ${ifVersion}, at ${prev.revision}`)
  }
  const next: StoredEntry = {
    ...prev,
    ...(content !== undefined ? { content } : {}),
    metadata:
      typeof metadata === 'object' && metadata !== null
        ? { ...prev.metadata, ...(metadata as Record<string, string>) } // 浅合并(Proto §5.1)
        : prev.metadata,
    revision: prev.revision + 1,
    updatedAt: new Date().toISOString(),
  }
  entries.set(path, next)
  return toMeta(path, next)
}

function doSearch(args: Record<string, unknown>): Record<string, unknown> {
  const query = args.query
  if (typeof query !== 'string' || query === '') {
    throw new TBError('invalid_argument', "field 'query' must be a non-empty string")
  }
  const opts = optsOf(args)
  if (opts.mode === 'semantic') {
    // capabilities 只声明了 'search'(keyword);semantic 未声明(Proto §5.1)。
    throw new TBError('invalid_argument', "search mode 'semantic' not declared in capabilities")
  }
  const hits = [...entries.keys()]
    .sort()
    .filter((k) => k.includes(query) || String(entries.get(k)?.content ?? '').includes(query))
  return pageOf(hits, opts)
}

function invoke(tool: string, args: Record<string, unknown>): unknown {
  switch (tool) {
    case 'List': {
      const prefix = typeof args.path === 'string' ? args.path : ''
      const keys = [...entries.keys()].sort().filter((k) => k.startsWith(prefix))
      return pageOf(keys, optsOf(args))
    }
    case 'Get': {
      const path = requirePath(args)
      const e = requireEntry(path)
      return { ...toMeta(path, e), content: e.content }
    }
    case 'Write':
      return doWrite(args)
    case 'Update':
      return doUpdate(args)
    case 'Search':
      return doSearch(args)
    case 'Delete': {
      const path = requirePath(args)
      requireEntry(path) // 不存在 → not_found
      entries.delete(path)
      return { ok: true }
    }
    default:
      throw new TBError('invalid_argument', `unknown method '${tool}'(见 ~help)`)
  }
}

// ---------- 元端点(~help 复用 core 渲染器,契约校验器两种表现都认) ----------

const HELP: HelpModel = {
  node: {
    path: 'stub-provider',
    kind: 'context',
    description: 'In-memory markdown stub context provider (example plugin)',
  },
  cmds: [
    {
      name: 'List',
      method: 'POST',
      path: '/',
      h: 'List entries under a prefix (paged)',
      returns: 'Page<ContextEntryMeta>',
      scope: 'read',
    },
    {
      name: 'Get',
      method: 'POST',
      path: '/',
      h: 'Read one entry with content',
      returns: 'ContextEntry',
      scope: 'read',
    },
    {
      name: 'Write',
      method: 'POST',
      path: '/',
      h: 'Create or replace an entry (idempotent upsert)',
      returns: 'ContextEntryMeta',
      scope: 'write',
    },
    {
      name: 'Update',
      method: 'POST',
      path: '/',
      h: 'Patch content/metadata of an existing entry',
      returns: 'ContextEntryMeta',
      scope: 'write',
    },
    {
      name: 'Search',
      method: 'POST',
      path: '/',
      h: 'Keyword search over paths and contents',
      returns: 'Page<ContextEntryMeta>',
      scope: 'read',
    },
    {
      name: 'Delete',
      method: 'POST',
      path: '/',
      h: 'Delete an entry',
      returns: 'void',
      scope: 'write',
    },
  ],
}

// ---------- HTTP 装配 ----------

const dedupe = new RequestDedupe()

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

/** 所有失败路径统一 TBError 形状(Plugin.md §7 调试清单④)。 */
function writeError(res: ServerResponse, err: unknown): void {
  const tb = isTBError(err)
    ? err
    : new TBError('internal', err instanceof Error ? err.message : String(err))
  writeJson(res, tb.httpStatus, tb.toJSON())
}

async function handleEnvelope(req: IncomingMessage, res: ServerResponse, raw: string) {
  // 鉴权(Plugin.md §7 调试清单⑥):Bearer 非空;配置了 token 时还须逐字相等。
  const auth = req.headers.authorization
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (token === '') throw TBError.unauthenticated('missing Bearer token')
  if (EXPECTED_TOKEN !== undefined && token !== EXPECTED_TOKEN) {
    throw TBError.unauthenticated('bad plugin token')
  }

  const call = decodePluginCall(raw) // 体积守卫 + 形状校验(坏形状 → invalid_argument)
  const ctxHeader = req.headers['x-tb-context']
  const owner = typeof ctxHeader === 'string' ? decodeCallContext(ctxHeader).owner : undefined

  // X-TB-Request-Id 幂等去重(Proto §8.3):同 id 重放返回首次结果(含错误)。
  const requestId = req.headers['x-tb-request-id']
  const exec = (): unknown => invoke(call.tool, call.arguments)
  const result =
    typeof requestId === 'string' && requestId !== '' ? await dedupe.run(requestId, exec) : exec()
  console.log(`[stub-provider] ${call.tool}${owner !== undefined ? ` by ${owner}` : ''}`)
  writeJson(res, 200, result ?? null)
}

const server = createServer((req, res) => {
  const url = (req.url ?? '/').replace(/\?.*$/, '')
  if (req.method === 'GET') {
    if (url === '/healthz') return writeJson(res, 200, { healthy: true })
    if (url === '/~describe') {
      return writeJson(res, 200, {
        kind: KIND,
        interfaceVersion: INTERFACE_VERSION,
        capabilities: CAPABILITIES,
      })
    }
    if (url === '/~help') {
      if (negotiate(req.headers.accept) === 'json') return writeJson(res, 200, renderHelpJson(HELP))
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      return res.end(renderHelpDsl(HELP))
    }
    return writeError(res, TBError.notFound(`no such path '${url}'`))
  }
  if (req.method !== 'POST' || url !== '/') {
    return writeError(res, TBError.notFound(`no such route ${req.method} ${url}`))
  }
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => chunks.push(chunk))
  req.on('end', () => {
    handleEnvelope(req, res, Buffer.concat(chunks).toString('utf8')).catch((err: unknown) =>
      writeError(res, err),
    )
  })
})

server.listen(PORT, HOST, () => {
  console.log(
    `[stub-provider] listening on http://${HOST}:${PORT} (${entries.size} seed entries, auth: ${EXPECTED_TOKEN !== undefined ? 'pinned token' : 'any non-empty bearer'})`,
  )
})
