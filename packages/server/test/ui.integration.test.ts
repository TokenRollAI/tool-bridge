/**
 * /ui 静态托管集成测试(fixture 目录,不依赖 dashboard 构建产物)。
 * 覆盖:index/资产 200 与 contentType、深链 SPA 回退、路径穿越 404、
 * 显式 TB_UI_DIR 无效 → 无 UI(/ui 404 优雅降级)、GET / HTML 协商 302 → /ui/。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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

/** fixture UI:index.html + assets/app.js。 */
function makeUiFixture(): string {
  const dir = tmpDir('tb-ui-')
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>tb-ui-fixture</title>')
  mkdirSync(join(dir, 'assets'), { recursive: true })
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("fixture")')
  return dir
}

async function startServer(uiDir: string): Promise<{ server: TbServer; baseUrl: string }> {
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
