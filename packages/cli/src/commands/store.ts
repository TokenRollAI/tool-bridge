import {
  createStoreClient,
  parseStoreUri,
  type StoreClient,
  type StoreListPage,
  type StoreUri,
  TBError,
} from '@tool-bridge/sdk/store'
import { createReadStream, createWriteStream, openSync, statSync, unlinkSync } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { basename, extname } from 'node:path'
import { Command } from 'commander'
import { once } from 'node:events'
import { parsePageOpts, resolveTarget, withGlobalOpts, withPageOpts } from '../args'
import { CliError, DEFAULT_TIMEOUT_MS, getFetch, requireTarget } from '../http'
import { printJson, printLine, table } from '../output'
import { confirmDestructive } from '../confirm'

interface GlobalOpts {
  baseUrl?: string
  json?: boolean
  sk?: string
  timeout?: string
  yes?: boolean
}

interface StoreRuntime {
  client: StoreClient
  timeoutMs: number
}

/** CLI 的 --timeout 是单请求预算；Store create/PUT/complete 必须各自重新计时。 */
function withRequestTimeout(fetcher: typeof fetch, timeoutMs: number): typeof fetch {
  return async (input, init = {}) => {
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = init.signal == null
      ? timeout
      : AbortSignal.any([init.signal, timeout])
    try {
      return await fetcher(input, { ...init, signal })
    } catch (error) {
      if (timeout.aborted && init.signal?.aborted !== true) {
        const timeoutError = new Error('request timed out')
        timeoutError.name = 'AbortError'
        throw timeoutError
      }
      throw error
    }
  }
}

function asCliError(error: unknown, timeoutMs?: number): Error {
  if (error instanceof CliError) return error
  if (error instanceof TBError) {
    return new CliError(error.message, error.code, error.retryable)
  }
  if (
    error instanceof Error
    && (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    const suffix = timeoutMs === undefined
      ? ''
      : ` after ${Math.round(timeoutMs / 1000)}s`
    return new CliError(
      `request timed out${suffix} — the upstream may still be processing; retry or raise --timeout`,
      'unavailable',
      true,
    )
  }
  return error instanceof Error ? error : new Error(String(error))
}

function requireStoreUri(value: unknown): StoreUri {
  try {
    return parseStoreUri(String(value ?? '').trim())
  } catch (error) {
    throw asCliError(error)
  }
}

function storeRuntime(opts: GlobalOpts): StoreRuntime {
  const target = resolveTarget(opts)
  const { baseUrl, sk } = requireTarget(target)
  const timeoutMs = target.timeoutMs ?? DEFAULT_TIMEOUT_MS
  try {
    return {
      client: createStoreClient({
        baseUrl,
        sk: sk ?? '',
        fetcher: withRequestTimeout(getFetch(), timeoutMs),
      }),
      timeoutMs,
    }
  } catch (error) {
    throw asCliError(error, timeoutMs)
  }
}

async function useStore<T>(
  opts: GlobalOpts,
  operation: (client: StoreClient) => Promise<T>,
): Promise<T> {
  const runtime = storeRuntime(opts)
  try {
    return await operation(runtime.client)
  } catch (error) {
    throw asCliError(error, runtime.timeoutMs)
  }
}

function positiveInt(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 1) throw new CliError(`${flag} must be a positive integer`)
  return n
}

function guessContentType(file: string): string {
  switch (extname(file).toLowerCase()) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.mp4': return 'video/mp4'
    case '.mov': return 'video/quicktime'
    case '.webm': return 'video/webm'
    case '.mp3': return 'audio/mpeg'
    case '.wav': return 'audio/wav'
    case '.json': return 'application/json'
    case '.pdf': return 'application/pdf'
    case '.md': return 'text/markdown'
    case '.txt': return 'text/plain'
    default: return 'application/octet-stream'
  }
}

function fileSize(file: string): number {
  try {
    const stat = statSync(file)
    if (!stat.isFile()) throw new Error('not a regular file')
    return stat.size
  } catch (error) {
    throw new CliError(`cannot read file "${file}": ${(error as Error).message}`)
  }
}

function printObjects(page: StoreListPage): void {
  if (page.items.length === 0) {
    printLine('(no Store objects)')
    return
  }
  printLine(table(
    ['URI', 'SIZE', 'TYPE', 'READY'],
    page.items.map(item => [item.uri, String(item.size), item.contentType, item.readyAt]),
  ))
  if (page.cursor) printLine(`next cursor: ${page.cursor}`)
}

async function writeResponse(response: Response, out: string | undefined): Promise<number> {
  if (!response.body) throw new CliError('Store object download returned an empty body', 'internal', true)
  let bytes = 0
  if (out !== undefined) {
    let fd: number
    try {
      fd = openSync(out, 'wx')
    } catch (error) {
      await response.body.cancel().catch(() => {})
      throw new CliError(`cannot create --out "${out}": ${(error as Error).message}`)
    }
    const source = Readable.fromWeb(response.body as never)
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += Buffer.byteLength(chunk)
        callback(null, chunk)
      },
    })
    try {
      await pipeline(source, counter, createWriteStream(out, { fd, autoClose: true }))
    } catch (error) {
      // fd 由本次 openSync('wx') 创建，因此这里只清理本次下载的残片，不会删除既有文件。
      try {
        unlinkSync(out)
      } catch {
        // file may not have been created
      }
      throw new CliError(`cannot write --out "${out}": ${(error as Error).message}`)
    }
    return bytes
  }
  const source = Readable.fromWeb(response.body as never)
  for await (const chunk of source) {
    bytes += Buffer.byteLength(chunk)
    if (!process.stdout.write(chunk)) await once(process.stdout, 'drain')
  }
  return bytes
}

export function storeUploadCommand() {
  return withGlobalOpts(new Command('upload'))
    .description('Upload a file to the deployment default Store (streaming)')
    .argument('<file>', 'Local file to upload')
    .option('--content-type <type>', 'MIME type (default: guessed from extension)')
    .option('--filename <name>', 'Display filename (default: local basename)')
    .option('--idempotency-key <key>', 'Owner-scoped create retry key')
    .action(async (fileArg, opts) => {
      const asJson = Boolean(opts.json)
      const file = String(fileArg)
      const size = fileSize(file)
      const contentType = String(opts.contentType ?? guessContentType(file)).trim()
      if (!contentType) throw new CliError('--content-type must not be empty')
      const filename = String(opts.filename ?? basename(file)).trim()
      if (!filename) throw new CliError('--filename must not be empty')

      const input = createReadStream(file)
      try {
        const descriptor = await useStore(opts, async client => await client.upload({
          body: Readable.toWeb(input),
          contentType,
          filename,
          size,
          ...(opts.idempotencyKey
            ? { idempotencyKey: String(opts.idempotencyKey) }
            : {}),
        }))
        if (asJson) printJson(descriptor)
        else printLine(`uploaded ${descriptor.uri}`)
      } finally {
        input.destroy()
      }
    })
}

export function storeStatCommand() {
  return withGlobalOpts(new Command('stat'))
    .description('Show metadata for an owned Store object')
    .argument('<store-uri>', 'store://default/<objectId>')
    .action(async (uriArg, opts) => {
      const asJson = Boolean(opts.json)
      const uri = requireStoreUri(uriArg)
      const descriptor = await useStore(opts, async client => await client.stat(uri))
      if (asJson) printJson(descriptor)
      else printLine(table(
        ['URI', 'SIZE', 'TYPE', 'READY'],
        [[descriptor.uri, String(descriptor.size), descriptor.contentType, descriptor.readyAt]],
      ))
    })
}

export function storeGetCommand() {
  return withGlobalOpts(new Command('get'))
    .description('Stream an owned Store object to stdout or --out')
    .argument('<store-uri>', 'store://default/<objectId>')
    .option('--out <file>', 'Write to a new file instead of stdout')
    .action(async (uriArg, opts) => {
      const asJson = Boolean(opts.json)
      if (asJson && !opts.out) throw new CliError('--json requires --out for binary downloads')
      const uri = requireStoreUri(uriArg)
      const response = await useStore(opts, async client => await client.download(uri))
      const out = opts.out === undefined ? undefined : String(opts.out)
      const size = await writeResponse(response, out)
      if (out) {
        if (asJson) printJson({ uri, out, size })
        else printLine(`downloaded ${uri} to ${out}`)
      }
    })
}

export function storeShareCommand() {
  return withGlobalOpts(new Command('share'))
    .description('Create a short-lived revocable Store share')
    .argument('<store-uri>', 'store://default/<objectId>')
    .option('--ttl <seconds>', 'Share lifetime in seconds')
    .action(async (uriArg, opts) => {
      const asJson = Boolean(opts.json)
      const uri = requireStoreUri(uriArg)
      const ttlSec = positiveInt(opts.ttl, '--ttl')
      const share = await useStore(opts, async client => await client.share(uri, {
        ...(ttlSec === undefined ? {} : { ttlSec }),
      }))

      // `$ref` 是该显式命令的交付物；SDK 已按白名单验证响应，错误面仍保持脱敏。
      if (asJson) printJson(share)
      else {
        printLine(`created share ${share.shareId} (expires ${share.expiresAt})`)
        printLine(share.$ref)
      }
    })
}

export function storeRevokeShareCommand() {
  return withGlobalOpts(new Command('revoke-share'))
    .description('Revoke a Store share by id')
    .argument('<share-id>', 'Share grant id')
    .action(async (shareIdArg, opts) => {
      const asJson = Boolean(opts.json)
      const shareId = String(shareIdArg ?? '').trim()
      if (!shareId) throw new CliError('share id is required')
      await useStore(opts, async client => await client.revokeShare(shareId))
      if (asJson) printJson({ ok: true, shareId })
      else printLine(`revoked share ${shareId}`)
    })
}

export function storeRmCommand() {
  return withGlobalOpts(new Command('rm'))
    .description('Delete an owned Store object')
    .argument('<store-uri>', 'store://default/<objectId>')
    .option('-y, --yes', 'Skip interactive confirmation')
    .action(async (uriArg, opts) => {
      const asJson = Boolean(opts.json)
      const uri = requireStoreUri(uriArg)
      await confirmDestructive(opts, `删除 Store 对象 ${uri}？此操作不可撤销。`)
      await useStore(opts, async client => await client.delete(uri))
      if (asJson) printJson({ ok: true, uri })
      else printLine(`deleted ${uri}`)
    })
}

export function storeListCommand() {
  return withPageOpts(withGlobalOpts(new Command('list')))
    .alias('ls')
    .description('List Store objects owned by the current principal')
    .action(async (opts) => {
      const asJson = Boolean(opts.json)
      const pageOpts = parsePageOpts(opts)
      const page = await useStore(opts, async client => await client.list({
        ...pageOpts,
      }))
      if (asJson) printJson(page)
      else printObjects(page)
    })
}

export function storeCommand() {
  return new Command('store')
    .description('Manage deployment-level objects in the default Store')
    .addCommand(storeUploadCommand())
    .addCommand(storeStatCommand())
    .addCommand(storeGetCommand())
    .addCommand(storeShareCommand())
    .addCommand(storeRevokeShareCommand())
    .addCommand(storeRmCommand())
    .addCommand(storeListCommand())
    .addHelpText('after', `
Examples:
  tb store upload ./capture.jpg
  tb store list --json
  tb store get store://default/<objectId> --out ./capture.jpg
  tb store share store://default/<objectId> --ttl 3600

Store objects are independent from Context entries. Use \`tb ctx upload\` only when authoring a
named binary entry into a specific semantic Context.`)
}
