/**
 * 部署冒烟:对 TB_BASE_URL 断言 /healthz 与 /~help(DOD.md:28)。
 *
 * 用法:`TB_BASE_URL=https://... pnpm smoke`(或 `tsx scripts/smoke.ts <baseUrl>`)。
 * **只对已部署环境跑,不对生产误跑破坏性操作**——本脚本仅只读探测。
 */
import assert from 'node:assert/strict'

const baseUrl = (process.argv[2] ?? process.env.TB_BASE_URL)?.replace(/\/+$/, '')

if (!baseUrl) {
  console.error('error: missing base URL. Set TB_BASE_URL or pass as argv[2].')
  process.exit(1)
}

async function main(): Promise<void> {
  // 1) /healthz → 200 + JSON {healthy:true, version}
  const health = await fetch(`${baseUrl}/healthz`)
  assert.equal(health.status, 200, `GET /healthz expected 200, got ${health.status}`)
  const body = (await health.json()) as { healthy?: boolean; version?: string }
  assert.equal(body.healthy, true, '/healthz body.healthy must be true')
  assert.ok(body.version, '/healthz body.version must be present (DOD.md:40)')
  console.log(`ok  GET /healthz → 200 healthy version=${body.version}`)

  // 2) /~help → 200 text/plain,首行 htbp 0.1
  const help = await fetch(`${baseUrl}/~help`)
  assert.equal(help.status, 200, `GET /~help expected 200, got ${help.status}`)
  const ct = help.headers.get('content-type') ?? ''
  assert.ok(ct.includes('text/plain'), `/~help content-type must be text/plain, got '${ct}'`)
  const text = await help.text()
  assert.equal(text.split('\n')[0], 'htbp 0.1', '/~help first line must be "htbp 0.1"')
  console.log('ok  GET /~help → 200 text/plain first line "htbp 0.1"')

  console.log(`\nsmoke passed against ${baseUrl}`)
}

main().catch((err) => {
  console.error(`smoke FAILED: ${err.message}`)
  process.exit(1)
})
