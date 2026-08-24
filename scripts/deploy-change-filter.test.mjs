import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { deploymentTargets } from './deploy-change-filter.mjs'

test('共享运行时代码同时触发 Railway 与 Cloudflare', () => {
  assert.deepEqual(deploymentTargets(['packages/app/src/app.ts']), {
    cloudflare: true,
    railway: true,
  })
})

test('宿主专属代码只触发对应平台', () => {
  assert.deepEqual(deploymentTargets(['packages/server/src/index.ts']), {
    cloudflare: false,
    railway: true,
  })
  assert.deepEqual(deploymentTargets(['packages/gateway/src/deployEntry.ts']), {
    cloudflare: true,
    railway: false,
  })
})

test('部署入口变化会触发首轮部署', () => {
  assert.deepEqual(deploymentTargets(['Dockerfile.railway']), {
    cloudflare: false,
    railway: true,
  })
  assert.deepEqual(deploymentTargets(['.github/workflows/ci.yml']), {
    cloudflare: true,
    railway: true,
  })
})

test('纯文档与无关客户端变化不会部署', () => {
  assert.deepEqual(deploymentTargets([
    './README.md',
    'llmdoc/hosts-deploy/cloudflare-paths.mdx',
    'packages/cli/src/index.ts',
    '',
  ]), {
    cloudflare: false,
    railway: false,
  })
})

test('Cloudflare workflow 明确调用 gateway deploy script', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.match(workflow, /pnpm --filter @tool-bridge\/gateway run deploy/)
  assert.doesNotMatch(workflow, /pnpm --filter @tool-bridge\/gateway deploy(?:\s|$)/)
})
