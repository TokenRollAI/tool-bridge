import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import type { CallContext } from '../../src/types'
import { BuiltinCommandRegistry } from '../../src/builtin/commandRegistry'
import { isTBError } from '../../src/errors'

const ctx: CallContext = {
  keyId: 'key-1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 'trace-1',
}

describe('BuiltinCommandRegistry 单一真源', () => {
  it('一条注册定义精确派生 Help JSON 的 path/metadata/schema', () => {
    const commands = new BuiltinCommandRegistry<{ prefix: string }>(
      'example',
      'Example builtin',
    ).register(
      'echo',
      {
        h: 'echo one value',
        inputSchema: z.strictObject({
          text: z.string().describe('text to echo'),
        }),
        returns: '{ echoed }',
        scope: 'write',
        effect: 'write',
        confirm: true,
      },
      ({ text }, { deps }) => ({ echoed: `${deps.prefix}${text}` }),
    )

    expect(commands.help('system/example')).toEqual({
      node: {
        path: 'system/example',
        kind: 'builtin',
        description: 'Example builtin',
      },
      cmds: [{
        name: 'echo',
        method: 'POST',
        path: '/system/example/echo',
        scope: 'write',
        h: 'echo one value',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'text to echo' },
          },
          required: ['text'],
          additionalProperties: false,
        },
        effect: 'write',
        confirm: true,
        returns: '{ echoed }',
      }],
    })
    expect(commands.names()).toEqual(['echo'])
    expect(commands.scopeFor('echo')).toBe('write')
    expect(commands.scopeFor('missing')).toBeUndefined()
  })

  it('dispatch 走同一 handler 并返回原始 builtin 形状', async () => {
    const handler = vi.fn((text: string, origin: string | undefined) => ({ text, origin }))
    const commands = new BuiltinCommandRegistry<{ prefix: string }>('example', 'Example')
      .register(
        'echo',
        {
          h: 'echo',
          inputSchema: z.strictObject({ text: z.string() }),
          scope: 'read',
        },
        ({ text }, { deps, runtime }) => handler(`${deps.prefix}${text}`, runtime?.requestOrigin),
      )
    const mod = commands.module({ prefix: '>' })

    await expect(mod.dispatch(
      'echo',
      { text: 'ok' },
      ctx,
      { requestOrigin: 'https://bridge.example' },
    )).resolves.toEqual({ text: '>ok', origin: 'https://bridge.example' })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('未知字段在 handler 前拒绝;未知 cmd 保持 builtin invalid_argument 语义', async () => {
    const handler = vi.fn(() => ({ ok: true }))
    const mod = new BuiltinCommandRegistry<undefined>('example', 'Example')
      .register(
        'run',
        { h: 'run', inputSchema: z.strictObject({}), scope: 'admin' },
        handler,
      )
      .module(undefined)

    await expect(mod.dispatch('run', { secret: 'must-not-be-ignored' }, ctx))
      .rejects.toSatisfy(error => isTBError(error) && error.code === 'invalid_argument')
    expect(handler).not.toHaveBeenCalled()
    await expect(mod.dispatch('missing', {}, ctx))
      .rejects.toSatisfy(error => isTBError(error) && error.code === 'invalid_argument')
  })
})
