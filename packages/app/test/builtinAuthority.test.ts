import { NodeRegistryStore, SKRegistryStore } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { bearer, createTestApp } from './harness'

describe('canonical authority of administrative builtins', () => {
  it('an alias with local admin permission cannot bypass its system permission', async () => {
    const fixture = await createTestApp()
    const now = new Date().toISOString()
    await new NodeRegistryStore(fixture.state).write({
      path: 'personal/vault', kind: 'builtin', description: 'administrative alias fixture', config: { kind: 'builtin', module: 'secret' },
    }, 'system:boot', now)
    const { secret } = await new SKRegistryStore(fixture.state).write({
      owner: 'test:limited', scopes: [{ pattern: 'personal/**', actions: ['read', 'admin'] }],
    }, now)
    const request = (credential?: string) => fixture.app.request('https://tb.test/personal/vault/list', bearer(credential, {
      method: 'POST', headers: { 'accept': 'application/json', 'content-type': 'application/json' }, body: '{}',
    }))
    expect((await request(secret)).status).toBe(403)
    expect((await request()).status).toBe(200)
  })
})
