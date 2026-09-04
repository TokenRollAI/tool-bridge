import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { railwayDeploymentNeeded } from './deploy-change-filter.mjs'

test('共享运行时代码触发 Railway', () => {
  assert.equal(railwayDeploymentNeeded(['packages/app/src/app.ts']), true)
})

test('只有 Node 宿主代码触发 Railway', () => {
  assert.equal(railwayDeploymentNeeded(['packages/server/src/index.ts']), true)
  assert.equal(railwayDeploymentNeeded(['packages/gateway/src/deployEntry.ts']), false)
})

test('部署入口变化会触发首轮部署', () => {
  assert.equal(railwayDeploymentNeeded(['Dockerfile.railway']), true)
  assert.equal(railwayDeploymentNeeded(['.github/workflows/ci.yml']), true)
})

test('纯文档与无关客户端变化不会部署', () => {
  assert.equal(railwayDeploymentNeeded([
    './README.md',
    'llmdoc/hosts-deploy/cloudflare-paths.mdx',
    'packages/cli/src/index.ts',
    '',
  ]), false)
})

test('CI 只做验证，不包含 Cloudflare 自动部署', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.doesNotMatch(workflow, /deploy-cloudflare/)
  assert.doesNotMatch(workflow, /CLOUDFLARE_API_TOKEN/)
  assert.doesNotMatch(workflow, /TB_CF_/)
  assert.doesNotMatch(workflow, /deploy=cloudflare|\bcloudflare\)/)
})
