import { describe, expect, it } from 'vitest'
import { bearer, createTestApp } from './harness'

/**
 * 注册面两通道同权的回归锚:system/registry write 与 `~register` 共享
 * registryMutation.ts 的同一条安全链,对同一非法输入必须给出同样的拒绝
 * (code 与 message 逐字一致)。链上任一环从共享实现漂回手写副本,此测试先红。
 */

interface WireError {
  code: string
  message: string
}

const JSON_POST = {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'accept': 'application/json' },
}

async function viaRegistryWrite(
  tb: Awaited<ReturnType<typeof createTestApp>>,
  node: Record<string, unknown>,
): Promise<{ error: WireError, status: number }> {
  const res = await tb.request(
    'https://tb.test/system/registry/write',
    bearer(undefined, { ...JSON_POST, body: JSON.stringify(node) }),
  )
  return { status: res.status, error: (await res.json()) as WireError }
}

async function viaRegister(
  tb: Awaited<ReturnType<typeof createTestApp>>,
  node: Record<string, unknown>,
): Promise<{ error: WireError, status: number }> {
  const res = await tb.request(
    `https://tb.test/${String(node.path)}/~register`,
    bearer(undefined, { ...JSON_POST, body: JSON.stringify(node) }),
  )
  return { status: res.status, error: (await res.json()) as WireError }
}

describe('注册面两通道同权(system/registry write ≡ ~register)', () => {
  it('mcp oauthClient 携明文 clientSecret:两入口同样拒绝', async () => {
    const tb = await createTestApp()
    const node = {
      path: 'parity/mcp-oauth',
      kind: 'mcp',
      description: 'oauthClient 旁路字段必须被服务端权威拒绝',
      config: {
        kind: 'mcp',
        url: 'https://mcp.example.com/sse',
        auth: 'oauth',
        oauthClient: { clientId: 'client-a', clientSecret: 'plaintext-nope' },
      },
    }
    const registry = await viaRegistryWrite(tb, node)
    const register = await viaRegister(tb, node)
    expect(registry.status).toBe(400)
    expect(register.status).toBe(registry.status)
    expect(registry.error.code).toBe('invalid_argument')
    expect(register.error).toEqual(registry.error)
  })

  it('remote baseUrl 不在白名单:两入口同样拒绝', async () => {
    const tb = await createTestApp()
    const node = {
      path: 'parity/remote',
      kind: 'remote',
      description: 'baseUrl 白名单在注册时即拒',
      config: { kind: 'remote', baseUrl: 'https://not-allowed.invalid' },
    }
    const registry = await viaRegistryWrite(tb, node)
    const register = await viaRegister(tb, node)
    expect(registry.status).toBeGreaterThanOrEqual(400)
    expect(register.status).toBe(registry.status)
    expect(register.error).toEqual(registry.error)
  })

  it('skillhub provider 非 storage/s3:两入口同样拒绝', async () => {
    const tb = await createTestApp()
    const node = {
      path: 'parity/skillhub',
      kind: 'skillhub',
      description: 'skillhub provider 白名单',
      config: { kind: 'skillhub', provider: 'gcs' },
    }
    const registry = await viaRegistryWrite(tb, node)
    const register = await viaRegister(tb, node)
    expect(registry.status).toBe(400)
    expect(register.status).toBe(registry.status)
    expect(register.error).toEqual(registry.error)
  })
})
