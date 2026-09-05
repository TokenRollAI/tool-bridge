import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { bytesToObjectStream, readStreamBytes } from '@tool-bridge/core'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createS3ObjectStore,
  type S3ObjectStoreOptions,
} from '../src/s3Objects'
import { assertS3Address } from '../src/s3Network'

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.unstubAllEnvs()
})

async function uploadTempDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'tb-test-upload-'))
  vi.stubEnv(process.platform === 'win32' ? 'TEMP' : 'TMPDIR', directory)
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  return directory
}

async function fixture(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  options: S3ObjectStoreOptions = {},
) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('test server did not bind')
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  )
  const endpoint = `http://127.0.0.1:${address.port}`
  const config = {
    endpoint,
    bucket: 'tb-test',
    accessKeyId: 'test-access',
    secretAccessKey: 'test-secret',
  }
  const store = createS3ObjectStore(config, {
    internalOrigin: endpoint,
    ...options,
  })
  cleanup.push(() => store.close())
  return { store, config, server }
}

function xmlError(response: ServerResponse, status: number): void {
  response.writeHead(status, { 'content-type': 'application/xml' })
  response.end(
    '<Error><Code>InternalError</Code><Message>test-secret upstream-private-host</Message></Error>',
  )
}

describe('Node S3 wire and network policy', () => {
  it('rejects credentials, query, fragment, paths and implicit HTTP/private access', () => {
    const config = {
      endpoint: '',
      bucket: 'tb-test',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
    }
    for (const endpoint of [
      'https://user:pass@example.com',
      'https://example.com?x=y',
      'https://example.com/#part',
      'https://example.com/path',
      'file:///tmp/key',
      'http://example.com',
      'https://127.0.0.1',
      'https://169.254.169.254',
    ]) {
      expect(() => createS3ObjectStore({ ...config, endpoint })).toThrow()
    }
    expect(() =>
      createS3ObjectStore(
        { ...config, endpoint: 'http://localhost:1234' },
        { internalOrigin: 'http://localhost:4321' },
      ),
    ).toThrow()
  })

  it('never permits metadata/link-local even for the exact internal origin', () => {
    for (const address of [
      '169.254.169.254',
      'fe80::1',
      '::ffff:169.254.169.254',
      '0.0.0.0',
      '::',
      '224.0.0.1',
      'ff02::1',
    ])
      expect(() => assertS3Address(address, true)).toThrow()
    for (const address of ['127.0.0.1', '10.0.0.2', 'fd00::2']) {
      expect(() => assertS3Address(address, false)).toThrow()
      expect(() => assertS3Address(address, true)).not.toThrow()
    }
  })

  it('blocks DNS resolving to loopback at the actual connection boundary', async () => {
    let connections = 0
    const { config, server } = await fixture((_request, response) =>
      response.end(),
    )
    server.on('connection', () => {
      connections++
    })
    const remote = createS3ObjectStore(
      {
        ...config,
        endpoint: config.endpoint.replace(
          'http://127.0.0.1',
          'https://localhost',
        ),
      },
      { requestTimeoutMs: 500 },
    )
    cleanup.push(() => remote.close())
    await expect(remote.head('key')).rejects.toMatchObject({
      code: 'unavailable',
    })
    expect(connections).toBe(0)
  })

  it('does not replay on redirect or expose upstream errors and credentials', async () => {
    let calls = 0
    const { store } = await fixture((_request, response) => {
      calls++
      response.writeHead(307, { location: 'https://attacker.invalid/capture' })
      response.end('test-secret')
    })
    await expect(store.put('key', 'body')).rejects.toMatchObject({
      code: 'unavailable',
      message: 'S3 PUT failed (307)',
    })
    expect(calls).toBe(1)
    expect(store.presign).toBeUndefined()
    expect(store.presignPutExact).toBeUndefined()
  })

  it('maxAttempts=1 applies to server errors and writes', async () => {
    let calls = 0
    const { store } = await fixture((_request, response) => {
      calls++
      xmlError(response, 503)
    })
    await expect(store.put('key', 'body')).rejects.toMatchObject({
      code: 'unavailable',
      message: 'S3 PUT failed (503)',
    })
    expect(calls).toBe(1)
  })

  it('forwards atomic conditions in PUT itself and maps conditional conflicts', async () => {
    const conditions: Array<{ match?: string, none?: string }> = []
    const { store } = await fixture((request, response) => {
      expect(request.method).toBe('PUT')
      conditions.push({
        match: request.headers['if-match'],
        none: request.headers['if-none-match'],
      })
      xmlError(response, 412)
    })
    await expect(
      store.put('key', 'body', { ifNoneMatch: '*' }),
    ).rejects.toMatchObject({ code: 'conflict' })
    await expect(
      store.put('key', 'body', { ifMatchEtag: 'etag-1' }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(conditions).toEqual([
      { none: '*', match: undefined },
      { match: '"etag-1"', none: undefined },
    ])
  })

  it('bounds streamed uploads and cancels the source', async () => {
    const directory = await uploadTempDirectory()
    let cancelled = false
    let calls = 0
    const { store } = await fixture(
      (request, response) => {
        calls++
        request.resume()
        request.on('end', () => response.end())
      },
      { maxObjectBytes: 8 },
    )
    await expect(
      store.put('key', {
        getReader: () => ({
          read: async () => ({ done: false, value: new Uint8Array(4) }),
          cancel: async () => {
            cancelled = true
          },
          releaseLock() {},
        }),
      }),
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(cancelled).toBe(true)
    expect(calls).toBe(0)
    expect(await readdir(directory)).toEqual([])
  })

  it('sends unknown-length streams as an exact-length single PUT with atomic conditions', async () => {
    const directory = await uploadTempDirectory()
    const payload = Buffer.from('多块 streamed content '.repeat(100))
    const requests: string[] = []
    let received = Buffer.alloc(0)
    let headers: IncomingMessage['headers'] = {}
    let duringUpload: Promise<void> | undefined
    const { store } = await fixture((request, response) => {
      requests.push(request.method!)
      if (request.method === 'HEAD') {
        response.writeHead(200, { 'content-length': payload.length, 'etag': '"stored"' })
        response.end()
        return
      }
      headers = request.headers
      duringUpload = (async () => {
        const [name] = await readdir(directory)
        expect(name).toMatch(/^tb-s3-upload-/)
        if (!name) throw new Error('upload did not spool to a private directory')
        const path = join(directory, name)
        if (process.platform !== 'win32') {
          expect((await stat(path)).mode & 0o777).toBe(0o700)
          expect((await stat(join(path, 'body'))).mode & 0o777).toBe(0o600)
        }
        expect((await stat(join(path, 'body'))).size).toBe(payload.length)
      })()
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(chunk))
      request.on('end', () => {
        received = Buffer.concat(chunks)
        void duringUpload!.then(() => response.end(), () => {
          response.writeHead(500)
          response.end()
        })
      })
    })
    let offset = 0
    const result = await store.put('stream', {
      getReader: () => ({
        read: async () => {
          if (offset === payload.length) return { done: true }
          const value = payload.subarray(offset, Math.min(offset + 7, payload.length))
          offset += value.length
          return { done: false, value }
        },
        releaseLock() {},
      }),
    }, { ifNoneMatch: '*', contentType: 'text/plain', metadata: { purpose: 'stream-test' } })
    await duringUpload
    expect(requests).toEqual(['PUT', 'HEAD'])
    expect(headers['content-length']).toBe(String(payload.length))
    expect(headers['transfer-encoding']).toBeUndefined()
    expect(headers['if-none-match']).toBe('*')
    expect(headers['content-type']).toBe('text/plain')
    expect(headers['x-amz-meta-purpose']).toBe('stream-test')
    expect(received).toEqual(payload)
    expect(result.size).toBe(payload.length)
    expect(await readdir(directory)).toEqual([])
  })

  it('keeps streamed conditional failures atomic and removes the spool file', async () => {
    const directory = await uploadTempDirectory()
    let calls = 0
    let match: string | undefined
    const { store } = await fixture((request, response) => {
      calls++
      match = request.headers['if-match']
      request.resume()
      request.on('end', () => xmlError(response, 412))
    })
    await expect(store.put('existing', bytesToObjectStream(new Uint8Array([1, 2])), {
      ifMatchEtag: 'old-etag',
    })).rejects.toMatchObject({ code: 'conflict' })
    expect(match).toBe('"old-etag"')
    expect(calls).toBe(1)
    expect(await readdir(directory)).toEqual([])
  })

  it('uploads an empty stream with Content-Length zero', async () => {
    const directory = await uploadTempDirectory()
    let length: string | undefined
    const { store } = await fixture((request, response) => {
      if (request.method === 'PUT') {
        length = request.headers['content-length']
        request.resume()
        request.on('end', () => response.end())
      } else {
        response.writeHead(200, { 'content-length': '0', 'etag': '"empty"' })
        response.end()
      }
    })
    expect((await store.put('empty', bytesToObjectStream(new Uint8Array()))).size).toBe(0)
    expect(length).toBe('0')
    expect(await readdir(directory)).toEqual([])
  })

  it('does not send partial bytes or leak source errors when a stream fails', async () => {
    const directory = await uploadTempDirectory()
    let calls = 0
    const { store } = await fixture((_request, response) => {
      calls++
      response.end()
    })
    let reads = 0
    const cancel = vi.fn(async () => {})
    const releaseLock = vi.fn()
    await expect(store.put('failed', {
      getReader: () => ({
        read: async () => {
          if (reads++) throw new Error('test-secret upstream-private-host')
          return { done: false, value: new Uint8Array([1, 2, 3]) }
        },
        cancel,
        releaseLock,
      }),
    })).rejects.toMatchObject({ code: 'unavailable', message: 'S3 PUT failed' })
    expect(calls).toBe(0)
    expect(cancel).toHaveBeenCalledOnce()
    expect(releaseLock).toHaveBeenCalledOnce()
    expect(await readdir(directory)).toEqual([])
  })

  it('times out a pending source read, cancels it and removes temporary bytes', async () => {
    const directory = await uploadTempDirectory()
    let calls = 0
    const { store } = await fixture((_request, response) => {
      calls++
      response.end()
    }, { requestTimeoutMs: 100 })
    let reads = 0
    const cancel = vi.fn(async () => {})
    const releaseLock = vi.fn()
    await expect(store.put('stalled', {
      getReader: () => ({
        read: async () => reads++
          ? new Promise<{ done: boolean }>(() => {})
          : { done: false, value: new Uint8Array([1]) },
        cancel,
        releaseLock,
      }),
    })).rejects.toMatchObject({ code: 'unavailable' })
    expect(calls).toBe(0)
    expect(cancel).toHaveBeenCalledOnce()
    expect(releaseLock).toHaveBeenCalledOnce()
    expect(await readdir(directory)).toEqual([])
  })

  it('uses the remaining upload deadline for HEAD and cleans up when it expires', async () => {
    const directory = await uploadTempDirectory()
    let headStarted = false
    const { store } = await fixture((request, response) => {
      if (request.method === 'PUT') {
        request.resume()
        request.on('end', () => response.end())
      } else {
        headStarted = true
        // This would finish within a fresh request timeout, but not within the
        // time remaining after the slow source was consumed.
        const timer = setTimeout(() => {
          response.writeHead(200, { 'content-length': '1', 'etag': '"stored"' })
          response.end()
        }, 200)
        response.on('close', () => clearTimeout(timer))
      }
    }, { requestTimeoutMs: 300 })
    let reads = 0
    await expect(store.put('head-timeout', {
      getReader: () => ({
        read: async () => {
          if (reads++) return { done: true }
          await new Promise(resolve => setTimeout(resolve, 200))
          return { done: false, value: new Uint8Array([1]) }
        },
        releaseLock() {},
      }),
    })).rejects.toMatchObject({ code: 'unavailable' })
    expect(headStarted).toBe(true)
    expect(await readdir(directory)).toEqual([])
  })

  it('bounds streamed downloads without buffering the whole response', async () => {
    const { store } = await fixture(
      (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/octet-stream' })
        response.write(new Uint8Array(8))
        response.end(new Uint8Array(8))
      },
      { maxObjectBytes: 12 },
    )
    const response = await store.get('key')
    expect(response).not.toBeNull()
    await expect(readStreamBytes(response!.body)).rejects.toMatchObject({
      code: 'invalid_argument',
    })
  })

  it('deadline covers headers and stalled response bodies', async () => {
    const { store } = await fixture(
      (request, response) => {
        if (
          new URL(request.url ?? '/', 'http://test').pathname.endsWith('body')
        ) {
          response.writeHead(200, {
            'content-type': 'application/octet-stream',
          })
          response.write('partial')
        }
      },
      { requestTimeoutMs: 100 },
    )
    await expect(store.head('headers')).rejects.toMatchObject({
      code: 'unavailable',
    })
    const response = await store.get('body')
    await expect(readStreamBytes(response!.body)).rejects.toBeDefined()
  })
})
