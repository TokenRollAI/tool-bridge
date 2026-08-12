import { isTBError, MemoryStateStore, SecretStoreImpl } from '@tool-bridge/core'
import { createHttpProvider, createMcpProvider } from '@tool-bridge/app'
import { describe, expect, it } from 'vitest'
import { SELF } from 'cloudflare:test'
import { TEST_ADMIN_SK, TEST_ENCRYPTION_KEY } from './fixtures'

// Secret Reference 使用授权(confused-deputy 合入阻断项)集成测试:
// 两条注册通道(system/registry write/update + ~register)在权限判定后、落库前统一
// 过 assertSecretRefUse——绑定 authRef/skRef 须持 system/secret admin。
// 受限注册者(有目标路径 register,但无 secret admin)引用平台已有 Secret → permission_denied。

const admin = (extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { authorization: `Bearer ${TEST_ADMIN_SK}`, ...(extra.headers ?? {}) },
})

async function postJson(path: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://tb.test/${path}`, {
    method: 'POST',
    ...init,
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

async function issueSk(input: unknown): Promise<string> {
  const res = await postJson('system/sk', { tool: 'write', arguments: input }, admin())
  expect(res.status).toBe(200)
  return ((await res.json()) as { secret: string }).secret
}

async function setSecret(name: string, value: string): Promise<void> {
  const res = await postJson('system/secret', { tool: 'set', arguments: { name, value } }, admin())
  expect(res.status).toBe(200)
}

/** 受限注册者:team/** 下 read+call+register,但没有 system/secret admin。 */
async function issueRestrictedRegistrant(): Promise<string> {
  return issueSk({
    owner: 'agent:restricted',
    scopes: [{ pattern: 'team/**', actions: ['read', 'call', 'register'] }],
    registerPaths: ['team'],
  })
}

/**
 * 广权注册者:全树 read+call+register(能经 system/registry 管理通道写),但**无 admin**。
 * 这是 system/registry 通道下 confused-deputy 的真实身份——权限够到管理面,却不该能绑 Secret。
 */
async function issueBroadRegistrant(): Promise<string> {
  return issueSk({
    owner: 'agent:broad',
    scopes: [{ pattern: '**', actions: ['read', 'call', 'register'] }],
  })
}

const bearer = (sk: string): RequestInit => ({ headers: { authorization: `Bearer ${sk}` } })

describe('Secret Reference 使用授权', () => {
  it('广权注册者(无 admin)经 system/registry write 绑定他人 skRef → permission_denied', async () => {
    await setSecret('victim-remote-sk', 'super-secret-token')
    const sk = await issueBroadRegistrant()
    const res = await postJson(
      'system/registry',
      {
        tool: 'write',
        arguments: {
          path: 'team/evil-remote',
          kind: 'remote',
          description: 'confused deputy attempt',
          config: { kind: 'remote', baseUrl: 'https://example.com', skRef: 'victim-remote-sk' },
        },
      },
      bearer(sk),
    )
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('permission_denied')
    expect(body.message).toContain('victim-remote-sk')
  })

  it('受限注册者经 ~register 绑定他人 authRef → permission_denied', async () => {
    await setSecret('victim-http-key', 'api-key-value')
    const sk = await issueRestrictedRegistrant()
    const res = await postJson(
      'team/evil-http/~register',
      {
        path: 'team/evil-http',
        kind: 'http',
        description: 'confused deputy via ~register',
        config: {
          kind: 'http',
          endpoint: 'https://example.com',
          tools: [{ name: 'x', description: 'x', method: 'GET', pathTemplate: '/x' }],
          authRef: 'victim-http-key',
        },
      },
      bearer(sk),
    )
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('permission_denied')
    // 断言是「绑定引用」这道门拦的,而不是别的 permission_denied(路径/register 判定)。
    expect(body.message).toContain('victim-http-key')
  })

  it('广权注册者(无 admin)经 update 追加 skRef → permission_denied', async () => {
    await setSecret('victim-update-sk', 'token')
    const sk = await issueBroadRegistrant()
    // 先合法挂一个无凭证的 remote(无引用不触发授权门)。
    const mk = await postJson(
      'team/plain-remote/~register',
      {
        path: 'team/plain-remote',
        kind: 'remote',
        description: 'no cred',
        config: { kind: 'remote', baseUrl: 'https://example.com' },
      },
      bearer(sk),
    )
    expect(mk.status).toBe(200)
    // 再试图 update 追加 skRef → 被授权门拦下。
    const res = await postJson(
      'system/registry',
      {
        tool: 'update',
        arguments: {
          path: 'team/plain-remote',
          patch: { config: { kind: 'remote', baseUrl: 'https://example.com', skRef: 'victim-update-sk' } },
        },
      },
      bearer(sk),
    )
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('permission_denied')
  })

  it('受限注册者挂无凭证节点(无引用)→ 放行', async () => {
    const sk = await issueRestrictedRegistrant()
    const res = await postJson(
      'team/ok-remote/~register',
      {
        path: 'team/ok-remote',
        kind: 'remote',
        description: 'allowed, no secret ref',
        config: { kind: 'remote', baseUrl: 'https://example.com' },
      },
      bearer(sk),
    )
    expect(res.status).toBe(200)
  })

  it('admin 绑定 skRef → 放行(与创建 Secret 同权)', async () => {
    await setSecret('admin-remote-sk', 'token')
    const res = await postJson(
      'system/registry',
      {
        tool: 'write',
        arguments: {
          path: 'federation/upstream',
          kind: 'remote',
          description: 'admin binds a ref',
          config: { kind: 'remote', baseUrl: 'https://example.com', skRef: 'admin-remote-sk' },
        },
      },
      admin(),
    )
    expect(res.status).toBe(200)
  })
})

// fail-closed:声明了 authRef 却解析不到(Secret 被删 / 主密钥缺失)时,provider 必须
// unavailable,不得静默匿名出站。直接构造 provider(无需上游 mock:throw 发生在 fetch 之前)。
describe('凭证引用解析失败 fail closed', () => {
  it('http provider:authRef 解析为 undefined → call unavailable', async () => {
    // 主密钥有效,但库里没有该 secret → resolve 返回 undefined。
    const secrets = new SecretStoreImpl(new MemoryStateStore(), TEST_ENCRYPTION_KEY)
    const provider = createHttpProvider(
      {
        endpoint: 'https://example.com',
        tools: [{ name: 'x', description: 'x', method: 'GET', pathTemplate: '/x' }],
        authRef: 'missing-key',
      },
      secrets,
      { allowInsecure: false },
    )
    let caught: unknown
    try {
      await provider.call('x', {})
    } catch (err) {
      caught = err
    }
    expect(isTBError(caught)).toBe(true)
    expect((caught as { code: string }).code).toBe('unavailable')
    expect((caught as { message: string }).message).toContain('missing-key')
  })

  it('mcp provider:authRef 解析为 undefined → list unavailable(不打上游)', async () => {
    const secrets = new SecretStoreImpl(new MemoryStateStore(), TEST_ENCRYPTION_KEY)
    const provider = createMcpProvider(
      { url: 'https://mcp.example.com/mcp', authRef: 'missing-key' },
      secrets,
      { allowInsecure: false },
    )
    let caught: unknown
    try {
      await provider.list()
    } catch (err) {
      caught = err
    }
    expect(isTBError(caught)).toBe(true)
    expect((caught as { code: string }).code).toBe('unavailable')
  })
})
