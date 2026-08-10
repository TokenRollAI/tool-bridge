import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { OperationRegistry } from '../../src/operation/registry'
import { isTBError } from '../../src/errors'

const ctx = { who: 'tester' }

describe('OperationRegistry 注册与 ToolSpec 派生', () => {
  it('Zod schema → JSON Schema(含 describe 派生的 description、required、无 $schema)', () => {
    const reg = new OperationRegistry<typeof ctx>()
    reg.register(
      'echo',
      {
        description: 'Echo the input',
        effect: 'read',
        inputSchema: z.object({
          text: z.string().describe('Text to echo'),
          times: z.number().optional(),
        }),
      },
      ({ text }) => ({ echoed: text }),
    )
    const spec = reg.get('echo')
    expect(spec.name).toBe('echo')
    expect(spec.description).toBe('Echo the input')
    expect(spec.effect).toBe('read')
    const schema = spec.inputSchema as Record<string, unknown>
    expect(schema.$schema).toBeUndefined()
    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(['text'])
    const props = schema.properties as Record<string, { description?: string, type?: string }>
    expect(props.text).toEqual({ type: 'string', description: 'Text to echo' })
    expect(props.times).toEqual({ type: 'number' })
  })

  it('MCP 风格 raw shape 等价于 z.object', () => {
    const reg = new OperationRegistry()
    reg.register('raw', { inputSchema: { text: z.string() } }, ({ text }) => text)
    const schema = reg.get('raw').inputSchema as Record<string, unknown>
    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(['text'])
  })

  it('rawInputSchema 逃生阀原样进 ToolSpec', () => {
    const reg = new OperationRegistry()
    const raw = { type: 'object', properties: { a: { type: 'string' } } }
    reg.register('escape', { rawInputSchema: raw }, args => args)
    expect(reg.get('escape').inputSchema).toEqual(raw)
  })

  it('list 保序;names/has 可查;未声明 schema 的操作无 inputSchema', () => {
    const reg = new OperationRegistry()
    reg.register('a', {}, () => 1)
    reg.register('b', { description: 'B' }, () => 2)
    expect(reg.names()).toEqual(['a', 'b'])
    expect(reg.has('a')).toBe(true)
    expect(reg.has('zzz')).toBe(false)
    expect(reg.list().map(s => s.name)).toEqual(['a', 'b'])
    expect(reg.get('a').inputSchema).toBeUndefined()
  })

  it('重名注册 / 空名 / schema 二选一冲突 → invalid_argument', () => {
    const reg = new OperationRegistry()
    reg.register('dup', {}, () => 1)
    expect(() => reg.register('dup', {}, () => 2)).toThrow(/already registered/)
    expect(() => reg.register('', {}, () => 1)).toThrow(/non-empty/)
    expect(() =>
      reg.register('both', { inputSchema: z.object({}), rawInputSchema: {} }, () => 1),
    ).toThrow(/mutually exclusive/)
  })
})

describe('OperationRegistry 调用', () => {
  it('safeParse 通过 → handler 收到已解析入参,裸返回值被包成 ToolResult', async () => {
    const reg = new OperationRegistry<typeof ctx>()
    reg.register(
      'echo',
      { inputSchema: z.object({ text: z.string(), times: z.number().default(1) }) },
      (input, c) => ({ echoed: input.text.repeat(input.times), by: c.who }),
    )
    const res = await reg.call('echo', { text: 'hi' }, ctx)
    // default 生效说明拿到的是 parsed data 而非原始 args
    expect(res.content).toEqual({ echoed: 'hi', by: 'tester' })
    expect(res.isError).toBeUndefined()
  })

  it('handler 已返回 ToolResult 形状则原样透传(含 isError)', async () => {
    const reg = new OperationRegistry()
    reg.register('boom', {}, () => ({ content: 'upstream said no', isError: true }))
    const res = await reg.call('boom', {}, undefined)
    expect(res).toEqual({ content: 'upstream said no', isError: true })
  })

  it('ZodError → invalid_argument,消息含字段路径', async () => {
    const reg = new OperationRegistry()
    reg.register('typed', { inputSchema: z.object({ n: z.number() }) }, ({ n }) => n)
    let caught: unknown
    try {
      await reg.call('typed', { n: 'not-a-number' }, undefined)
    } catch (err) {
      caught = err
    }
    expect(isTBError(caught)).toBe(true)
    expect((caught as { code: string }).code).toBe('invalid_argument')
    expect((caught as { message: string }).message).toContain('typed')
    expect((caught as { message: string }).message).toContain('n')
  })

  it('未声明 schema → 原样透传 args,不校验', async () => {
    const reg = new OperationRegistry()
    reg.register('passthrough', {}, args => args)
    const res = await reg.call('passthrough', { anything: [1, 2] }, undefined)
    expect(res.content).toEqual({ anything: [1, 2] })
  })

  it('未知操作 call/get → not_found', async () => {
    const reg = new OperationRegistry()
    await expect(reg.call('nope', {}, undefined)).rejects.toThrow(/unknown operation/)
    expect(() => reg.get('nope')).toThrow(/unknown operation/)
  })

  it('z.infer 推导:handler 入参在编译期即为具体类型(本例由 tsc 保证,非运行时断言)', async () => {
    const reg = new OperationRegistry()
    reg.register(
      'inferred',
      { inputSchema: z.object({ n: z.number(), tags: z.array(z.string()) }) },
      (input) => {
        // 若推导退化为 unknown,以下两行无法通过 core 的 tsc(include 覆盖 test/)。
        const n: number = input.n
        const first: string | undefined = input.tags[0]
        return { n, first }
      },
    )
    const res = await reg.call('inferred', { n: 2, tags: ['a'] }, undefined)
    expect(res.content).toEqual({ n: 2, first: 'a' })
  })

  it('async handler 被 await', async () => {
    const reg = new OperationRegistry()
    reg.register('slow', {}, async () => {
      await Promise.resolve()
      return 'done'
    })
    expect((await reg.call('slow', {}, undefined)).content).toBe('done')
  })
})
