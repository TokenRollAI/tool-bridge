import { serveStatic } from '@hono/node-server/serve-static'
/** Node static asset delivery. Build outputs own compression; Hono owns wire handling. */
import { dirname, join, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import Negotiator from 'negotiator'
import { etag } from 'hono/etag'
import { Hono } from 'hono'

export type AssetsFetcher = (request: Request) => Promise<Response>

export function resolveUiDir(uiDirOverride?: string): string | undefined {
  if (uiDirOverride !== undefined)
    return existsSync(join(uiDirOverride, 'index.html'))
      ? resolve(uiDirOverride)
      : undefined
  try {
    const require = createRequire(import.meta.url)
    const dist = join(
      dirname(require.resolve('@tool-bridge/dashboard/package.json')),
      'dist',
    )
    return existsSync(join(dist, 'index.html')) ? dist : undefined
  } catch {
    return undefined
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

export function uiAssetsFetcher(uiDir: string): AssetsFetcher {
  const root = resolve(uiDir)
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.header(
      'Cache-Control',
      c.req.path.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    )
    c.header('Vary', 'Accept-Encoding')
    await next()
  })
  app.use('*', etag({ weak: true }))
  app.use('*', serveStatic({ root, precompressed: true }))
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return new Response('method not allowed', { status: 405 })
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      return new Response('not found', { status: 404 })
    }
    if (pathname.includes('\0'))
      return new Response('not found', { status: 404 })
    if (pathname.endsWith('/')) pathname += 'index.html'
    const full = resolve(join(root, pathname))
    if (full !== root && !full.startsWith(root + sep))
      return new Response('not found', { status: 404 })
    const available = ['identity']
    if (await isFile(`${full}.br`)) available.unshift('br')
    if (await isFile(`${full}.gz`))
      available.splice(available.includes('br') ? 1 : 0, 0, 'gzip')
    const encoding = new Negotiator({
      headers: {
        'accept-encoding': request.headers.get('accept-encoding') ?? '',
      },
    }).encoding(available)
    if (!encoding)
      return new Response('no acceptable representation', {
        status: 406,
        headers: { vary: 'Accept-Encoding' },
      })
    const headers = new Headers(request.headers)
    // Hono's precompressed selector accepts bare tokens. Negotiator already
    // resolved q-values, explicit refusal, wildcard precedence and identity.
    headers.set('accept-encoding', encoding)
    const head = request.method === 'HEAD'
    const response = await app.fetch(
      new Request(request, { headers, ...(head ? { method: 'GET' } : {}) }),
    )
    if (!head) return response
    await response.body?.cancel()
    return new Response(null, {
      status: response.status,
      headers: response.headers,
    })
  }
}

export function resolveUiAssets(
  uiDirOverride?: string,
): AssetsFetcher | undefined {
  const directory = resolveUiDir(uiDirOverride)
  return directory === undefined ? undefined : uiAssetsFetcher(directory)
}
