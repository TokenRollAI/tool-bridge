import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { Command } from 'commander'
import type { ContextEntry, ContextEntryMeta, NodeConfig, NodeInput, Page } from '../types'
import {
  collect,
  parsePageOpts,
  resolveTarget,
  withGlobalOpts,
  withPageOpts,
} from '../args'
import { asArray, guard, printJson, printLine, table } from '../output'
import { deleteNode, registerNode } from '../registry'
import { callTool, CliError } from '../http'

/**
 * `tb ctx *` —— Context Layer 命令族。
 * 数据面四动词 + Search 走 `POST /<ns>` `{tool,arguments}`(cmd 名首字母大写);
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
  const rows = items.map(m => [
    m.uri,
    m.size !== undefined ? String(m.size) : '-',
    m.updatedAt ?? '',
  ])
  printLine(table(['URI', 'SIZE', 'UPDATED'], rows))
  if (page.cursor) printLine(`next cursor: ${page.cursor}`)
}

interface GlobalOpts {
  baseUrl?: string
  json?: boolean
  sk?: string
}

/** `tb ctx ls <ns> [prefix]` —— 浅层列表(ContextProvider.List)。 */
export function ctxLsCommand(): Command {
  return withPageOpts(withGlobalOpts(new Command('ls')))
    .description('List entries in a context namespace')
    .argument('<ns>', 'Context namespace tree path')
    .argument('[prefix]', 'Relative prefix inside namespace')
    .action(
      async (
        nsArg: string,
        prefix: string | undefined,
        opts: GlobalOpts & { cursor?: string, limit?: string },
      ) => {
        const asJson = Boolean(opts.json)
        await guard(asJson, async () => {
          const ns = String(nsArg ?? '').trim()
          if (!ns) throw new CliError('namespace path is required')
          const callOpts = parsePageOpts(opts)

          const page = await callTool<Page<ContextEntryMeta>>(
            resolveTarget(opts),
            nsUri(ns),
            'List',
            {
              path: prefix ? String(prefix) : '',
              ...(Object.keys(callOpts).length ? { opts: callOpts } : {}),
            },
          )
          if (asJson) printJson(page)
          else printEntries(page)
        })
      },
    )
}

/** `tb ctx cat <ns> <entry>` —— 读取 entry(ContextProvider.Get)。 */
export function ctxCatCommand(): Command {
  return withGlobalOpts(new Command('cat'))
    .description('Print a context entry')
    .argument('<ns>', 'Context namespace tree path')
    .argument('<entry>', 'Entry path inside namespace')
    .action(async (nsArg: string, entryArg: string, opts: GlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const ns = String(nsArg ?? '').trim()
        if (!ns) throw new CliError('namespace path is required')
        const entryPath = String(entryArg ?? '').trim()
        if (!entryPath) throw new CliError('entry path is required')

        const entry = await callTool<ContextEntry>(resolveTarget(opts), nsUri(ns), 'Get', {
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
          // 大对象:content = { $ref: <预签名 URL> }。
          process.stderr.write('large object, download via URL\n')
          printLine(String((content as { $ref: unknown }).$ref))
        } else {
          printJson(content)
        }
      })
    })
}

/** `tb ctx put <ns> <entry>` —— 创建/整体替换(ContextProvider.Write,幂等 upsert)。 */
export function ctxPutCommand(): Command {
  return withGlobalOpts(new Command('put'))
    .description('Write (create or replace) a context entry')
    .argument('<ns>', 'Context namespace tree path')
    .argument('<entry>', 'Entry path inside namespace')
    .option('--file <file>', 'Read content from file')
    .option('--content <content>', 'Inline content (mutually exclusive with --file)')
    .option('--content-type <type>', 'Content type (default: guessed from --file)')
    .option('--meta <kv>', 'Metadata "key=value" (repeatable)', collect, [])
    .option('--if-version <version>', 'Optimistic concurrency: expected version')
    .action(
      async (
        nsArg: string,
        entryArg: string,
        opts: GlobalOpts & {
          content?: string
          contentType?: string
          file?: string
          ifVersion?: string
          meta: string[]
        },
      ) => {
        const asJson = Boolean(opts.json)
        await guard(asJson, async () => {
          const ns = String(nsArg ?? '').trim()
          if (!ns) throw new CliError('namespace path is required')
          const entryPath = String(entryArg ?? '').trim()
          if (!entryPath) throw new CliError('entry path is required')

          const metadata = parseMeta(opts.meta)
          const file = opts.file ? String(opts.file) : undefined
          if (opts.content !== undefined && opts.file !== undefined) {
            throw new CliError('--content and --file are mutually exclusive')
          }
          let content: string
          if (opts.content !== undefined) content = String(opts.content)
          else if (file) content = readContentFile(file)
          else {
            if (process.stdin.isTTY) throw new CliError('pass --content/--file or pipe content via stdin')
            content = readStdin()
          }
          const contentType = opts.contentType
            ? String(opts.contentType)
            : guessContentType(opts.content === undefined ? file : undefined)

          const meta = await callTool<ContextEntryMeta>(resolveTarget(opts), nsUri(ns), 'Write', {
            path: entryPath,
            entry: {
              contentType,
              content,
              ...(metadata ? { metadata } : {}),
              ...(opts.ifVersion ? { ifVersion: String(opts.ifVersion) } : {}),
            },
          })
          if (asJson) printJson(meta)
          else printLine(`wrote ${meta.uri ?? entryPath}`)
        })
      },
    )
}

/** `tb ctx patch <ns> <entry>` —— 部分更新(ContextProvider.Update,不存在 → not_found)。 */
export function ctxPatchCommand(): Command {
  return withGlobalOpts(new Command('patch'))
    .description('Update content and/or metadata of a context entry')
    .argument('<ns>', 'Context namespace tree path')
    .argument('<entry>', 'Entry path inside namespace')
    .option('--file <file>', 'Read new content from file')
    .option('--content <content>', 'Inline new content (mutually exclusive with --file)')
    .option('--meta <kv>', 'Metadata "key=value" to merge (repeatable)', collect, [])
    .option('--if-version <version>', 'Optimistic concurrency: expected version')
    .action(
      async (
        nsArg: string,
        entryArg: string,
        opts: GlobalOpts & {
          content?: string
          file?: string
          ifVersion?: string
          meta: string[]
        },
      ) => {
        const asJson = Boolean(opts.json)
        await guard(asJson, async () => {
          const ns = String(nsArg ?? '').trim()
          if (!ns) throw new CliError('namespace path is required')
          const entryPath = String(entryArg ?? '').trim()
          if (!entryPath) throw new CliError('entry path is required')

          const metadata = parseMeta(opts.meta)
          if (opts.content !== undefined && opts.file !== undefined) {
            throw new CliError('--content and --file are mutually exclusive')
          }
          let content: string | undefined
          if (opts.content !== undefined) content = String(opts.content)
          else if (opts.file) content = readContentFile(String(opts.file))
          if (content === undefined && !metadata) {
            throw new CliError('nothing to update: pass --content/--file and/or --meta')
          }

          const meta = await callTool<ContextEntryMeta>(resolveTarget(opts), nsUri(ns), 'Update', {
            path: entryPath,
            patch: {
              ...(content !== undefined ? { content } : {}),
              ...(metadata ? { metadata } : {}),
              ...(opts.ifVersion ? { ifVersion: String(opts.ifVersion) } : {}),
            },
          })
          if (asJson) printJson(meta)
          else printLine(`updated ${meta.uri ?? entryPath}`)
        })
      },
    )
}

/** `tb ctx search <ns> <query>` —— 检索(ContextProvider.Search,可选能力)。 */
export function ctxSearchCommand(): Command {
  return withPageOpts(withGlobalOpts(new Command('search')))
    .description('Search entries in a context namespace')
    .argument('<ns>', 'Context namespace tree path')
    .argument('<query>', 'Search query')
    .option('--mode <mode>', 'Search mode: keyword | semantic (default keyword)')
    .action(
      async (
        nsArg: string,
        queryArg: string,
        opts: GlobalOpts & { cursor?: string, limit?: string, mode?: string },
      ) => {
        const asJson = Boolean(opts.json)
        await guard(asJson, async () => {
          const ns = String(nsArg ?? '').trim()
          if (!ns) throw new CliError('namespace path is required')
          const query = String(queryArg ?? '').trim()
          if (!query) throw new CliError('query is required')
          const mode = opts.mode ? String(opts.mode) : undefined
          if (mode !== undefined && mode !== 'keyword' && mode !== 'semantic') {
            throw new CliError(`invalid --mode "${mode}"; valid: keyword, semantic`)
          }
          const callOpts: Record<string, unknown> = parsePageOpts(opts)
          if (mode) callOpts.mode = mode

          const page = await callTool<Page<ContextEntryMeta>>(
            resolveTarget(opts),
            nsUri(ns),
            'Search',
            { query, ...(Object.keys(callOpts).length ? { opts: callOpts } : {}) },
          )
          if (asJson) printJson(page)
          else printEntries(page)
        })
      },
    )
}

/** `tb ctx rm <ns> <entry>` —— 删除 context entry(ContextProvider.Delete)。 */
export function ctxRmCommand(): Command {
  return withGlobalOpts(new Command('rm'))
    .description('Delete a context entry')
    .argument('<ns>', 'Context namespace tree path')
    .argument('<entry>', 'Entry path inside namespace')
    .action(async (nsArg: string, entryArg: string, opts: GlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const ns = String(nsArg ?? '').trim()
        if (!ns) throw new CliError('namespace path is required')
        const entryPath = String(entryArg ?? '').trim()
        if (!entryPath) throw new CliError('entry path is required')
        await callTool(resolveTarget(opts), nsUri(ns), 'Delete', { path: entryPath })
        if (asJson) printJson({ ok: true, path: entryPath })
        else printLine(`deleted ${entryPath}`)
      })
    })
}

/**
 * `tb ctx mount <path> --provider r2|s3` —— 挂载 context namespace
 * (NodeRegistry.Write{kind:'context'} via ~register;tool.ts mount 同通道)。
 * providerConfig:r2 `{prefix?}`;s3 `{endpoint,bucket,region?,prefix?}` 且 --auth-ref 必填。
 */
export function ctxMountCommand(): Command {
  return withGlobalOpts(new Command('mount'))
    .description('Mount a context namespace (r2, s3, or a context-provider plugin)')
    .argument('<path>', 'Tree path to mount at')
    .requiredOption('--provider <provider>', 'Provider: r2 | s3 | <context-provider plugin id>')
    .option('--description <desc>', 'One-line node description (default: auto-generated)')
    .option('--auth-ref <ref>', 'SecretStore credential ref ([s3] required; [plugin] optional)')
    .option('--read-only', 'Reject write verbs (Write/Update/Delete)')
    .option('--ttl <seconds>', 'Node TTL in seconds (expired node is reclaimed)')
    .option('--prefix <prefix>', '[r2/s3] key prefix inside the bucket')
    .option('--endpoint <url>', '[s3] S3-compatible endpoint URL')
    .option('--bucket <bucket>', '[s3] bucket name')
    .option('--region <region>', '[s3] region')
    .action(
      async (
        pathArg: string,
        opts: GlobalOpts & {
          authRef?: string
          bucket?: string
          description?: string
          endpoint?: string
          prefix?: string
          provider: string
          readOnly?: boolean
          region?: string
          ttl?: string
        },
      ) => {
        const asJson = Boolean(opts.json)
        await guard(asJson, async () => {
          const path = String(pathArg ?? '').trim()
          if (!path) throw new CliError('tree path is required')
          const provider = String(opts.provider ?? '').trim()
          const authRef = opts.authRef ? String(opts.authRef) : undefined
          const prefix = opts.prefix ? String(opts.prefix) : undefined
          const ttl = parsePositiveInt(opts.ttl, '--ttl')

          let providerConfig: Record<string, unknown> | undefined
          if (provider === 'r2') {
            if (opts.endpoint || opts.bucket || opts.region || authRef) {
              throw new CliError('--endpoint/--bucket/--region/--auth-ref only apply to s3')
            }
            if (prefix) providerConfig = { prefix }
          } else if (provider === 's3') {
            const endpoint = String(opts.endpoint ?? '').trim()
            if (!endpoint) throw new CliError('--endpoint is required for --provider s3')
            const bucket = String(opts.bucket ?? '').trim()
            if (!bucket) throw new CliError('--bucket is required for --provider s3')
            if (!authRef) throw new CliError('--auth-ref is required for --provider s3')
            providerConfig = {
              endpoint,
              bucket,
              ...(opts.region ? { region: String(opts.region) } : {}),
              ...(prefix ? { prefix } : {}),
            }
          } else {
            if (opts.endpoint || opts.bucket || opts.region || prefix) {
              throw new CliError(
                '--endpoint/--bucket/--region/--prefix are not supported for plugin providers',
              )
            }
          }

          const config: NodeConfig = {
            kind: 'context',
            provider,
            ...(providerConfig ? { providerConfig } : {}),
            ...(authRef ? { authRef } : {}),
            ...(opts.readOnly ? { readOnly: true } : {}),
            ...(ttl !== undefined ? { ttl } : {}),
          }
          const input: NodeInput = {
            path,
            kind: 'context',
            description: opts.description ? String(opts.description) : `context at ${path}`,
            config,
          }

          const node = await registerNode(resolveTarget(opts), input)
          if (asJson) printJson(node)
          else printLine(`mounted context node at ${path} (provider ${provider})`)
        })
      },
    )
}

/** `tb ctx unmount <path>` —— 卸载 context 节点(管理面 system/registry delete)。 */
export function ctxUnmountCommand(): Command {
  return withGlobalOpts(new Command('unmount'))
    .description('Unmount a context namespace')
    .argument('<path>', 'Tree path to remove')
    .action(async (pathArg: string, opts: GlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const path = String(pathArg ?? '').trim()
        if (!path) throw new CliError('tree path is required')
        await deleteNode(resolveTarget(opts), path, ['context'])
        if (asJson) printJson({ ok: true, path })
        else printLine(`unmounted context node: ${path}`)
      })
    })
}

export function ctxCommand(): Command {
  return new Command('ctx')
    .description('Context Layer: mount namespaces & read/write entries')
    .addHelpText(
      'after',
      `
Examples:
  tb ctx mount notes --provider r2 --description "team notes"
  tb ctx put notes meeting/2026-07.md --file ./notes.md
  tb ctx cat notes meeting/2026-07.md
  tb ctx search notes "budget"`,
    )
    .addCommand(ctxLsCommand())
    .addCommand(ctxCatCommand())
    .addCommand(ctxPutCommand())
    .addCommand(ctxPatchCommand())
    .addCommand(ctxRmCommand())
    .addCommand(ctxSearchCommand())
    .addCommand(ctxMountCommand())
    .addCommand(ctxUnmountCommand())
}
