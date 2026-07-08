/**
 * 部署冒烟:对 TB_BASE_URL 断言 /healthz 与 /~help。
 *
 * 用法:`TB_BASE_URL=https://... TB_SK=tbk_... pnpm smoke`(或 `tsx scripts/smoke.ts <baseUrl>`)。
 * `~help` 需要认证:提供 TB_SK 时断言 200;未提供时断言 401 裸 TBError。
 * **只对已部署环境跑,不对生产误跑破坏性操作**——本脚本仅只读探测。
 */
import assert from 'node:assert/strict'

const baseUrl = (process.argv[2] ?? process.env.TB_BASE_URL)?.replace(/\/+$/, '')
const sk = process.env.TB_SK

if (!baseUrl) {
  console.error('error: missing base URL. Set TB_BASE_URL or pass as argv[2].')
  process.exit(1)
}

async function main(): Promise<void> {
  // 1) /healthz → 200 + JSON {healthy:true, version}(树外免认证)
  const health = await fetch(`${baseUrl}/healthz`)
  assert.equal(health.status, 200, `GET /healthz expected 200, got ${health.status}`)
  const body = (await health.json()) as { healthy?: boolean; version?: string }
  assert.equal(body.healthy, true, '/healthz body.healthy must be true')
  assert.ok(body.version, '/healthz body.version must be present')
  console.log(`ok  GET /healthz → 200 healthy version=${body.version}`)

  // 2) 无 SK 的 /~help → 401 裸 TBError
  const anon = await fetch(`${baseUrl}/~help`)
  assert.equal(anon.status, 401, `GET /~help without SK expected 401, got ${anon.status}`)
  const err = (await anon.json()) as { code?: string; retryable?: boolean }
  assert.equal(err.code, 'permission_denied', '401 body.code must be permission_denied')
  assert.equal(err.retryable, false, '401 body.retryable must be false')
  console.log('ok  GET /~help (no SK) → 401 TBError permission_denied')

  // 3) 带 SK 的 /~help → 默认 200 text/markdown;显式 Accept: text/plain 得 DSL(首行 htbp 0.1)
  if (sk) {
    const help = await fetch(`${baseUrl}/~help`, { headers: { authorization: `Bearer ${sk}` } })
    assert.equal(help.status, 200, `GET /~help with SK expected 200, got ${help.status}`)
    const ct = help.headers.get('content-type') ?? ''
    assert.ok(
      ct.includes('text/markdown'),
      `/~help default content-type must be text/markdown, got '${ct}'`,
    )
    console.log('ok  GET /~help (with SK) → 200 text/markdown (default representation)')

    const dsl = await fetch(`${baseUrl}/~help`, {
      headers: { authorization: `Bearer ${sk}`, accept: 'text/plain' },
    })
    assert.equal(dsl.status, 200, `GET /~help (Accept: text/plain) expected 200, got ${dsl.status}`)
    const dslCt = dsl.headers.get('content-type') ?? ''
    assert.ok(
      dslCt.includes('text/plain'),
      `/~help DSL content-type must be text/plain, got '${dslCt}'`,
    )
    const text = await dsl.text()
    assert.equal(text.split('\n')[0], 'htbp 0.1', '/~help DSL first line must be "htbp 0.1"')
    console.log('ok  GET /~help (Accept: text/plain) → 200 first line "htbp 0.1"')
  } else {
    console.log('skip GET /~help with SK — TB_SK not set')
  }

  console.log(`\nsmoke passed against ${baseUrl}`)
}

main().catch((err) => {
  console.error(`smoke FAILED: ${err.message}`)
  process.exit(1)
})
