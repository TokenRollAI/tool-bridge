import { describe, expect, it } from 'vitest'
import { SELF } from 'cloudflare:test'
import { TEST_ADMIN_SK } from './fixtures'

// Dashboard 集成测试:/ui 静态资源托管与路由次序。
// wrangler.jsonc assets.run_worker_first=true + app.ts 显式转发——断言:
// ① /ui 免认证可加载(登录页前置条件);② SPA 回退仅在 /ui 内生效(深链回 index.html);
// ③ 根 ~help / POST 数据面 / system/* 不被静态资源吞掉;④ GET / 的 Accept 分流(浏览器 302 → /ui/)。

const admin = (extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, ...(extra.headers ?? {}) },
})

describe('/ui 静态资源(免认证)', () => {
  it('GET /ui/ 无 SK 返回 200 HTML(登录页可加载)', async () => {
    const res = await SELF.fetch('https://tb.test/ui/', { redirect: 'manual' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('<div id="root">')
  })

  it('GET /ui(无尾斜线)302 → /ui/', async () => {
    const res = await SELF.fetch('https://tb.test/ui', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('location') ?? '', 'https://tb.test').pathname).toBe('/ui/')
  })

  it('构建产物静态文件(/ui/assets/*)可取回', async () => {
    const html = await (await SELF.fetch('https://tb.test/ui/')).text()
    const m = html.match(/\/ui\/(assets\/[^"']+\.js)/)
    expect(m).not.toBeNull()
    const res = await SELF.fetch(`https://tb.test/ui/${m?.[1]}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('javascript')
  })

  it('SPA 深链(/ui/nodes/a/b)回退 index.html', async () => {
    const res = await SELF.fetch('https://tb.test/ui/nodes/a/b')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('<div id="root">')
  })
})

describe('路由次序:Worker 逻辑不被 assets 吞', () => {
  it('根 ~help(带 SK)仍由 Worker 返回帮助(默认 markdown)', async () => {
    const res = await SELF.fetch('https://tb.test/~help', admin())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    expect(await res.text()).toContain('HTBP')
  })

  it('浏览器形态的 GET /~help(Accept: text/html)也不落入 SPA 回退', async () => {
    const res = await SELF.fetch('https://tb.test/~help', {
      ...admin(),
      headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, accept: 'text/html' },
      redirect: 'manual',
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('HTBP')
  })

  it('POST /system/status 数据面正常(不被静态回退拦截)', async () => {
    const res = await SELF.fetch('https://tb.test/system/status', {
      method: 'POST',
      ...admin(),
      headers: {
        'authorization': `Bearer ${TEST_ADMIN_SK}`,
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({ tool: 'get', arguments: {} }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { healthy: boolean }
    expect(body.healthy).toBe(true)
  })

  it('无 SK 的 API 请求仍 401(认证面未被 /ui 例外扩大)', async () => {
    const res = await SELF.fetch('https://tb.test/~tree')
    expect(res.status).toBe(401)
  })
})

describe('GET / 的 Accept 分流', () => {
  it('Accept: text/html → 302 /ui/(免认证,浏览器直开)', async () => {
    const res = await SELF.fetch('https://tb.test/', {
      headers: { accept: 'text/html,application/xhtml+xml' },
      redirect: 'manual',
    })
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('location') ?? '', 'https://tb.test').pathname).toBe('/ui/')
  })

  it('非 HTML Accept 无 SK → 401(原语义不变)', async () => {
    const res = await SELF.fetch('https://tb.test/', { redirect: 'manual' })
    expect(res.status).toBe(401)
  })

  it('非 HTML Accept 带 SK → 404 no such path(原语义不变)', async () => {
    const res = await SELF.fetch('https://tb.test/', { ...admin(), redirect: 'manual' })
    expect(res.status).toBe(404)
  })
})
