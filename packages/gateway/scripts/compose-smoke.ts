/**
 * Docker Compose 开发栈 E2E:gateway -> plugin-feishu -> mock TAT/MCP upstream。
 * 固定资源采用 upsert,因此同一数据卷上可重复运行。
 */

import assert from 'node:assert/strict'

const gatewayUrl = (process.env.TB_COMPOSE_GATEWAY_URL ?? 'http://gateway:8787').replace(/\/+$/, '')
const pluginUrl = (process.env.TB_COMPOSE_PLUGIN_URL ?? 'http://plugin:8788').replace(/\/+$/, '')
const upstreamUrl = (process.env.TB_COMPOSE_UPSTREAM_URL ?? 'http://upstream:39001').replace(
  /\/+$/,
  '',
)
const adminSk = process.env.TB_COMPOSE_ADMIN_SK ?? 'tbk_compose_admin_000000000000'
const pluginToken = process.env.TB_COMPOSE_PLUGIN_TOKEN ?? 'tbp_compose_dev_token'
const appId = process.env.TB_COMPOSE_APP_ID ?? 'compose-app'
const appSecret = process.env.TB_COMPOSE_APP_SECRET ?? 'compose-secret'

interface JsonObject {
  [key: string]: unknown
}

async function waitHealthy(name: string, url: string): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/healthz`)
      if (response.ok) {
        console.log(`PASS ${name} health`)
        return
      }
    } catch {
      // Compose health/dependency propagation can lag briefly after container start.
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`${name} did not become healthy: ${url}/healthz`)
}

async function assertDashboard(): Promise<void> {
  for (const path of ['/ui/', '/ui/manage/registry']) {
    const response = await fetch(`${gatewayUrl}${path}`)
    const html = await response.text()
    assert.equal(response.status, 200, `${path} expected HTTP 200, got ${response.status}`)
    assert.match(
      response.headers.get('content-type') ?? '',
      /^text\/html\b/,
      `${path} did not return HTML`,
    )
    assert.match(html, /<title>tool-bridge · control plane<\/title>/, `${path} returned stale HTML`)
  }
  console.log('PASS dashboard root and SPA deep link')
}

async function call(path: string, tool: string, arguments_: JsonObject): Promise<unknown> {
  const response = await fetch(`${gatewayUrl}/${path}`, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${adminSk}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tool, arguments: arguments_ }),
  })
  const text = await response.text()
  let body: unknown = text
  try {
    body = JSON.parse(text) as unknown
  } catch {
    // Preserve the raw response in the failure detail.
  }
  assert.equal(
    response.status,
    200,
    `${path}:${tool} expected HTTP 200, got ${response.status}: ${text}`,
  )
  return body
}

async function main(): Promise<void> {
  await Promise.all([
    waitHealthy('gateway', gatewayUrl),
    waitHealthy('plugin', pluginUrl),
    waitHealthy('upstream', upstreamUrl),
  ])
  await assertDashboard()

  await call('system/secret', 'set', { name: 'compose-plugin-token', value: pluginToken })
  await call('system/secret', 'set', {
    name: 'compose-upstream',
    value: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  console.log('PASS gateway secrets upserted')

  const plugin = (await call('system/plugin', 'write', {
    id: 'compose-feishu',
    protocolVersion: 'plugin/v2',
    endpoint: pluginUrl,
    auth: { kind: 'bearer', secretRef: 'compose-plugin-token' },
    healthPath: '/healthz',
    enabled: true,
  })) as { exports?: Array<{ id?: string, profile?: string }> }
  assert.ok(
    plugin.exports?.some(item => item.id === 'actions' && item.profile === 'tools/v1'),
    `plugin did not expose actions/tools/v1: ${JSON.stringify(plugin)}`,
  )
  console.log('PASS plugin registered with actions/tools/v1')

  await call('system/registry', 'write', {
    path: 'compose/tools',
    kind: 'tool',
    description: 'Compose Feishu proxy backed by the local mock MCP upstream',
    config: {
      kind: 'tool',
      provider: 'compose-feishu',
      export: 'actions',
      authRef: 'compose-upstream',
    },
  })
  console.log('PASS plugin export mounted at compose/tools')

  const content = await call('compose/tools', 'echo', { text: 'compose-roundtrip' })
  assert.deepEqual(content, [{ type: 'text', text: 'compose-roundtrip' }])
  console.log('PASS gateway -> plugin -> mock upstream echo roundtrip')
  console.log('compose smoke passed')
}

main().catch((error: unknown) => {
  console.error(`compose smoke FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
