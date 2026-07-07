/**
 * 吊销传播验收:对已部署的 TB_BASE_URL 端到端验证
 * SK 吊销后请求被拒(401),并测量传播耗时(CF KV 最终一致,上限窗口 60s)。
 *
 * 流程:用 admin SK 经 system/sk 签发一把临时 SK(仅 read scope)→ 确认其可用(~help 200)
 *   → 吊销(system/sk delete)→ 轮询 ~help 直到 401(或超时)→ 输出耗时。
 *
 * 用法:`TB_BASE_URL=https://... TB_ADMIN_SK=tbk_... pnpm tsx scripts/verify-revocation.ts`
 *
 * **消耗生产资源**:签发/吊销真实 SK,故只在显式运行时跑,不进 `pnpm verify`。
 * 轮询上限 60s(KV 官方传播窗口上限);超时视为失败(退出码 1)。
 */
import assert from 'node:assert/strict'

const baseUrl = (process.argv[2] ?? process.env.TB_BASE_URL)?.replace(/\/+$/, '')
const adminSk = process.env.TB_ADMIN_SK ?? process.env.TB_SK

if (!baseUrl) {
  console.error('error: missing base URL. Set TB_BASE_URL or pass as argv[2].')
  process.exit(1)
}
if (!adminSk) {
  console.error('error: missing admin SK. Set TB_ADMIN_SK (admin-scoped SK).')
  process.exit(1)
}

const POLL_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 2_000

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function skCall(cmd: string, args: unknown): Promise<Response> {
  return fetch(`${baseUrl}/system/sk`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminSk}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ tool: cmd, arguments: args }),
  })
}

/** 用 tempSk 探测 ~help;返回 HTTP 状态码。 */
async function probe(tempSk: string): Promise<number> {
  const res = await fetch(`${baseUrl}/~help`, { headers: { authorization: `Bearer ${tempSk}` } })
  return res.status
}

async function main(): Promise<void> {
  // 1) 签发临时 SK(仅 read scope,足够 ~help 探测)。
  const issue = await skCall('write', {
    owner: 'agent:revocation-probe',
    description: 'temporary SK for verify-revocation.ts (safe to revoke)',
    scopes: [{ pattern: '**', actions: ['read'] }],
  })
  assert.equal(issue.status, 200, `issue temp SK expected 200, got ${issue.status}`)
  const issued = (await issue.json()) as { key: { id: string }; secret: string }
  const tempId = issued.key.id
  const tempSk = issued.secret
  console.log(`ok  issued temp SK id=${tempId}`)

  // 2) 确认可用(~help 200)。
  const before = await probe(tempSk)
  assert.equal(before, 200, `temp SK ~help expected 200 before revoke, got ${before}`)
  console.log('ok  temp SK usable (~help 200)')

  // 3) 吊销。
  const del = await skCall('delete', { id: tempId })
  assert.equal(del.status, 200, `delete temp SK expected 200, got ${del.status}`)
  console.log(`ok  revoked temp SK id=${tempId}`)

  // 4) 轮询直到 401(或超时 60s)。
  const start = Date.now()
  let status = before
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    status = await probe(tempSk)
    if (status === 401) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      console.log(`ok  revocation propagated: ~help → 401 after ${elapsed}s`)
      console.log(`\nverify-revocation passed against ${baseUrl}`)
      return
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(
    `revocation did not propagate within ${POLL_TIMEOUT_MS / 1000}s (last status ${status})`,
  )
}

main().catch((err) => {
  console.error(`verify-revocation FAILED: ${err.message}`)
  process.exit(1)
})
