/**
 * @hono/node-server serveStatic({ precompressed: true }) characterization.
 *
 * This deliberately records both supported behavior and release-specific
 * limitations.  A dependency upgrade must re-run/review these assertions
 * before assets.ts can be replaced: passing this suite does not mean the
 * candidate satisfies Tool Bridge's static-asset contract.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serveStatic } from '@hono/node-server/serve-static'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'

const PINNED_NODE_SERVER_VERSION = '1.19.14'
const SPA_FALLBACK = '<!doctype html><title>spa-fallback</title>'

let fixtureDir: string
let identity: Buffer
let brotli: Buffer
let gzip: Buffer

function packageVersion(): string {
  const require = createRequire(import.meta.url)
  const entry = require.resolve('@hono/node-server/serve-static')
  const manifest = JSON.parse(readFileSync(resolve(dirname(entry), '../package.json'), 'utf8')) as {
    version: string
  }
  return manifest.version
}

function makeApp(): Hono {
  const app = new Hono()
  app.use(
    '*',
    serveStatic({
      precompressed: true,
      root: fixtureDir,
      rewriteRequestPath(path) {
        return path.replace(/^\/ui(?=\/|$)/, '') || '/'
      },
    }),
  )
  app.get('/ui/*', c => c.html(SPA_FALLBACK, 200, { 'x-spa-fallback': 'true' }))
  return app
}

async function bytes(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer())
}

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'tb-hono-static-'))
  mkdirSync(join(fixtureDir, 'assets'), { recursive: true })
  identity = Buffer.from(`console.log("hono-static-characterization");${'// fixture\n'.repeat(200)}`)
  brotli = brotliCompressSync(identity)
  gzip = gzipSync(identity)
  writeFileSync(join(fixtureDir, 'index.html'), '<!doctype html><title>fixture-index</title>')
  writeFileSync(join(fixtureDir, 'assets/app.js'), identity)
  writeFileSync(join(fixtureDir, 'assets/app.js.br'), brotli)
  writeFileSync(join(fixtureDir, 'assets/app.js.gz'), gzip)
})

afterAll(() => {
  rmSync(fixtureDir, { force: true, recursive: true })
})

describe(`@hono/node-server@${PINNED_NODE_SERVER_VERSION} serveStatic precompressed`, () => {
  it('pins the characterized dependency release', () => {
    expect(packageVersion()).toBe(PINNED_NODE_SERVER_VERSION)
  })

  it('selects bare br/gzip tokens and prefers br in the implementation order', async () => {
    const app = makeApp()

    const br = await app.request('/ui/assets/app.js', { headers: { 'accept-encoding': 'br' } })
    expect(br.status).toBe(200)
    expect(br.headers.get('content-encoding')).toBe('br')
    expect(br.headers.get('vary')).toBe('Accept-Encoding')
    expect(await bytes(br)).toEqual(brotli)

    const gz = await app.request('/ui/assets/app.js', { headers: { 'accept-encoding': 'gzip' } })
    expect(gz.headers.get('content-encoding')).toBe('gzip')
    expect(await bytes(gz)).toEqual(gzip)

    const both = await app.request('/ui/assets/app.js', {
      headers: { 'accept-encoding': 'gzip, br' },
    })
    expect(both.headers.get('content-encoding')).toBe('br')
    expect(await bytes(both)).toEqual(brotli)
  })

  it('records the q-value limitation: parameters are treated as part of the token', async () => {
    const app = makeApp()

    // RFC-compatible clients commonly send q parameters. 1.19.14 compares the
    // whole comma-separated item with "gzip"/"br", so even q=1 is not selected.
    const gzipQ1 = await app.request('/ui/assets/app.js', {
      headers: { 'accept-encoding': 'gzip;q=1' },
    })
    expect(gzipQ1.headers.get('content-encoding')).toBeNull()
    expect(await bytes(gzipQ1)).toEqual(identity)

    // Explicit q=0 is incidentally rejected, but weighted alternatives are not
    // ranked: both parameterized alternatives fall back to identity.
    const weighted = await app.request('/ui/assets/app.js', {
      headers: { 'accept-encoding': 'gzip;q=1, br;q=0.5' },
    })
    expect(weighted.headers.get('content-encoding')).toBeNull()
    expect(await bytes(weighted)).toEqual(identity)

    const onlyBrRejected = await app.request('/ui/assets/app.js', {
      headers: { 'accept-encoding': 'br;q=0' },
    })
    expect(onlyBrRejected.headers.get('content-encoding')).toBeNull()
    expect(await bytes(onlyBrRejected)).toEqual(identity)

    const brRejected = await app.request('/ui/assets/app.js', {
      headers: { 'accept-encoding': 'br;q=0, gzip' },
    })
    expect(brRejected.headers.get('content-encoding')).toBe('gzip')
  })

  it('records the cache-key limitation: identity responses omit Vary', async () => {
    const app = makeApp()
    const identityResponse = await app.request('/ui/assets/app.js', {
      headers: { 'accept-encoding': 'identity' },
    })

    expect(identityResponse.headers.get('content-encoding')).toBeNull()
    expect(identityResponse.headers.get('vary')).toBeNull()
    expect(await bytes(identityResponse)).toEqual(identity)
  })

  it('serves HEAD metadata and byte ranges over the selected representation', async () => {
    const app = makeApp()
    const head = await app.request('/ui/assets/app.js', {
      headers: { 'accept-encoding': 'br' },
      method: 'HEAD',
    })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-encoding')).toBe('br')
    expect(head.headers.get('content-length')).toBe(String(brotli.byteLength))
    expect((await bytes(head)).byteLength).toBe(0)

    const range = await app.request('/ui/assets/app.js', {
      headers: { 'accept-encoding': 'gzip', 'range': 'bytes=0-7' },
    })
    expect(range.status).toBe(206)
    expect(range.headers.get('content-encoding')).toBe('gzip')
    expect(range.headers.get('content-range')).toBe(`bytes 0-7/${gzip.byteLength}`)
    expect(range.headers.get('content-length')).toBe('8')
    expect(await bytes(range)).toEqual(gzip.subarray(0, 8))
  })

  it('records the cache limitation: no Cache-Control, representation ETag or 304 handling', async () => {
    const app = makeApp()
    const identityResponse = await app.request('/ui/assets/app.js', {
      headers: { 'accept-encoding': 'identity' },
    })
    const brotliResponse = await app.request('/ui/assets/app.js', {
      headers: { 'accept-encoding': 'br' },
    })
    expect(identityResponse.headers.get('cache-control')).toBeNull()
    expect(identityResponse.headers.get('etag')).toBeNull()
    expect(brotliResponse.headers.get('etag')).toBeNull()

    const conditional = await app.request('/ui/assets/app.js', {
      headers: { 'accept-encoding': 'br', 'if-none-match': '"fixture"' },
    })
    expect(conditional.status).toBe(200)
    expect(await bytes(conditional)).toEqual(brotli)
  })

  it('can strip the /ui prefix and delegate a missing deep link to an SPA fallback', async () => {
    const app = makeApp()
    const index = await app.request('/ui/')
    expect(index.status).toBe(200)
    expect(await index.text()).toContain('fixture-index')

    const deepLink = await app.request('/ui/nodes/system/sk')
    expect(deepLink.status).toBe(200)
    expect(deepLink.headers.get('x-spa-fallback')).toBe('true')
    expect(await deepLink.text()).toBe(SPA_FALLBACK)
  })
})
