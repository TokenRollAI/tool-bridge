import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  encodeCredentialValues,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { createProviderPlugin, requireCredential } from '../../src/_runtime/plugin'

/**
 * 多字段凭证(上游 open-connector 的 custom_credential 形态)。
 *
 * 平台的凭证通道传的是一个字符串,多数 provider 只要一个 API key。一批 provider 需要多个
 * 字段(飞书 appId+appSecret、S3 access key+secret+region…),此前只能靠"把 JSON 塞进那个
 * 单值"的约定 —— 平台不知道里面是什么,配错要到第一次调用才发现。
 *
 * 现在字段是**声明的**:`~describe` 报出去,平台挂载时校验齐全,SDK 解析后经 ctx.credentials
 * 给 handler。传输契约不变,故已有单值 plugin 零影响(本文件最后一组断言钉这一点)。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }

const FIELDS = [
  { key: 'appId', label: 'App ID', required: true },
  { key: 'appSecret', label: 'App Secret', required: true, secret: true },
  { key: 'region', required: false },
]

/** 一个最小的多字段 provider:handler 把取到的字段回显,便于断言。 */
function multiFieldPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Multi-field probe',
    credentialFields: FIELDS,
    actions: {
      whoami: {
        description: 'echo the resolved credential fields',
        effect: 'read',
        inputSchema: z.strictObject({}),
      },
    },
    handlers: {
      whoami: (_input, ctx) => ({
        appId: requireCredential(ctx, 'probe', 'appId'),
        appSecret: requireCredential(ctx, 'probe', 'appSecret'),
        region: ctx.credentials?.region ?? null,
      }),
    },
  })
}

/** 单值 provider:证明既有形态没被改坏。 */
function singleValuePlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Single-value probe',
    actions: {
      whoami: {
        description: 'echo the raw credential',
        effect: 'read',
        inputSchema: z.strictObject({}),
      },
    },
    handlers: { whoami: (_input, ctx) => ({ raw: ctx.upstreamAuth, credentials: ctx.credentials ?? null }) },
  })
}

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'probe',
  exportId: 'actions',
}

function call(
  plugin: ReturnType<typeof createProviderPlugin>,
  auth: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {
    'authorization': `Bearer ${PLUGIN_TOKEN}`,
    'content-type': 'application/json',
    [HEADER_TB_CONTEXT]: encodeCallContext(CALLER),
  }
  if (auth !== null) {
    headers[HEADER_TB_UPSTREAM_AUTH] = base64urlEncode(new TextEncoder().encode(auth))
  }
  return Promise.resolve(plugin.fetch(
    new Request('https://plugin.test/', {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool: 'Call', arguments: { name: 'whoami', args: {} } }),
    }),
    ENV as never,
  ))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('声明面', () => {
  it('~describe 报出 credentialFields,平台据此提示该填哪些字段', async () => {
    const res = await multiFieldPlugin().fetch(
      new Request('https://plugin.test/~describe'),
      ENV as never,
    )
    const body = (await res.json()) as {
      exports: Array<{ credentialFields?: typeof FIELDS }>
    }
    expect(body.exports[0]?.credentialFields).toEqual(FIELDS)
  })

  it('没声明多字段的 export 不报这个字段(既有 plugin 的 ~describe 不变)', async () => {
    const res = await singleValuePlugin().fetch(
      new Request('https://plugin.test/~describe'),
      ENV as never,
    )
    const body = (await res.json()) as { exports: Array<Record<string, unknown>> }
    expect(body.exports[0]).not.toHaveProperty('credentialFields')
  })

  it('声明空字段表 → 装配期炸(声明了却没内容是配置错误)', () => {
    expect(() => createProviderPlugin({
      description: 'x',
      credentialFields: [],
      actions: { a: { description: 'a', effect: 'read', inputSchema: z.strictObject({}) } },
      handlers: { a: () => ({}) },
    })).toThrow(/至少要声明一个字段/)
  })
})

describe('调用面', () => {
  it('字段被解析后经 ctx.credentials 给 handler', async () => {
    const auth = encodeCredentialValues({ appId: 'cli_x', appSecret: 's3cret', region: 'cn' })
    const res = await call(multiFieldPlugin(), auth)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      content: { appId: 'cli_x', appSecret: 's3cret', region: 'cn' },
    })
  })

  it('可选字段缺省不报错', async () => {
    const auth = encodeCredentialValues({ appId: 'cli_x', appSecret: 's3cret' })
    await expect((await call(multiFieldPlugin(), auth)).json()).resolves.toEqual({
      content: { appId: 'cli_x', appSecret: 's3cret', region: null },
    })
  })

  it('**缺必填字段 → 400 且点名缺哪个**(不是笼统的"凭证不可用")', async () => {
    const res = await call(multiFieldPlugin(), encodeCredentialValues({ appId: 'cli_x' }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string, message: string }
    expect(body.code).toBe('invalid_argument')
    expect(body.message).toContain('appSecret')
  })

  it('secret 存的是单值而非 JSON → 400,消息指出该怎么写入', async () => {
    const res = await call(multiFieldPlugin(), 'sk_plain_key')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('--field')
  })

  it('整份凭证都没配 → unavailable(配置缺失,不是调用方参数错)', async () => {
    const res = await call(multiFieldPlugin(), null)
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
  })

  it('**错误消息不回显凭证值**', async () => {
    const res = await call(multiFieldPlugin(), encodeCredentialValues({ appId: 'LEAKY_VALUE_X' }))
    expect(((await res.json()) as { message: string }).message).not.toContain('LEAKY_VALUE_X')
  })
})

describe('单值凭证不受影响(向后兼容)', () => {
  it('明文原样进 ctx.upstreamAuth,ctx.credentials 为 undefined', async () => {
    await expect((await call(singleValuePlugin(), 'sk_plain_key')).json()).resolves.toEqual({
      content: { raw: 'sk_plain_key', credentials: null },
    })
  })

  it('单值 provider 收到 JSON 形状的凭证也不解析(它没声明字段,平台不该替它猜)', async () => {
    const json = encodeCredentialValues({ appId: 'a' })
    await expect((await call(singleValuePlugin(), json)).json()).resolves.toEqual({
      content: { raw: json, credentials: null },
    })
  })
})
