import { describe, expect, it } from 'vitest'
import { createStatusModule } from '../../src/builtin/status'
import { isTBError } from '../../src/errors'
import type { CallContext } from '../../src/types'

const ctx: CallContext = { keyId: 'k', owner: 'user:admin', scopes: [], traceId: 't' }

describe('builtin status 模块', () => {
  const mod = createStatusModule({ version: () => '0.1.0', nodeCount: async () => 3 })

  it('help():单 cmd get,scope=read', () => {
    const help = mod.help('system/status')
    expect(help.cmds.map((c) => c.name)).toEqual(['get'])
    expect(help.cmds[0]?.scope).toBe('read')
  })

  it('get → { healthy, version, nodeCount }(version/nodeCount 经注入 getter)', async () => {
    const res = await mod.dispatch('get', {}, ctx)
    expect(res).toEqual({ healthy: true, version: '0.1.0', nodeCount: 3 })
  })

  it('未知 cmd → invalid_argument', async () => {
    await expect(mod.dispatch('list', {}, ctx)).rejects.toSatisfy(
      (e) => isTBError(e) && e.code === 'invalid_argument',
    )
  })
})
