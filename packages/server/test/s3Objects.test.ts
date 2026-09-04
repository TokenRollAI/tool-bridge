import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { readStreamBytes } from '@tool-bridge/core'
import { once } from 'node:events'
import {
  createS3ObjectStore,
  type S3ObjectStoreOptions,
} from '../src/s3Objects'
import { assertS3Address } from '../src/s3Network'

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

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
    let cancelled = false
    const { store } = await fixture(
      (request, response) => {
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
