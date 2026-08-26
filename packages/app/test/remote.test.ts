import { MemoryStateStore, SecretStoreImpl } from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { passthroughRemote } from '../src/providers/remote'
import { TEST_ENCRYPTION_KEY } from './fixtures'

interface SeenRequest {
  authorization: string | undefined
  method: string | undefined
  url: string | undefined
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test server has no TCP port')
  return address.port
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  })
}

type RemoteOptions = Parameters<typeof passthroughRemote>[0]

function remoteOptions(overrides: Partial<RemoteOptions> = {}): RemoteOptions {
  return {
    actor: { keyId: 'test-key', owner: 'agent:test', traceId: 'test-trace' },
    config: { baseUrl: 'https://remote.example/htbp' },
    headers: new Headers({ accept: 'application/json' }),
    method: 'GET',
    nodePath: 'peer',
    requestPath: 'peer/action',
    requestUrl: 'https://parent.example/peer/action',
    secrets: new SecretStoreImpl(new MemoryStateStore(), TEST_ENCRYPTION_KEY),
    settings: {
      allowInsecure: false,
      allowlist: ['remote.example'],
      instanceId: 'parent-instance',
      maxHops: 4,
    },
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('remote response transport boundary', () => {
  it('preserves a normal binary response and forwards the optional signal', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async () => new Response(new Uint8Array([0, 1, 2, 255]), {
      status: 206,
      headers: {
        'content-length': '4',
        'content-type': 'application/octet-stream',
      },
    }))
    vi.stubGlobal('fetch', fetcher)

    const response = await passthroughRemote(remoteOptions({
      maxResponseBodyBytes: 4,
      signal: controller.signal,
    }))

    expect(response.status).toBe(206)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 255]))
    expect(fetcher).toHaveBeenCalledWith(
      'https://remote.example/htbp/action',
      expect.objectContaining({ redirect: 'error', signal: controller.signal }),
    )
  })

  it('rejects an oversized Content-Length before locking the response reader', async () => {
    const upstream = new Response('small fixture', {
      headers: { 'content-length': '513' },
    })
    const getReader = vi.spyOn(upstream.body!, 'getReader')
    vi.stubGlobal('fetch', vi.fn(async () => upstream))

    await expect(passthroughRemote(remoteOptions({ maxResponseBodyBytes: 512 })))
      .rejects.toMatchObject({ code: 'unavailable', retryable: false })
    expect(getReader).not.toHaveBeenCalled()
  })

  it('cancels a chunked response as soon as accumulated bytes exceed the limit', async () => {
    const cancel = vi.fn()
    const upstream = new Response(new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.enqueue(new Uint8Array([4, 5, 6]))
      },
    }))
    vi.stubGlobal('fetch', vi.fn(async () => upstream))

    await expect(passthroughRemote(remoteOptions({ maxResponseBodyBytes: 5 })))
      .rejects.toMatchObject({ code: 'unavailable', retryable: false })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })

  it('normalizes an abort during streamed body consumption and cancels the reader', async () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    let markWaiting!: () => void
    const waiting = new Promise<void>(resolve => (markWaiting = resolve))
    let pulls = 0
    const upstream = new Response(new ReadableStream<Uint8Array>({
      cancel,
      pull(stream) {
        if (pulls++ === 0) {
          stream.enqueue(new Uint8Array([1]))
          return
        }
        markWaiting()
        return new Promise(() => {})
      },
    }))
    vi.stubGlobal('fetch', vi.fn(async () => upstream))

    const pending = passthroughRemote(remoteOptions({ signal: controller.signal }))
    await waiting
    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: 'unavailable', retryable: true })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })

  it('keeps the default call compatible when no signal or body limit is provided', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input
      void init
      return new Response('{"ok":true}', {
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetcher)

    const response = await passthroughRemote(remoteOptions())

    await expect(response.json()).resolves.toEqual({ ok: true })
    const [, init] = fetcher.mock.calls[0]!
    expect(init).not.toHaveProperty('signal')
  })
})

describe('remote redirect boundary', () => {
  it.each([
    ['HTTP 301 + skRef', 301, true],
    ['HTTP 302 + skRef', 302, true],
    ['HTTP 303 + skRef', 303, true],
    ['HTTP 307 + skRef', 307, true],
    ['HTTP 308 + skRef', 308, true],
    ['HTTP 307，无 skRef', 307, false],
  ] as const)(
    '%s 时 fail closed，且不请求跳转目标',
    async (_case, status, withSkRef) => {
      const seen: SeenRequest[] = []
      const server = createServer((request, response) => {
        seen.push({
          authorization: request.headers.authorization,
          method: request.method,
          url: request.url,
        })
        if (request.url === '/htbp/action') {
          response.writeHead(status, { location: '/redirect-target' })
          response.end()
          return
        }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ followed: true }))
      })
      const port = await listen(server)
      const secrets = new SecretStoreImpl(new MemoryStateStore(), TEST_ENCRYPTION_KEY)
      if (withSkRef) {
        await secrets.set('remote-sk', 'tbk_remote_secret', new Date().toISOString())
      }
      const auditLog = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        await expect(passthroughRemote({
          actor: { keyId: 'test-key', owner: 'agent:test', traceId: 'test-trace' },
          body: '{}',
          config: {
            baseUrl: `http://127.0.0.1:${port}/htbp`,
            ...(withSkRef ? { skRef: 'remote-sk' } : {}),
          },
          headers: new Headers({
            'accept': 'application/json',
            'content-type': 'application/json',
          }),
          method: 'POST',
          nodePath: 'peer',
          requestPath: 'peer/action',
          requestUrl: 'https://parent.example/peer/action',
          secrets,
          settings: {
            allowInsecure: true,
            allowlist: ['127.0.0.1'],
            instanceId: 'parent-instance',
            maxHops: 4,
          },
        })).rejects.toMatchObject({ code: 'unavailable' })

        expect(seen).toEqual([{
          authorization: withSkRef ? 'Bearer tbk_remote_secret' : undefined,
          method: 'POST',
          url: '/htbp/action',
        }])
      } finally {
        auditLog.mockRestore()
        await close(server)
      }
    },
  )
})
