import { MemoryObjectStore, TBError } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { TEST_ADMIN_SK } from './fixtures'
import { createTestApp } from './harness'

const headers = {
  'authorization': `Bearer ${TEST_ADMIN_SK}`,
  'content-type': 'application/json',
  'accept': 'application/json',
}

async function storageApp() {
  const tb = await createTestApp()
  const backends = new Map([
    ['backend-a', new MemoryObjectStore()],
    ['backend-b', new MemoryObjectStore()],
  ])
  let active = 'backend-a'
  tb.deps.defaultObjectBackend = async () => ({
    id: active,
    objects: backends.get(active)!,
  })
  tb.deps.objectStoreForBackend = (id) => {
    const objects = backends.get(id)
    if (!objects) throw TBError.notFound('Storage backend not found')
    return objects
  }
  async function post(path: string, body: unknown) {
    return tb.request(`https://tb.test/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  }
  async function mount(
    path: string,
    kind: 'context' | 'skillhub' = 'context',
    providerConfig?: Record<string, unknown>,
  ) {
    return post(`${path}/~register`, {
      path,
      kind,
      description: 'backend binding test',
      config: {
        kind,
        provider: 'storage',
        ...(providerConfig ? { providerConfig } : {}),
      },
    })
  }
  return {
    tb,
    backends,
    post,
    mount,
    activate: (id: string) => {
      active = id
    },
  }
}

describe('platform Context immutable backend binding', () => {
  it('old Context remains on A after B becomes active; new Context binds B', async () => {
    const { mount, activate, post, backends } = await storageApp()
    expect((await mount('ctx/old')).status).toBe(200)
    activate('backend-b')
    expect(
      (
        await post('ctx/old/write', {
          path: 'note',
          entry: { contentType: 'text/plain', content: 'old-backend' },
        })
      ).status,
    ).toBe(200)
    expect((await mount('ctx/new')).status).toBe(200)
    expect(
      (
        await post('ctx/new/write', {
          path: 'note',
          entry: { contentType: 'text/plain', content: 'new-backend' },
        })
      ).status,
    ).toBe(200)
    expect(
      await backends.get('backend-a')!.head('ctx/ctx/old/note'),
    ).not.toBeNull()
    expect(await backends.get('backend-b')!.head('ctx/ctx/old/note')).toBeNull()
    expect(
      await backends.get('backend-b')!.head('ctx/ctx/new/note'),
    ).not.toBeNull()
  })

  it('config updates without backendId preserve the old binding', async () => {
    const { mount, activate, post, backends } = await storageApp()
    expect((await mount('ctx/old')).status).toBe(200)
    activate('backend-b')
    expect(
      (
        await post('system/registry/update', {
          path: 'ctx/old',
          patch: {
            config: {
              kind: 'context',
              provider: 'storage',
              providerConfig: { prefix: 'updated' },
            },
          },
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await post('ctx/old/write', {
          path: 'note',
          entry: { contentType: 'text/plain', content: 'content' },
        })
      ).status,
    ).toBe(200)
    expect(await backends.get('backend-a')!.head('updated/note')).not.toBeNull()
    expect(await backends.get('backend-b')!.head('updated/note')).toBeNull()
  })

  it('explicit missing backend fails registration and a missing historical backend never falls back', async () => {
    const { mount, activate, post, backends } = await storageApp()
    expect(
      (await mount('ctx/missing', 'context', { backendId: 'missing' })).status,
    ).toBe(404)
    expect((await mount('ctx/old')).status).toBe(200)
    activate('backend-b')
    backends.delete('backend-a')
    expect(
      (
        await post('ctx/old/write', {
          path: 'note',
          entry: { contentType: 'text/plain', content: 'content' },
        })
      ).status,
    ).toBe(404)
    expect(await backends.get('backend-b')!.head('ctx/ctx/old/note')).toBeNull()
  })

  it('Skillhub records the selected backend identity as well', async () => {
    const { mount, post } = await storageApp()
    expect(
      (await mount('skills/test', 'skillhub', { backendId: 'backend-b' }))
        .status,
    ).toBe(200)
    const result = await post('system/registry/get', { path: 'skills/test' })
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({
      config: { providerConfig: { backendId: 'backend-b' } },
    })
  })
})
