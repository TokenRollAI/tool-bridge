import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { defineCommand } from 'citty'
import { globalArgs, resolveTarget } from '../args'
import { CliError, callTool } from '../http'
import { asArray, guard, printJson, printLine, table } from '../output'
import { deleteNode, registerNode } from '../registry'
import type { ContextEntry, ContextEntryMeta, NodeConfig, NodeInput, Page } from '../types'

/**
 * `tb ctx *` —— Context Layer 命令族(Proto 附A / §5)。
 * 数据面四动词 + Search 走 `POST /<ns>` `{tool,arguments}`(cmd 名首字母大写,§1.3);
 * mount/unmount 与 tool.ts 同通道:`~register` 注册 / 管理面 `system/registry` delete。
 */

/** 数据面 URI:去首尾斜杠后加前导 `/`(call.ts 同款)。 */
function nsUri(ns: string): string {
  return `/${ns.replace(/^\/+|\/+$/g, '')}`
}

/** 解析可重复 `--meta k=v` 为 Record;无 `=` → CliError。无任何项返回 undefined。 */
export function parseMeta(specs: unknown): Record<string, string> | undefined {
  const meta: Record<string, string> = {}
  for (const spec of asArray(specs)) {
    const idx = spec.indexOf('=')
    if (idx < 0) throw new CliError(`invalid --meta "${spec}": expected "key=value"`)
    const key = spec.slice(0, idx).trim()
    if (!key) throw new CliError(`invalid --meta "${spec}": empty key`)
    meta[key] = spec.slice(idx + 1)
  }
  return Object.keys(meta).length ? meta : undefined
}

/** 按文件扩展名猜 contentType(--content/stdin 缺省 text/plain)。 */
export function guessContentType(file?: string): string {
  if (!file) return 'text/plain'
  switch (extname(file).toLowerCase()) {
    case '.md':
      return 'text/markdown'
    case '.json':
      return 'application/json'
    case '.txt':
      return 'text/plain'
    default:
      return 'text/plain'
  }
}

/** 可选正整数 flag(--limit/--ttl)。 */
function parsePositiveInt(value: unknown, flag: string): number | undefined {
  if (value === undefined || value === '') return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) {
    throw new CliError(`${flag} must be a positive integer`)
  }
  return n
}

function readContentFile(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch (err) {
    throw new CliError(`cannot read --file "${file}": ${(err as Error).message}`)
  }
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8')
  } catch (err) {
    throw new CliError(`cannot read stdin: ${(err as Error).message}`)
  }
}

/** 人类模式:entry 元数据按行列出(uri + size + updatedAt;目录 uri 以 `/` 结尾)。 */
function printEntries(page: Page<ContextEntryMeta>): void {
  const items = page.items ?? []
  if (items.length === 0) {
    printLine('(no entries)')
    return
  }
  const rows = items.map((m) => [
    m.uri,
    m.size !== undefined ? String(m.size) : '-',
    m.updatedAt ?? '',
  ])
  printLine(table(['URI', 'SIZE', 'UPDATED'], rows))
  if (page.cursor) printLine(`next cursor: ${page.cursor}`)
}

/** `tb ctx ls <ns> [prefix]` —— 浅层列表(ContextProvider.List,§5.1)。 */
export const ctxLsCommand = defineCommand({
  meta: { name: 'ls', description: 'List entries in a context namespace' },
  args: {
    ...globalArgs,
    ns: { type: 'positional', description: 'Context namespace tree path', required: true },
    prefix: {
      type: 'positional',
      description: 'Relative prefix inside namespace',
      required: false,
    },
    limit: { type: 'string', description: 'Page size' },
    cursor: { type: 'string', description: 'Page cursor from previous call' },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const ns = String(args.ns ?? '').trim()
      if (!ns) throw new CliError('namespace path is required')
      const opts: Record<string, unknown> = {}
      const limit = parsePositiveInt(args.limit, '--limit')
      if (limit !== undefined) opts.limit = limit
      if (args.cursor) opts.cursor = String(args.cursor)

      const page = await callTool<Page<ContextEntryMeta>>(resolveTarget(args), nsUri(ns), 'List', {
        path: args.prefix ? String(args.prefix) : '',
        ...(Object.keys(opts).length ? { opts } : {}),
      })
      if (asJson) printJson(page)
      else printEntries(page)
    })
  },
})

/** `tb ctx cat <ns> <entry>` —— 读取 entry(ContextProvider.Get,§5.1)。 */
export const ctxCatCommand = defineCommand({
  meta: { name: 'cat', description: 'Print a context entry' },
  args: {
    ...globalArgs,
    ns: { type: 'positional', description: 'Context namespace tree path', required: true },
    entry: { type: 'positional', description: 'Entry path inside namespace', required: true },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const ns = String(args.ns ?? '').trim()
      if (!ns) throw new CliError('namespace path is required')
      const entryPath = String(args.entry ?? '').trim()
      if (!entryPath) throw new CliError('entry path is required')

      const entry = await callTool<ContextEntry>(resolveTarget(args), nsUri(ns), 'Get', {
        path: entryPath,
      })
      if (asJson) {
        printJson(entry)
        return
      }
      const content = entry.content
      if (typeof content === 'string') {
        printLine(content.replace(/\n$/, ''))
      } else if (content && typeof content === 'object' && '$ref' in content) {
        // 大对象:content = { $ref: <预签名 URL> }(Proto §5.1)。
        process.stderr.write('large object, download via URL\n')
        printLine(String((content as { $ref: unknown }).$ref))
      } else {
        printJson(content)
      }
    })
  },
})

/** `tb ctx put <ns> <entry>` —— 创建/整体替换(ContextProvider.Write,幂等 upsert,§5.1)。 */
export const ctxPutCommand = defineCommand({
  meta: { name: 'put', description: 'Write (create or replace) a context entry' },
  args: {
    ...globalArgs,
    ns: { type: 'positional', description: 'Context namespace tree path', required: true },
    entry: { type: 'positional', description: 'Entry path inside namespace', required: true },
    file: { type: 'string', description: 'Read content from file' },
    content: { type: 'string', description: 'Inline content (wins over --file/stdin)' },
    'content-type': { type: 'string', description: 'Content type (default: guessed from --file)' },
    meta: { type: 'string', description: 'Metadata "key=value" (repeatable)' },
    'if-version': { type: 'string', description: 'Optimistic concurrency: expected version' },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const ns = String(args.ns ?? '').trim()
      if (!ns) throw new CliError('namespace path is required')
      const entryPath = String(args.entry ?? '').trim()
      if (!entryPath) throw new CliError('entry path is required')

      const metadata = parseMeta(args.meta)
      const file = args.file ? String(args.file) : undefined
      // 内容来源优先级:--content > --file > stdin。
      let content: string
      if (args.content !== undefined) content = String(args.content)
      else if (file) content = readContentFile(file)
      else content = readStdin()
      const contentType = args['content-type']
        ? String(args['content-type'])
        : guessContentType(args.content === undefined ? file : undefined)

      const meta = await callTool<ContextEntryMeta>(resolveTarget(args), nsUri(ns), 'Write', {
        path: entryPath,
        entry: {
          contentType,
          content,
          ...(metadata ? { metadata } : {}),
          ...(args['if-version'] ? { ifVersion: String(args['if-version']) } : {}),
        },
      })
      if (asJson) printJson(meta)
      else printLine(`wrote ${meta.uri ?? entryPath}`)
    })
  },
})

/** `tb ctx patch <ns> <entry>` —— 部分更新(ContextProvider.Update,不存在 → not_found,§5.1)。 */
export const ctxPatchCommand = defineCommand({
  meta: { name: 'patch', description: 'Update content and/or metadata of a context entry' },
  args: {
    ...globalArgs,
    ns: { type: 'positional', description: 'Context namespace tree path', required: true },
    entry: { type: 'positional', description: 'Entry path inside namespace', required: true },
    file: { type: 'string', description: 'Read new content from file' },
    content: { type: 'string', description: 'Inline new content (wins over --file)' },
    meta: { type: 'string', description: 'Metadata "key=value" to merge (repeatable)' },
    'if-version': { type: 'string', description: 'Optimistic concurrency: expected version' },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const ns = String(args.ns ?? '').trim()
      if (!ns) throw new CliError('namespace path is required')
      const entryPath = String(args.entry ?? '').trim()
      if (!entryPath) throw new CliError('entry path is required')

      const metadata = parseMeta(args.meta)
      let content: string | undefined
      if (args.content !== undefined) content = String(args.content)
      else if (args.file) content = readContentFile(String(args.file))
      if (content === undefined && !metadata) {
        throw new CliError('nothing to update: pass --content/--file and/or --meta')
      }

      const meta = await callTool<ContextEntryMeta>(resolveTarget(args), nsUri(ns), 'Update', {
        path: entryPath,
        patch: {
          ...(content !== undefined ? { content } : {}),
          ...(metadata ? { metadata } : {}),
          ...(args['if-version'] ? { ifVersion: String(args['if-version']) } : {}),
        },
      })
      if (asJson) printJson(meta)
      else printLine(`updated ${meta.uri ?? entryPath}`)
    })
  },
})

/** `tb ctx search <ns> <query>` —— 检索(ContextProvider.Search,可选能力,§5.1)。 */
export const ctxSearchCommand = defineCommand({
  meta: { name: 'search', description: 'Search entries in a context namespace' },
  args: {
    ...globalArgs,
    ns: { type: 'positional', description: 'Context namespace tree path', required: true },
    query: { type: 'positional', description: 'Search query', required: true },
    mode: { type: 'string', description: 'Search mode: keyword | semantic (default keyword)' },
    limit: { type: 'string', description: 'Page size' },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const ns = String(args.ns ?? '').trim()
      if (!ns) throw new CliError('namespace path is required')
      const query = String(args.query ?? '').trim()
      if (!query) throw new CliError('query is required')
      const mode = args.mode ? String(args.mode) : undefined
      if (mode !== undefined && mode !== 'keyword' && mode !== 'semantic') {
        throw new CliError(`invalid --mode "${mode}"; valid: keyword, semantic`)
      }
      const opts: Record<string, unknown> = {}
      if (mode) opts.mode = mode
      const limit = parsePositiveInt(args.limit, '--limit')
      if (limit !== undefined) opts.limit = limit

      const page = await callTool<Page<ContextEntryMeta>>(
        resolveTarget(args),
        nsUri(ns),
        'Search',
        { query, ...(Object.keys(opts).length ? { opts } : {}) },
      )
      if (asJson) printJson(page)
      else printEntries(page)
    })
  },
})

/**
 * `tb ctx mount <path> --provider r2|s3` —— 挂载 context namespace
 * (NodeRegistry.Write{kind:'context'} via ~register,§5.3;tool.ts mount 同通道)。
 * providerConfig:r2 `{prefix?}`;s3 `{endpoint,bucket,region?,prefix?}` 且 --auth-ref 必填。
 */
export const ctxMountCommand = defineCommand({
  meta: { name: 'mount', description: 'Mount a context namespace (r2/s3)' },
  args: {
    ...globalArgs,
    path: { type: 'positional', description: 'Tree path to mount at', required: true },
    provider: { type: 'string', description: 'Storage provider: r2 | s3', required: true },
    description: { type: 'string', description: 'One-line node description' },
    'auth-ref': { type: 'string', description: 'SecretStore ref for credentials ([s3] required)' },
    'read-only': { type: 'boolean', description: 'Reject write verbs (Write/Update/Delete)' },
    ttl: { type: 'string', description: 'Node TTL in seconds (expired node is reclaimed)' },
    prefix: { type: 'string', description: 'Key prefix inside the bucket' },
    endpoint: { type: 'string', description: '[s3] S3-compatible endpoint URL' },
    bucket: { type: 'string', description: '[s3] bucket name' },
    region: { type: 'string', description: '[s3] region' },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const path = String(args.path ?? '').trim()
      if (!path) throw new CliError('tree path is required')
      const provider = String(args.provider ?? '').trim()
      const authRef = args['auth-ref'] ? String(args['auth-ref']) : undefined
      const prefix = args.prefix ? String(args.prefix) : undefined
      const ttl = parsePositiveInt(args.ttl, '--ttl')

      let providerConfig: Record<string, unknown> | undefined
      if (provider === 'r2') {
        if (prefix) providerConfig = { prefix }
      } else if (provider === 's3') {
        const endpoint = String(args.endpoint ?? '').trim()
        if (!endpoint) throw new CliError('--endpoint is required for --provider s3')
        const bucket = String(args.bucket ?? '').trim()
        if (!bucket) throw new CliError('--bucket is required for --provider s3')
        if (!authRef) throw new CliError('--auth-ref is required for --provider s3')
        providerConfig = {
          endpoint,
          bucket,
          ...(args.region ? { region: String(args.region) } : {}),
          ...(prefix ? { prefix } : {}),
        }
      } else {
        throw new CliError(`invalid --provider "${provider}"; valid: r2, s3`)
      }

      const config: NodeConfig = {
        kind: 'context',
        provider,
        ...(providerConfig ? { providerConfig } : {}),
        ...(authRef ? { authRef } : {}),
        ...(args['read-only'] ? { readOnly: true } : {}),
        ...(ttl !== undefined ? { ttl } : {}),
      }
      const input: NodeInput = {
        path,
        kind: 'context',
        description: args.description ? String(args.description) : '',
        config,
      }

      const node = await registerNode(resolveTarget(args), input)
      if (asJson) printJson(node)
      else printLine(`mounted context node at ${path} (provider ${provider})`)
    })
  },
})

/** `tb ctx unmount <path>` —— 卸载 context 节点(管理面 system/registry delete,§3.3)。 */
export const ctxUnmountCommand = defineCommand({
  meta: { name: 'unmount', description: 'Unmount a context namespace' },
  args: {
    ...globalArgs,
    path: { type: 'positional', description: 'Tree path to remove', required: true },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const path = String(args.path ?? '').trim()
      if (!path) throw new CliError('tree path is required')
      await deleteNode(resolveTarget(args), path, ['context'])
      if (asJson) printJson({ ok: true, path })
      else printLine(`unmounted context node: ${path}`)
    })
  },
})

export const ctxCommand = defineCommand({
  meta: { name: 'ctx', description: 'Context Layer: mount namespaces & read/write entries' },
  subCommands: {
    ls: ctxLsCommand,
    cat: ctxCatCommand,
    put: ctxPutCommand,
    patch: ctxPatchCommand,
    search: ctxSearchCommand,
    mount: ctxMountCommand,
    unmount: ctxUnmountCommand,
  },
})
