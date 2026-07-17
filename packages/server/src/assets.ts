/**
 * Dashboard 静态托管(deps.assets 的 Node 实现)。
 *
 * 来源优先级:TB_UI_DIR 显式覆盖(设了但无 index.html → 视为无 UI,不静默回退)
 * → @tool-bridge/dashboard 包 dist(regular dependency,装 server 即有 UI)→ 无
 * (tbApp 现有 /ui 404 优雅降级)。/ui 前缀剥离与 SPA fallback 在 tbApp serveUi,
 * 本模块只按 pathname 读文件;contentType 复用 core 的扩展名推断表。
 */

import { fsContentTypeOf } from '@tool-bridge/core/node'
import { dirname, join, resolve, sep } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

export type AssetsFetcher = (request: Request) => Promise<Response>

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

/** uiDir → (Request)=>Response 静态文件服务(路径穿越拒 404;未命中 404)。 */
export function uiAssetsFetcher(uiDir: string): AssetsFetcher {
  const root = resolve(uiDir)
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    let pathname = decodeURIComponent(url.pathname)
    if (pathname.endsWith('/')) pathname += 'index.html'
    const full = resolve(join(root, pathname))
    if (full !== root && !full.startsWith(root + sep)) {
      return new Response('not found', { status: 404 })
    }
    try {
      const data = await readFile(full)
      return new Response(new Uint8Array(data), {
        headers: { 'content-type': fsContentTypeOf(full) },
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  }
}

/** 组合入口:定位 + 包装;无 UI → undefined(deps.assets 不注入)。 */
export function resolveUiAssets(uiDirOverride?: string): AssetsFetcher | undefined {
  const dir = resolveUiDir(uiDirOverride)
  return dir === undefined ? undefined : uiAssetsFetcher(dir)
}
