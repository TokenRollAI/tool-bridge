import { afterEach, describe, expect, it, vi } from 'vitest'
import { KEY_BOOTSTRAPPED } from '@tool-bridge/core'
import { testServerConfig } from './helpers/server'
import { createTbServer } from '../src'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
  vi.restoreAllMocks()
})

describe('explicit Node embedding bootstrap', () => {
  it('missing admin credential fails before listening and never prints a generated key', async () => {
    const config = await testServerConfig({ adminSk: undefined })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const server = createTbServer(config)
    cleanup.push(() => server.close())
    await expect(server.start()).rejects.toThrow()
    expect(log.mock.calls.flat().join(' ')).not.toContain('shown once')
    await expect(server.state.get(KEY_BOOTSTRAPPED)).resolves.toBeNull()
  })

  it('explicit admin initializes once and restart does not require a new credential', async () => {
    const config = await testServerConfig({ adminSk: 'tbk_provided_admin_0000000000' })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const first = createTbServer(config)
    try {
      expect((await first.start()).port).toBeGreaterThan(0)
      expect(log.mock.calls.flat().join(' ')).not.toContain(config.adminSk)
    } finally { await first.close() }
    const second = createTbServer({ ...config, adminSk: undefined })
    cleanup.push(() => second.close())
    expect((await second.start()).port).toBeGreaterThan(0)
  })
})
