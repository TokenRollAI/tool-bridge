import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { OperationRegistry, toToolResult } from '../../src/operation/registry'
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

  it('平台显式 strictObject:未知字段不被静默 strip', async () => {
    const reg = new OperationRegistry()
    const handler = vi.fn(({ text }: { text: string }) => text)
    reg.register('strict', { inputSchema: z.strictObject({ text: z.string() }) }, handler)
    await expect(reg.call('strict', { text: 'ok', extra: 'nope' }, undefined))
      .rejects.toSatisfy(error => isTBError(error) && error.code === 'invalid_argument')
    expect(handler).not.toHaveBeenCalled()
    expect(reg.get('strict').inputSchema).toMatchObject({ additionalProperties: false })
  })

  it('尊重作者显式 looseObject/passthrough 的上游扩展字段', async () => {
    const reg = new OperationRegistry()
    reg.register('messages', {
      inputSchema: z.looseObject({
        model: z.string(),
        context_management: z.looseObject({ strategy: z.string() }).optional(),
      }),
    }, input => input)
    const input = {
      model: 'claude',
      future_top_level: true,
      context_management: { strategy: 'compact', future_nested: true },
    }
    await expect(reg.invoke('messages', input, undefined)).resolves.toEqual(input)
    expect(reg.get('messages').inputSchema).toMatchObject({ additionalProperties: {} })
  })

  it('invoke 复用校验但不包 ToolResult', async () => {
    const reg = new OperationRegistry()
    reg.register(
      'raw-result',
      { inputSchema: z.strictObject({ n: z.number() }) },
      ({ n }) => ({ doubled: n * 2 }),
    )
    await expect(reg.invoke('raw-result', { n: 3 }, undefined)).resolves.toEqual({ doubled: 6 })
    await expect(reg.call('raw-result', { n: 3 }, undefined)).resolves.toEqual({
      content: { doubled: 6 },
    })
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

describe('toToolResult:信封与业务对象的分辨', () => {
  it('业务出参顶层带 content 也要被包进信封(键集合含外来键)', () => {
    // GitHub 的 reaction:content 是业务字段(表情名),不是信封载荷。
    // 只按"有没有 content 键"判会把它当信封透传,id/user 降级成 ToolResult 上的野键 ——
    // 不报错、不掉测试,调用方静默少字段。实测 11 处出参声明是这个形状。
    const reaction = { id: 99, content: '+1', user: { login: 'octocat' } }
    expect(toToolResult(reaction)).toEqual({ content: reaction })
  })

  it('真信封原样透传(键集合只有 ToolResult 的已知键)', () => {
    expect(toToolResult({ content: 'hi' })).toEqual({ content: 'hi' })
    expect(toToolResult({ content: 'x', isError: true })).toEqual({ content: 'x', isError: true })
    // MCP 上游透传的多模态结果:proxyTools 复用这条规则,不能被误包一层。
    const mcp = { content: 'text', contentBlocks: [{ type: 'text', text: 'x' }], structuredContent: { a: 1 } }
    expect(toToolResult(mcp)).toEqual(mcp)
  })

  it('裸值照常包', () => {
    expect(toToolResult('done')).toEqual({ content: 'done' })
    expect(toToolResult({ n: 1 })).toEqual({ content: { n: 1 } })
    expect(toToolResult(null)).toEqual({ content: null })
  })
})
