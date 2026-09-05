import type { S3StoreConfig } from '@tool-bridge/app'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import {
  isTBError,
  type ObjectBody,
  type ObjectBodyStream,
  type ObjectMeta,
  type ObjectStore,
  TBError,
} from '@tool-bridge/core'
import { createReadStream, createWriteStream } from 'node:fs'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { finished, pipeline } from 'node:stream/promises'
/** Official AWS SDK protocol adapter, deliberately confined to the Node host. */
import { Readable, Transform } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { s3Network, type S3NetworkOptions } from './s3Network'

export interface S3ObjectStoreOptions extends S3NetworkOptions {
  maxObjectBytes?: number
  requestTimeoutMs?: number
}

export interface S3ObjectStore extends ObjectStore {
  close(): void
}

function s3Error(operation: string, error: unknown): TBError {
  if (isTBError(error)) return error
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode
  if (status === 403)
    return new TBError('permission_denied', `S3 ${operation} was denied`)
  if (status === 404)
    return TBError.notFound(`S3 ${operation} object not found`)
  if (status === 409 || status === 412)
    return new TBError('conflict', `S3 ${operation} condition failed`)
  // No upstream body, endpoint, signed headers or credential-bearing exception is exposed.
  return new TBError(
    'unavailable',
    `S3 ${operation} failed${status ? ` (${status})` : ''}`,
    { retryable: true },
  )
}

function meta(
  key: string,
  result: {
    ContentLength?: number
    ContentType?: string
    ETag?: string
    LastModified?: Date
    Metadata?: Record<string, string>
  },
): ObjectMeta {
  return {
    key,
    etag: (result.ETag ?? '').replace(/^"|"$/g, ''),
    size: result.ContentLength ?? 0,
    updatedAt: result.LastModified?.toISOString() ?? '',
    ...(result.ContentType !== undefined
      ? { contentType: result.ContentType }
      : {}),
    ...(result.Metadata !== undefined ? { metadata: result.Metadata } : {}),
  }
}

function limitError(): TBError {
  return new TBError(
    'invalid_argument',
    'S3 object exceeds the configured byte limit',
  )
}

/** Wrap a stream with a byte cap without buffering it or losing cancellation. */
function bounded(source: Readable, maxBytes: number): Readable {
  let total = 0
  const output = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.byteLength
      callback(
        total > maxBytes ? limitError() : null,
        total > maxBytes ? undefined : chunk,
      )
    },
  })
  source.on('error', error => output.destroy(error))
  output.on('close', () => source.destroy())
  source.pipe(output)
  return output
}

async function uploadBody(
  body: ObjectBody,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ body: Buffer | Readable, dispose(): Promise<void>, length: number }> {
  if (
    typeof body === 'string'
    || body instanceof Uint8Array
    || body instanceof ArrayBuffer
  ) {
    const value
      = typeof body === 'string'
        ? Buffer.from(body)
        : body instanceof ArrayBuffer
          ? Buffer.from(body)
          : Buffer.from(body.buffer, body.byteOffset, body.byteLength)
    if (value.length > maxBytes) throw limitError()
    return { body: value, length: value.length, dispose: async () => {} }
  }
  const reader = body.getReader()
  let total = 0
  let complete = false
  let cancelRequested = false
  const cancel = () => {
    if (complete || cancelRequested) return
    cancelRequested = true
    void reader.cancel?.(signal.reason).catch(() => {})
  }
  async function readNext() {
    signal.throwIfAborted()
    let onAbort: () => void = () => {}
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => {
        cancel()
        reject(signal.reason)
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      return await Promise.race([reader.read(), aborted])
    } finally {
      // A shared, never-resolved abort promise would retain a reaction per chunk.
      signal.removeEventListener('abort', onAbort)
    }
  }
  const stream = Readable.from(
    (async function* () {
      try {
        for (;;) {
          const { done, value } = await readNext()
          if (done) {
            complete = true
            break
          }
          if (!value) continue
          total += value.byteLength
          if (total > maxBytes) throw limitError()
          yield value
        }
      } finally {
        cancel()
      }
    })(),
    { objectMode: false, highWaterMark: 64 * 1024 },
  )
  let directory: string | undefined
  try {
    // Use an exact Content-Length instead of relying on unknown-length chunked
    // PUT support. Spool with backpressure rather than buffering maxBytes in RAM.
    directory = await mkdtemp(join(tmpdir(), 'tb-s3-upload-'))
    const path = join(directory, 'body')
    await pipeline(stream, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal })
    const file = createReadStream(path)
    const uploadDirectory = directory
    return {
      body: file,
      length: total,
      async dispose() {
        file.destroy()
        await finished(file, { cleanup: true }).catch(() => {})
        await rm(uploadDirectory, { recursive: true, force: true })
      },
    }
  } catch (error) {
    stream.destroy()
    if (directory) await rm(directory, { recursive: true, force: true })
    throw error
  } finally {
    cancel()
    reader.releaseLock()
  }
}

export function createS3ObjectStore(
  config: S3StoreConfig,
  options: S3ObjectStoreOptions = {},
): S3ObjectStore {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket)) {
    throw new TBError(
      'invalid_argument',
      'S3 bucket must be a valid bucket name',
    )
  }
  if (!config.accessKeyId || !config.secretAccessKey)
    throw new TBError('invalid_argument', 'S3 credentials are required')
  const maxBytes = options.maxObjectBytes ?? 1024 * 1024 * 1024
  const timeout = options.requestTimeoutMs ?? 30_000
  if (
    !Number.isSafeInteger(maxBytes)
    || maxBytes < 1
    || !Number.isSafeInteger(timeout)
    || timeout < 1
  ) {
    throw new TBError(
      'invalid_argument',
      'S3 limits must be positive safe integers',
    )
  }
  const network = s3Network(config.endpoint, options)
  const handler = new NodeHttpHandler({
    ...network,
    connectionTimeout: Math.min(timeout, 5000),
    requestTimeout: timeout,
    throwOnRequestTimeout: true,
  })
  const client = new S3Client({
    endpoint: network.endpoint,
    region: config.region ?? 'us-east-1',
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
    followRegionRedirects: false,
    maxAttempts: 1,
    // Avoid implicit streaming checksum trailers unsupported by some S3 services.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: {
      async handle(
        request: Parameters<NodeHttpHandler['handle']>[0],
        opts: Parameters<NodeHttpHandler['handle']>[1],
      ) {
        const hostname = request.hostname.includes(':') && !request.hostname.startsWith('[')
          ? `[${request.hostname}]`
          : request.hostname
        const actualOrigin = new URL(`${request.protocol}//${hostname}${request.port ? `:${request.port}` : ''}`).origin
        if (actualOrigin !== network.endpoint) {
          throw new TBError(
            'permission_denied',
            'S3 network policy rejected a changed origin',
          )
        }
        const response = await handler.handle(request, opts)
        if (response.response.body instanceof Readable) {
          const objectGet
            = request.method === 'GET'
              && request.query?.['list-type'] === undefined
              && response.response.statusCode >= 200
              && response.response.statusCode < 300
          response.response.body = bounded(
            response.response.body,
            objectGet ? maxBytes : 2 * 1024 * 1024,
          )
        }
        return response
      },
      destroy: () => handler.destroy(),
    },
  })

  async function run<T>(
    operation: string,
    execute: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    timer.unref()
    try {
      return await execute(controller.signal)
    } catch (error) {
      throw s3Error(operation, error)
    } finally {
      clearTimeout(timer)
    }
  }

  const head = async (key: string, signal?: AbortSignal): Promise<ObjectMeta | null> => {
    try {
      const execute = async (signal: AbortSignal) =>
        meta(
          key,
          await client.send(
            new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
            { abortSignal: signal },
          ),
        )
      return signal ? await execute(signal) : await run('HEAD', execute)
    } catch (error) {
      const normalized = s3Error('HEAD', error)
      if (normalized.code === 'not_found') return null
      throw normalized
    }
  }

  return {
    close: () => client.destroy(),
    head,
    async get(key) {
      const controller = new AbortController()
      let stream: Readable | undefined
      const timer = setTimeout(() => {
        controller.abort()
        stream?.destroy(new TBError('unavailable', 'S3 GET deadline exceeded'))
      }, timeout)
      timer.unref()
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: key }),
          { abortSignal: controller.signal },
        )
        if (!(result.Body instanceof Readable))
          throw new TBError(
            'unavailable',
            'S3 GET did not return a Node stream',
          )
        stream = result.Body
        if ((result.ContentLength ?? 0) > maxBytes) {
          stream.destroy()
          throw limitError()
        }
        stream.on('close', () => clearTimeout(timer))
        stream.on('error', () => {}) // Failure is observed by the reader, even when consumption starts later.
        const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>
        return { meta: meta(key, result), body: body as ObjectBodyStream }
      } catch (error) {
        clearTimeout(timer)
        stream?.destroy()
        const normalized = s3Error('GET', error)
        if (normalized.code === 'not_found') return null
        throw normalized
      }
    },
    async put(key, body, opts) {
      if (opts?.ifMatchEtag !== undefined && opts.ifNoneMatch !== undefined)
        throw new TBError(
          'invalid_argument',
          'S3 conditional write modes are mutually exclusive',
        )
      return run('PUT', async (signal) => {
        const upload = await uploadBody(body, maxBytes, signal)
        const uploadController = new AbortController()
        if (upload.body instanceof Readable)
          upload.body.on('error', () => uploadController.abort())
        try {
          try {
            await client.send(
              new PutObjectCommand({
                Bucket: config.bucket,
                Key: key,
                Body: upload.body,
                ContentLength: upload.length,
                ContentType: opts?.contentType,
                Metadata: opts?.metadata,
                IfNoneMatch: opts?.ifNoneMatch,
                IfMatch:
                opts?.ifMatchEtag !== undefined
                  ? `"${opts.ifMatchEtag}"`
                  : undefined,
              }),
              { abortSignal: AbortSignal.any([signal, uploadController.signal]) },
            )
          } catch (error) {
            const normalized = s3Error('PUT', error)
            if (opts?.ifMatchEtag !== undefined && normalized.code === 'not_found')
              throw new TBError('conflict', 'S3 PUT condition failed')
            throw normalized
          }
          const stored = await head(key, signal)
          if (!stored)
            throw new TBError('unavailable', 'S3 PUT was not observable by HEAD', {
              retryable: true,
            })
          return stored
        } finally {
          await upload.dispose()
        }
      })
    },
    async delete(key) {
      try {
        await run('DELETE', signal =>
          client.send(
            new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
            { abortSignal: signal },
          ),
        )
      } catch (error) {
        if (!isTBError(error) || error.code !== 'not_found') throw error
      }
    },
    async list(prefix, opts) {
      const result = await run('LIST', signal =>
        client.send(
          new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: prefix,
            Delimiter: opts?.delimiter,
            ContinuationToken: opts?.cursor,
            MaxKeys: Math.min(opts?.limit ?? 1000, 1000),
          }),
          { abortSignal: signal },
        ),
      )
      const entries = [
        ...(result.Contents ?? []).flatMap(item =>
          item.Key === undefined
            ? []
            : [
                {
                  order: item.Key,
                  item: meta(item.Key, {
                    ETag: item.ETag,
                    ContentLength: item.Size,
                    LastModified: item.LastModified,
                  }),
                },
              ],
        ),
        ...(result.CommonPrefixes ?? []).flatMap(item =>
          item.Prefix === undefined
            ? []
            : [{ order: item.Prefix, item: { prefix: item.Prefix } }],
        ),
      ].sort((left, right) =>
        left.order < right.order ? -1 : left.order > right.order ? 1 : 0,
      )
      if (result.IsTruncated && !result.NextContinuationToken)
        throw new TBError(
          'unavailable',
          'S3 LIST returned a truncated page without a cursor',
        )
      return {
        items: entries.map(entry => entry.item),
        ...(result.IsTruncated ? { cursor: result.NextContinuationToken } : {}),
      }
    },
    // Relay is intentional. A signer alone does not prove browser reachability,
    // exact Content-Length enforcement, CORS or create-only wire guarantees.
  }
}
