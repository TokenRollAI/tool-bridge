import { createReadStream, createWriteStream, openSync, statSync, unlinkSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { basename, extname } from 'node:path'
import { Readable } from 'node:stream'
import { Command } from 'commander'
import { once } from 'node:events'
import {
  apiJson,
  callDirect,
  CliError,
  fetchStoreRef,
  putStoreObject,
  type StorePutGrant,
  type Target,
} from '../http'
import { parsePageOpts, resolveTarget, withGlobalOpts, withPageOpts } from '../args'
import { guard, printJson, printLine, table } from '../output'
import { confirmDestructive } from '../confirm'

interface GlobalOpts {
  baseUrl?: string
  json?: boolean
  sk?: string
  timeout?: string
  yes?: boolean
}

interface StoreChecksum {
  algorithm: 'sha256'
  value: string
}

export interface StoreObjectDescriptor {
  checksum?: StoreChecksum
  contentType: string
  createdAt: string
  expiresAt?: string
  filename?: string
  originCallId?: string
  owner?: unknown
  producer?: unknown
  readyAt: string
  size: number
  status?: 'ready'
  updatedAt?: string
  uri: string
}

interface StorePage {
  cursor?: string
  items: StoreObjectDescriptor[]
}

interface StoreReadGrant {
  $ref: string
  contentType: string
  expiresAt: string
  size: number
}

interface StoreShareGrant {
  $ref: string
  expiresAt: string
  shareId: string
  uri: string
}

const STORE_PATH = '/system/store'
const STORE_URI_RE = /^store:\/\/default\/[A-Za-z0-9_-]+$/

function requireStoreUri(value: string): string {
  const uri = String(value ?? '').trim()
  if (!STORE_URI_RE.test(uri)) {
    throw new CliError('expected a Store URI like store://default/<objectId>')
  }
  return uri
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

/** 输出面统一裁剪 capability、签名 URL、headers 与内部 key。 */
export function sanitizeStoreOutput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeStoreOutput)
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (
      key === '$ref'
      || /^(?:url|headers|uploadToken|token|capability|driverKey)$/i.test(key)
    ) continue
    out[key] = sanitizeStoreOutput(item)
  }
  return out
}

function printObjects(page: StorePage): void {
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

type ParsedStoreCreate
  = | { descriptor: StoreObjectDescriptor, kind: 'completed' }
    | { grant: StorePutGrant, kind: 'upload' }

function parseStoreCreate(value: unknown): ParsedStoreCreate {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CliError('gateway returned an invalid Store upload grant', 'internal', true)
  }
  const grant = value as Record<string, unknown>
  if (grant.alreadyCompleted === true) {
    const descriptor = grant.descriptor
    if (descriptor === null || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
      throw new CliError('gateway returned an invalid completed Store upload', 'internal', true)
    }
    const object = descriptor as Record<string, unknown>
    if (
      typeof object.uri !== 'string'
      || !STORE_URI_RE.test(object.uri)
      || typeof object.contentType !== 'string'
      || typeof object.size !== 'number'
      || !Number.isSafeInteger(object.size)
      || object.size < 0
      || typeof object.createdAt !== 'string'
      || typeof object.readyAt !== 'string'
    ) throw new CliError('gateway returned an invalid completed Store upload', 'internal', true)
    return { kind: 'completed', descriptor: object as unknown as StoreObjectDescriptor }
  }
  if (grant.alreadyCompleted !== undefined && grant.alreadyCompleted !== false) {
    throw new CliError('gateway returned an invalid Store upload grant', 'internal', true)
  }
  if (
    typeof grant.uploadId !== 'string'
    || typeof grant.objectUri !== 'string'
    || !STORE_URI_RE.test(grant.objectUri)
    || (grant.transport !== 'relay' && grant.transport !== 'presigned-put')
    || grant.method !== 'PUT'
    || typeof grant.url !== 'string'
    || grant.headers === null
    || typeof grant.headers !== 'object'
    || Array.isArray(grant.headers)
    || !Object.values(grant.headers).every(header => typeof header === 'string')
    || typeof grant.expiresAt !== 'string'
    || typeof grant.maxBytes !== 'number'
    || typeof grant.uploadToken !== 'string'
  ) {
    throw new CliError('gateway returned an invalid Store upload grant', 'internal', true)
  }
  return { kind: 'upload', grant: grant as unknown as StorePutGrant }
}

async function completeDirectUpload(
  target: Target,
  grant: StorePutGrant,
): Promise<StoreObjectDescriptor> {
  try {
    return await apiJson<StoreObjectDescriptor>(
      { ...target, sk: undefined },
      {
        method: 'POST',
        path: `${STORE_PATH}/complete_upload`,
        headers: { 'x-tb-store-upload': grant.uploadToken },
        body: { uploadId: grant.uploadId },
      },
    )
  } catch (error) {
    const cli = error instanceof CliError ? error : undefined
    // 服务端若误把 capability/签名 URL 写入错误，也不能经 CLI 回显。
    throw new CliError('Store upload completion failed', cli?.code ?? 'unavailable', cli?.retryable)
  }
}

async function writeResponse(response: Response, out: string | undefined): Promise<void> {
  if (!response.body) throw new CliError('Store object download returned an empty body', 'internal', true)
  const source = Readable.fromWeb(response.body as never)
  if (out !== undefined) {
    let fd: number
    try {
      fd = openSync(out, 'wx')
    } catch (error) {
      throw new CliError(`cannot create --out "${out}": ${(error as Error).message}`)
    }
    try {
      await pipeline(source, createWriteStream(out, { fd, autoClose: true }))
    } catch (error) {
      // fd 由本次 openSync('wx') 创建，因此这里只清理本次下载的残片，不会删除既有文件。
      try {
        unlinkSync(out)
      } catch {
        // file may not have been created
      }
      throw new CliError(`cannot write --out "${out}": ${(error as Error).message}`)
    }
    return
  }
  for await (const chunk of source) {
    if (!process.stdout.write(chunk)) await once(process.stdout, 'drain')
  }
}

export function storeUploadCommand(): Command {
  return withGlobalOpts(new Command('upload'))
    .description('Upload a file to the deployment default Store (streaming)')
    .argument('<file>', 'Local file to upload')
    .option('--content-type <type>', 'MIME type (default: guessed from extension)')
    .option('--filename <name>', 'Display filename (default: local basename)')
    .option('--idempotency-key <key>', 'Owner-scoped create retry key')
    .action(async (fileArg: string, opts: GlobalOpts & {
      contentType?: string
      filename?: string
      idempotencyKey?: string
    }) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const file = String(fileArg)
        const size = fileSize(file)
        const contentType = String(opts.contentType ?? guessContentType(file)).trim()
        if (!contentType) throw new CliError('--content-type must not be empty')
        const filename = String(opts.filename ?? basename(file)).trim()
        if (!filename) throw new CliError('--filename must not be empty')
        const target = resolveTarget(opts)
        const created = parseStoreCreate(await callDirect<unknown>(
          target,
          `${STORE_PATH}/create_upload`,
          {
            contentType,
            filename,
            size,
            ...(opts.idempotencyKey ? { idempotencyKey: String(opts.idempotencyKey) } : {}),
          },
        ))
        if (created.kind === 'completed') {
          const safe = sanitizeStoreOutput(created.descriptor)
          if (asJson) printJson(safe)
          else printLine(`uploaded ${(safe as StoreObjectDescriptor).uri}`)
          return
        }
        const { grant } = created
        if (size > grant.maxBytes) {
          throw new CliError(`file size ${size} exceeds upload maxBytes ${grant.maxBytes}`)
        }
        const uploaded = await putStoreObject(
          grant,
          createReadStream(file) as unknown as NonNullable<RequestInit['body']>,
          target.timeoutMs,
        )
        const descriptor = grant.transport === 'relay'
          ? uploaded as StoreObjectDescriptor
          : await completeDirectUpload(target, grant)
        const safe = sanitizeStoreOutput(descriptor)
        if (asJson) printJson(safe)
        else printLine(`uploaded ${(safe as StoreObjectDescriptor).uri}`)
      })
    })
}

export function storeStatCommand(): Command {
  return withGlobalOpts(new Command('stat'))
    .description('Show metadata for an owned Store object')
    .argument('<store-uri>', 'store://default/<objectId>')
    .action(async (uriArg: string, opts: GlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const descriptor = await callDirect<StoreObjectDescriptor>(
          resolveTarget(opts), `${STORE_PATH}/stat`, { uri: requireStoreUri(uriArg) },
        )
        const safe = sanitizeStoreOutput(descriptor)
        if (asJson) printJson(safe)
        else printLine(table(
          ['URI', 'SIZE', 'TYPE', 'READY'],
          [[descriptor.uri, String(descriptor.size), descriptor.contentType, descriptor.readyAt]],
        ))
      })
    })
}

export function storeGetCommand(): Command {
  return withGlobalOpts(new Command('get'))
    .description('Stream an owned Store object to stdout or --out')
    .argument('<store-uri>', 'store://default/<objectId>')
    .option('--out <file>', 'Write to a new file instead of stdout')
    .action(async (uriArg: string, opts: GlobalOpts & { out?: string }) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        if (asJson && !opts.out) throw new CliError('--json requires --out for binary downloads')
        const uri = requireStoreUri(uriArg)
        const target = resolveTarget(opts)
        const read = await callDirect<StoreReadGrant>(target, `${STORE_PATH}/read`, { uri })
        if (
          typeof read?.$ref !== 'string'
          || typeof read.expiresAt !== 'string'
          || Date.parse(read.expiresAt) <= Date.now()
        ) throw new CliError('gateway returned an invalid Store read reference', 'internal', true)
        const response = await fetchStoreRef(read.$ref, target.timeoutMs)
        await writeResponse(response, opts.out ? String(opts.out) : undefined)
        if (opts.out) {
          if (asJson) printJson({ uri, out: String(opts.out), size: read.size })
          else printLine(`downloaded ${uri} to ${opts.out}`)
        }
      })
    })
}

export function storeShareCommand(): Command {
  return withGlobalOpts(new Command('share'))
    .description('Create a short-lived revocable Store share')
    .argument('<store-uri>', 'store://default/<objectId>')
    .option('--ttl <seconds>', 'Share lifetime in seconds')
    .action(async (uriArg: string, opts: GlobalOpts & { ttl?: string }) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const ttlSec = positiveInt(opts.ttl, '--ttl')
        const share = await callDirect<StoreShareGrant>(
          resolveTarget(opts), `${STORE_PATH}/share`,
          { uri: requireStoreUri(uriArg), ...(ttlSec === undefined ? {} : { ttlSec }) },
        )
        let shareUrl: URL
        try {
          shareUrl = new URL(share.$ref)
        } catch {
          throw new CliError('gateway returned an invalid Store share', 'internal', true)
        }
        if (
          typeof share.shareId !== 'string'
          || share.shareId === ''
          || requireStoreUri(share.uri) !== requireStoreUri(uriArg)
          || !Number.isFinite(Date.parse(share.expiresAt))
          || (shareUrl.protocol !== 'https:' && shareUrl.protocol !== 'http:')
          || shareUrl.username !== ''
          || shareUrl.password !== ''
        ) throw new CliError('gateway returned an invalid Store share', 'internal', true)

        // `$ref` is the requested deliverable of this explicit command. It is
        // emitted only on successful stdout/JSON; errors and stderr remain redacted.
        const result = { ...share, $ref: shareUrl.toString() }
        if (asJson) printJson(result)
        else {
          printLine(`created share ${share.shareId} (expires ${share.expiresAt})`)
          printLine(result.$ref)
        }
      })
    })
}

export function storeRevokeShareCommand(): Command {
  return withGlobalOpts(new Command('revoke-share'))
    .description('Revoke a Store share by id')
    .argument('<share-id>', 'Share grant id')
    .action(async (shareIdArg: string, opts: GlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const shareId = String(shareIdArg ?? '').trim()
        if (!shareId) throw new CliError('share id is required')
        await callDirect(resolveTarget(opts), `${STORE_PATH}/revoke_share`, { shareId })
        if (asJson) printJson({ ok: true, shareId })
        else printLine(`revoked share ${shareId}`)
      })
    })
}

export function storeRmCommand(): Command {
  return withGlobalOpts(new Command('rm'))
    .description('Delete an owned Store object')
    .argument('<store-uri>', 'store://default/<objectId>')
    .option('-y, --yes', 'Skip interactive confirmation')
    .action(async (uriArg: string, opts: GlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const uri = requireStoreUri(uriArg)
        await confirmDestructive(opts, `删除 Store 对象 ${uri}？此操作不可撤销。`)
        await callDirect(resolveTarget(opts), `${STORE_PATH}/delete`, { uri })
        if (asJson) printJson({ ok: true, uri })
        else printLine(`deleted ${uri}`)
      })
    })
}

export function storeListCommand(): Command {
  return withPageOpts(withGlobalOpts(new Command('list')))
    .alias('ls')
    .description('List Store objects owned by the current principal')
    .action(async (opts: GlobalOpts & { cursor?: string, limit?: string }) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const page = await callDirect<StorePage>(
          resolveTarget(opts), `${STORE_PATH}/list`, { opts: parsePageOpts(opts) },
        )
        const safe = sanitizeStoreOutput(page) as StorePage
        if (asJson) printJson(safe)
        else printObjects(safe)
      })
    })
}

export function storeCommand(): Command {
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
