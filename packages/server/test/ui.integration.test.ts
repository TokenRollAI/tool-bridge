/**
 * /ui 静态托管集成测试(fixture 目录,不依赖 dashboard 构建产物)。
 * 覆盖:index/资产 200 与 contentType、深链 SPA 回退、路径穿越 404、
 * 显式 TB_UI_DIR 无效 → 无 UI(/ui 404 优雅降级)、GET / HTML 协商 302 → /ui/。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configFromEnv, createTbServer, type TbServer } from '../src'

const ADMIN_SK = 'tbk_server_test_admin_00000000'
const ENCRYPTION_KEY = '3ZwpbBkSrp3eT9ylcZedfN33yq9fJLlmeusH98qNbt8'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/**
 * fixture UI:index.html + assets/app.js。
 * app.js 填充到 >1KB,才能触发压缩(小于 MIN_COMPRESS_BYTES 的按原样发送)。
 */
function makeUiFixture(): string {
  const dir = tmpDir('tb-ui-')
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>tb-ui-fixture</title>')
  mkdirSync(join(dir, 'assets'), { recursive: true })
  writeFileSync(join(dir, 'assets', 'app.js'), `console.log("fixture");${'//pad\n'.repeat(400)}`)
  return dir
}

async function startServer(uiDir: string): Promise<{ baseUrl: string, server: TbServer }> {
  const config = configFromEnv({
    TB_PORT: '0',
    TB_HOST: '127.0.0.1',
    TB_DATA_DIR: tmpDir('tb-uidata-'),
    TB_BOOTSTRAP_ADMIN_SK: ADMIN_SK,
    TB_SECRET_ENCRYPTION_KEY: ENCRYPTION_KEY,
    TB_UI_DIR: uiDir,
  })
  const server = createTbServer(config)
  const { port } = await server.start()
  cleanups.push(() => server.close())
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

describe('/ui 静态托管', () => {
  it('index 与资产 200 + contentType;深链 SPA 回退;穿越 404;/ui 免认证', async () => {
    const { baseUrl } = await startServer(makeUiFixture())

    const index = await fetch(`${baseUrl}/ui/`)
    expect(index.status).toBe(200)
    expect(index.headers.get('content-type')).toContain('text/html')
    expect(await index.text()).toContain('tb-ui-fixture')

    const js = await fetch(`${baseUrl}/ui/assets/app.js`)
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toContain('text/javascript')

    // 深链(前端路由)→ SPA 回退 index.html。
    const deep = await fetch(`${baseUrl}/ui/nodes/system/sk`)
    expect(deep.status).toBe(200)
    expect(await deep.text()).toContain('tb-ui-fixture')

    // 路径穿越:URL 规范化外的字面 .. 也不得越根。
    const traversal = await fetch(`${baseUrl}/ui/..%2f..%2fetc%2fpasswd`)
    expect([200, 404]).toContain(traversal.status)
    if (traversal.status === 200) {
      expect(await traversal.text()).toContain('tb-ui-fixture') // 只能是 SPA 回退,不能是根外文件
    }
  })

  it('hash 资产 immutable、index.html no-cache;br/gzip 内容协商;ETag → 304', async () => {
    const { baseUrl } = await startServer(makeUiFixture())

    // hash 资产(assets/*)→ immutable 长缓存。
    const asset = await fetch(`${baseUrl}/ui/assets/app.js`, { headers: { 'accept-encoding': 'identity' } })
    expect(asset.status).toBe(200)
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    const etag = asset.headers.get('etag')
    expect(etag).toBeTruthy()

    // index.html(无 hash)→ no-cache,强制重验证。
    const index = await fetch(`${baseUrl}/ui/`)
    expect(index.headers.get('cache-control')).toBe('no-cache')

    // 内容协商:声明 gzip 得到 gzip;声明 br 得到 br;都带 Vary。
    const gz = await fetch(`${baseUrl}/ui/assets/app.js`, { headers: { 'accept-encoding': 'gzip' } })
    expect(gz.headers.get('content-encoding')).toBe('gzip')
    expect(gz.headers.get('vary')).toContain('Accept-Encoding')
    const br = await fetch(`${baseUrl}/ui/assets/app.js`, { headers: { 'accept-encoding': 'br' } })
    expect(br.headers.get('content-encoding')).toBe('br')
    // 解压后与原文一致(fetch 自动解 gzip;br 需 node 未必自动解,断言字节非空即可)。
    expect(await gz.text()).toContain('fixture')

    // 条件请求:带上一次的 ETag → 304 空体。
    const revalidate = await fetch(`${baseUrl}/ui/assets/app.js`, {
      headers: { 'if-none-match': etag as string, 'accept-encoding': 'identity' },
    })
    expect(revalidate.status).toBe(304)
    expect(await revalidate.text()).toBe('')
  })

  it('GET /(Accept html)→ 302 /ui/;TB_UI_DIR 无效 → /ui 404 优雅降级', async () => {
    const { baseUrl } = await startServer(makeUiFixture())
    const root = await fetch(baseUrl, { headers: { accept: 'text/html' }, redirect: 'manual' })
    expect(root.status).toBe(302)
    expect(root.headers.get('location')).toBe('/ui/')

    const { baseUrl: noUi } = await startServer(join(tmpdir(), 'tb-ui-nonexistent'))
    const missing = await fetch(`${noUi}/ui/`)
    expect(missing.status).toBe(404)
  })
})
