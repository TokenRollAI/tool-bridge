/**
 * Dashboard 静态托管(deps.assets 的 Node 实现)。
 *
 * 来源优先级:TB_UI_DIR 显式覆盖(设了但无 index.html → 视为无 UI,不静默回退)
 * → @tool-bridge/dashboard 包 dist(regular dependency,装 server 即有 UI)→ 无
 * (tbApp 现有 /ui 404 优雅降级)。/ui 前缀剥离与 SPA fallback 在 tbApp serveUi,
 * 本模块只按 pathname 读文件;contentType 复用 core 的扩展名推断表。
 */

import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib'
import { fsContentTypeOf } from '@tool-bridge/core/node'
import { dirname, join, resolve, sep } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

export type AssetsFetcher = (request: Request) => Promise<Response>

/** 仅文本类资产值得压缩;woff2 / png / gzip 已是压缩格式,再压徒增 CPU 且几乎无收益。 */
const COMPRESSIBLE = /^(?:text\/|application\/(?:javascript|json|manifest\+json|wasm)|image\/svg\+xml)/
/** 小于此阈值压缩开销大于收益(压缩头 + Vary 分裂缓存),直接原样发送。 */
const MIN_COMPRESS_BYTES = 1024

/**
 * Cache-Control by pathname(pathname 已剥离 /ui 前缀,root 布局)。
 * - `assets/*`:Vite 产物带内容 hash,内容变则文件名变,可永久 immutable。
 * - 其余(index.html、public/ 根下的 favicon/icon 等无 hash):no-cache 强制重验证,
 *   避免重新部署后浏览器拿旧壳去引用已不存在的 hash 资产。
 */
function cacheControlFor(pathname: string): string {
  return pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
}

/** 按 RFC 7231 语义判断客户端是否接受某编码(尊重 `enc;q=0` 的显式拒绝)。 */
function acceptsEncoding(accept: string | null, enc: 'br' | 'gzip'): boolean {
  if (!accept) return false
  for (const part of accept.split(',')) {
    const [tokenRaw = '', ...params] = part.trim().split(';')
    const token = tokenRaw.trim().toLowerCase()
    if (token !== enc && token !== '*') continue
    const q = params.map(p => p.trim()).find(p => p.startsWith('q='))
    if (q && Number(q.slice(2)) === 0) return false
    return true
  }
  return false
}

/** 优先 brotli(静态资产压缩一次即 memo,更高压缩比划算),否则 gzip,都不接受则不压。 */
function pickEncoding(accept: string | null): 'br' | 'gzip' | undefined {
  if (acceptsEncoding(accept, 'br')) return 'br'
  if (acceptsEncoding(accept, 'gzip')) return 'gzip'
  return undefined
}

/** 定位 UI 静态目录;找不到(或显式覆盖无效)→ undefined。 */
export function resolveUiDir(uiDirOverride?: string): string | undefined {
  if (uiDirOverride !== undefined) {
    return existsSync(join(uiDirOverride, 'index.html')) ? resolve(uiDirOverride) : undefined
  }
  try {
    const require = createRequire(import.meta.url)
    const pkgPath = require.resolve('@tool-bridge/dashboard/package.json')
    const dist = join(dirname(pkgPath), 'dist')
    return existsSync(join(dist, 'index.html')) ? dist : undefined
  } catch {
    return undefined
  }
}

/**
 * 一次读盘的产物:原始字节 + 惰性填充的压缩变体 + 弱 ETag。
 * 字节显式用 `Uint8Array<ArrayBuffer>`(非默认的 `ArrayBufferLike`),才满足 `BodyInit`。
 */
interface CachedAsset {
  body: Uint8Array<ArrayBuffer>
  br?: Uint8Array<ArrayBuffer>
  contentType: string
  etag: string
  gzip?: Uint8Array<ArrayBuffer>
}

/** Buffer → 独立 ArrayBuffer 承载的 Uint8Array(满足 fetch 的 BodyInit 类型约束)。 */
function toBytes(buf: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength))
  out.set(buf)
  return out
}

/** FNV-1a 32-bit:够用的内容指纹(仅用于条件请求命中判定,非加密用途)。 */
function weakEtag(data: Uint8Array): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i] as number
    hash = Math.imul(hash, 0x01000193)
  }
  return `W/"${(hash >>> 0).toString(16)}-${data.length.toString(16)}"`
}

/**
 * uiDir → (Request)=>Response 静态文件服务。
 *
 * 在 core 版基础上补齐 Node/Docker 宿主此前缺失的三件事(Cloudflare 侧由平台代劳,
 * 故只在 Node 实现里做,不进 core 契约):
 * - `Cache-Control`:hash 资产 immutable,其余 no-cache;hash 文件名的"永久可缓存"收益此前未兑现。
 * - 内容协商压缩(br/gzip):此前 Node 首屏发 raw ~494KB 而非 ~126KB。压缩结果按文件 memo,不每次重压。
 * - 弱 ETag + 304:重访命中直接空响应。
 *
 * 路径穿越拒 404;未命中 404。压缩仅对可压缩类型且 ≥1KB 生效,并带 `Vary: Accept-Encoding`。
 */
export function uiAssetsFetcher(uiDir: string): AssetsFetcher {
  const root = resolve(uiDir)
  const cache = new Map<string, CachedAsset>()
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    let pathname = decodeURIComponent(url.pathname)
    if (pathname.endsWith('/')) pathname += 'index.html'
    const full = resolve(join(root, pathname))
    if (full !== root && !full.startsWith(root + sep)) {
      return new Response('not found', { status: 404 })
    }

    let asset = cache.get(full)
    if (asset === undefined) {
      let data: Buffer
      try {
        data = await readFile(full)
      } catch {
        return new Response('not found', { status: 404 })
      }
      const body = toBytes(data)
      asset = { body, contentType: fsContentTypeOf(full), etag: weakEtag(body) }
      cache.set(full, asset)
    }

    const headers = new Headers({
      'content-type': asset.contentType,
      'cache-control': cacheControlFor(pathname),
      'etag': asset.etag,
    })

    // 条件请求:ETag 命中 → 304(空体),省去传输与压缩。
    if (request.headers.get('if-none-match') === asset.etag) {
      return new Response(null, { status: 304, headers })
    }

    const canCompress = COMPRESSIBLE.test(asset.contentType) && asset.body.length >= MIN_COMPRESS_BYTES
    const encoding = canCompress ? pickEncoding(request.headers.get('accept-encoding')) : undefined
    if (canCompress) headers.set('vary', 'Accept-Encoding')

    if (encoding === 'br') {
      asset.br ??= toBytes(
        brotliCompressSync(asset.body, {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
        }),
      )
      headers.set('content-encoding', 'br')
      return new Response(asset.br, { headers })
    }
    if (encoding === 'gzip') {
      asset.gzip ??= toBytes(gzipSync(asset.body, { level: 9 }))
      headers.set('content-encoding', 'gzip')
      return new Response(asset.gzip, { headers })
    }
    return new Response(asset.body, { headers })
  }
}

/** 组合入口:定位 + 包装;无 UI → undefined(deps.assets 不注入)。 */
export function resolveUiAssets(uiDirOverride?: string): AssetsFetcher | undefined {
  const dir = resolveUiDir(uiDirOverride)
  return dir === undefined ? undefined : uiAssetsFetcher(dir)
}
