/**
 * 本地 S3 兜底服务(s3rver):供 opt-in context s3 集成测试在无真实 S3 端点时本地跑
 * (echo-mcp 同款模式,devDependency,不进生产构建)。s3rver 不校验 SigV4 签名值
 * (allowMismatchedSignatures),但 access key 必须是其内建的 'S3RVER'——
 * 签名正确性验证留给真实端点(R2 S3 兼容端点 / AWS)。
 *
 * 用法:`pnpm s3-mock`(默认 127.0.0.1:39003,bucket tb-test),然后:
 *   TB_TEST_S3_ENDPOINT=http://127.0.0.1:39003 TB_TEST_S3_ACCESS_KEY_ID=S3RVER \
 *   TB_TEST_S3_SECRET_ACCESS_KEY=S3RVER TB_TEST_S3_BUCKET=tb-test \
 *   TB_ALLOW_INSECURE_HTTP=true pnpm test -- context.integration.test.ts
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import S3rver from 's3rver'

const PORT = Number(process.env.S3_MOCK_PORT ?? 39003)
const HOST = process.env.S3_MOCK_HOST ?? '127.0.0.1'
const BUCKET = process.env.S3_MOCK_BUCKET ?? 'tb-test'

const server = new S3rver({
  port: PORT,
  address: HOST,
  silent: false,
  directory: mkdtempSync(join(tmpdir(), 's3-mock-')),
  allowMismatchedSignatures: true,
  configureBuckets: [{ name: BUCKET, configs: [] }],
})

await server.run()
console.log(`[s3-mock] listening on http://${HOST}:${PORT} (bucket: ${BUCKET})`)
