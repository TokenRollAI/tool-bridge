import type { Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { serve } from '@hono/node-server'
import { trackResponseBody } from '../src/responseLifecycle'

const encoder = new TextEncoder()
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})

function barrier() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function listen(fetch: () => Response): Promise<string> {
  let server!: Server
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch, hostname: '127.0.0.1', port: 0 }, info => resolve(info.port)) as Server
  })
  cleanup.push(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  }))
  return `http://127.0.0.1:${port}`
}

function slowResponse(options: { cancel?: (reason: unknown) => Promise<void>, error?: Error } = {}) {
  const gate = barrier()
  let cancelled = false
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('first-'))
    },
    async pull(controller) {
      await gate.promise
      if (cancelled) return
      if (options.error) {
        controller.error(options.error)
      } else {
        controller.enqueue(encoder.encode('last'))
        controller.close()
      }
    },
    async cancel(reason: unknown) {
      cancelled = true
      await options.cancel?.(reason)
    },
  }, { highWaterMark: 0 })
  cleanup.push(async () => {
    gate.resolve()
  })
  const headers = new Headers({ 'content-type': 'application/octet-stream', 'x-stream-contract': 'preserved' })
  headers.append('set-cookie', 'first=1; Path=/')
  headers.append('set-cookie', 'second=2; Path=/')
  return { gate, response: new Response(source, { status: 206, statusText: 'Partial Content', headers }) }
}

describe('response body request lifecycle', () => {
  it('releases bodyless responses immediately without replacing them', () => {
    const release = vi.fn()
    const response = new Response(null, { status: 204 })
    expect(trackResponseBody(response, release)).toBe(response)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('does not prefetch chunks and forwards cancellation reasons and failures', async () => {
    let pulls = 0
    const cancelled = vi.fn()
    const failure = new Error('controlled cancellation failure')
    const release = vi.fn()
    const response = trackResponseBody(new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        controller.enqueue(new Uint8Array([pulls]))
      },
      cancel(reason: unknown) {
        cancelled(reason)
        throw failure
      },
    }, { highWaterMark: 0 })), release)
    await Promise.resolve()
    expect(pulls).toBe(0)
    const reader = response.body!.getReader()
    expect((await reader.read()).value).toEqual(new Uint8Array([1]))
    await Promise.resolve()
    expect(pulls).toBe(1)
    expect(release).not.toHaveBeenCalled()
    const reason = new Error('consumer cancellation')
    await expect(reader.cancel(reason)).rejects.toBe(failure)
    expect(cancelled).toHaveBeenCalledExactlyOnceWith(reason)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('releases upstream errors even when the reader is paused and preserves the error', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>
    const release = vi.fn()
    const response = trackResponseBody(new Response(new ReadableStream<Uint8Array>({
      start(controller) { source = controller },
    }, { highWaterMark: 0 })), release)
    const failure = new Error('controlled paused upstream failure')
    source.error(failure)
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
    await expect(response.arrayBuffer()).rejects.toBe(failure)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('keeps a real HTTP response admitted after headers until its gated body finishes', async () => {
    const stream = slowResponse()
    const release = vi.fn()
    const url = await listen(() => trackResponseBody(stream.response, release))
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
    expect(response.status).toBe(206)
    expect(response.statusText).toBe('Partial Content')
    expect(response.headers.get('x-stream-contract')).toBe('preserved')
    expect(response.headers.getSetCookie()).toEqual(['first=1; Path=/', 'second=2; Path=/'])
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first-')
    expect(release).not.toHaveBeenCalled()
    stream.gate.resolve()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('last')
    expect((await reader.read()).done).toBe(true)
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
    expect(stream.response.body!.locked).toBe(false)
  })

  it('releases a real client cancellation after upstream cancellation finishes', async () => {
    const cancellation = barrier()
    const cancelled = vi.fn(async () => {
      await cancellation.promise
    })
    const stream = slowResponse({ cancel: cancelled })
    cleanup.push(async () => {
      cancellation.resolve()
    })
    const release = vi.fn()
    const url = await listen(() => trackResponseBody(stream.response, release))
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
    const reader = response.body!.getReader()
    expect((await reader.read()).done).toBe(false)
    expect(release).not.toHaveBeenCalled()
    await reader.cancel()
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1))
    expect(release).not.toHaveBeenCalled()
    cancellation.resolve()
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
  })

  it('releases and fails the real HTTP body when its upstream stream errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const stream = slowResponse({ error: new Error('controlled HTTP stream failure') })
    const release = vi.fn()
    const url = await listen(() => trackResponseBody(stream.response, release))
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
    const reader = response.body!.getReader()
    expect((await reader.read()).done).toBe(false)
    expect(release).not.toHaveBeenCalled()
    const reading = reader.read()
    const failed = expect(reading).rejects.toBeDefined()
    stream.gate.resolve()
    await failed
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
  })
})
