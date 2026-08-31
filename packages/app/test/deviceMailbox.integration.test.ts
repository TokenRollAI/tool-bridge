import { NodeRegistryStore } from '@tool-bridge/core'
import { describe, expect, it, vi } from 'vitest'
import { processDeviceHello, type TbAppDeps } from '../src/index'
import { createTestApp, type TestApp } from './harness'
import { TEST_ADMIN_SK } from './fixtures'

interface IssuedKey {
  key: { id: string }
  secret: string
}

function auth(secret: string): RequestInit {
  return { headers: { authorization: `Bearer ${secret}` } }
}

async function postJson(
  tb: TestApp,
  path: string,
  body: unknown,
  secret = TEST_ADMIN_SK,
  headers: Record<string, string> = {},
): Promise<Response> {
  return await tb.request(`https://tb.test/${path}`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${secret}`,
      'accept': 'application/json',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

async function issueKey(tb: TestApp, owner: string, scopes: unknown[]): Promise<IssuedKey> {
  const response = await postJson(tb, 'system/sk/write', { owner, scopes })
  expect(response.status).toBe(200)
  return await response.json() as IssuedKey
}

async function disableKey(tb: TestApp, id: string): Promise<void> {
  const response = await postJson(tb, 'system/sk/update', { id, patch: { disabled: true } })
  expect(response.status).toBe(200)
}

async function mountedMailboxApp(deviceChannel?: TbAppDeps['device']): Promise<{
  caller: IssuedKey
  device: IssuedKey
  tb: TestApp
}> {
  const tb = await createTestApp({ ...(deviceChannel === undefined ? {} : { device: deviceChannel }) })
  const device = await issueKey(tb, 'device:phone-1', [{
    pattern: 'device/**',
    actions: ['read', 'call', 'register'],
  }])
  const caller = await issueKey(tb, 'agent:alice', [{
    pattern: 'device/**',
    actions: ['read', 'call'],
  }])
  await processDeviceHello({
    store: tb.state,
    authorization: `Bearer ${device.secret}`,
    deviceIdHint: 'phone-1',
    hello: {
      deviceId: 'phone-1',
      expose: {
        nodes: [
          {
            path: 'tools/mail',
            kind: 'tool',
            description: 'mailbox tools',
            cmds: [
              { name: 'send', description: 'send later', delivery: 'both' },
              { name: 'deferred', description: 'mailbox only', delivery: 'mailbox' },
              { name: 'realtime', description: 'online only' },
            ],
          },
        ],
      },
    },
  })
  return { tb, device, caller }
}

describe('durable device mailbox routes', () => {
  it('keeps an offline device command discoverable and enqueues fallback', async () => {
    const invoke = vi.fn(async () => ({
      disposition: 'not_dispatched' as const,
      result: {
        ok: false as const,
        error: { code: 'unavailable' as const, message: 'device offline', retryable: true },
      },
    }))
    const { tb, caller } = await mountedMailboxApp({
      ws: async () => new Response(null, { status: 501 }),
      invoke,
    })
    await new NodeRegistryStore(tb.state).setOnline(
      'device/phone-1',
      false,
      new Date().toISOString(),
    )

    const help = await tb.request('https://tb.test/device/phone-1/tools/mail/~help', {
      headers: { authorization: `Bearer ${caller.secret}`, accept: 'application/json' },
    })
    expect(help.status).toBe(200)

    const response = await postJson(
      tb,
      'device/phone-1/tools/mail/send',
      { '~delivery': 'fallback', 'text': 'after reconnect' },
      caller.secret,
    )
    expect(invoke).toHaveBeenCalledOnce()
    expect(response.status).toBe(202)
    expect(response.headers.get('x-tb-delivery')).toBe('mailbox')
    expect(await response.json()).toMatchObject({
      state: 'queued',
      targetPath: 'device/phone-1/tools/mail/send',
    })
  })

  it('discovers delivery and executes fallback -> claim -> renew -> complete -> get', async () => {
    const { tb, device, caller } = await mountedMailboxApp()
    const help = await tb.request('https://tb.test/device/phone-1/tools/mail/~help', {
      ...auth(caller.secret),
      headers: { authorization: `Bearer ${caller.secret}`, accept: 'application/json' },
    })
    expect(help.status).toBe(200)
    expect(await help.json()).toMatchObject({
      cmds: expect.arrayContaining([
        expect.objectContaining({ name: 'send', delivery: 'both' }),
      ]),
    })

    const deviceRoot = await postJson(tb, 'system/registry/get', {
      path: 'device/phone-1',
    })
    expect(deviceRoot.status).toBe(200)
    expect(await deviceRoot.json()).toMatchObject({
      deviceId: 'phone-1',
      path: 'device/phone-1',
    })

    const enqueued = await postJson(
      tb,
      'device/phone-1/tools/mail/send?ttlSeconds=300',
      { '~delivery': 'fallback', 'text': 'hello' },
      caller.secret,
      { 'x-tb-idempotency-key': 'send-1' },
    )
    expect(enqueued.status).toBe(202)
    expect(enqueued.headers.get('x-tb-delivery')).toBe('mailbox')
    const operation = await enqueued.json() as {
      deviceId: string
      operationId: string
      targetPath: string
    }
    expect(operation.deviceId).toBe('phone-1')
    expect(operation.targetPath).toBe('device/phone-1/tools/mail/send')

    const replay = await postJson(
      tb,
      'device/phone-1/tools/mail/send?ttlSeconds=300',
      { '~delivery': 'fallback', 'text': 'hello' },
      caller.secret,
      { 'x-tb-idempotency-key': 'send-1' },
    )
    expect(replay.status).toBe(202)
    expect(await replay.json()).toMatchObject({ operationId: operation.operationId })

    const claimResponse = await postJson(tb, '~device/mailbox/claim', {
      deviceId: 'phone-1',
    }, device.secret)
    expect(claimResponse.status).toBe(200)
    const claim = await claimResponse.json() as {
      operation: {
        arguments: unknown
        leaseId: string
        operationId: string
        targetPath: string
      }
    }
    expect(claim.operation).toMatchObject({
      operationId: operation.operationId,
      arguments: { text: 'hello' },
      targetPath: 'device/phone-1/tools/mail/send',
    })

    const renewed = await postJson(tb, '~device/mailbox/renew', {
      deviceId: 'phone-1',
      operationId: operation.operationId,
      leaseId: claim.operation.leaseId,
    }, device.secret)
    expect(renewed.status).toBe(200)
    expect(await renewed.json()).toHaveProperty('leaseUntil')

    const completed = await postJson(tb, '~device/mailbox/complete', {
      deviceId: 'phone-1',
      operationId: operation.operationId,
      leaseId: claim.operation.leaseId,
      outcome: 'succeeded',
      result: { delivered: true },
    }, device.secret)
    expect(completed.status).toBe(200)
    expect(await completed.json()).toMatchObject({
      state: 'succeeded',
      result: { delivered: true },
    })

    const detail = await postJson(tb, '~device/operations/get', {
      deviceId: 'phone-1',
      operationId: operation.operationId,
    }, caller.secret)
    expect(detail.status).toBe(200)
    expect(await detail.json()).toMatchObject({ state: 'succeeded', result: { delivered: true } })
  })

  it('rejects mailbox delivery for realtime-only and non-device targets', async () => {
    const { tb, caller } = await mountedMailboxApp()
    const realtime = await postJson(
      tb,
      'device/phone-1/tools/mail/realtime',
      { '~delivery': 'mailbox' },
      caller.secret,
    )
    expect(realtime.status).toBe(400)
    expect(await realtime.json()).toMatchObject({ code: 'invalid_argument' })

    const builtin = await postJson(
      tb,
      'system/status/get',
      { '~delivery': 'mailbox' },
      TEST_ADMIN_SK,
    )
    expect(builtin.status).toBe(400)
    expect(await builtin.json()).toMatchObject({ code: 'invalid_argument' })
  })

  it('rejects realtime invocation for a mailbox-only command', async () => {
    const { tb, caller } = await mountedMailboxApp()
    const response = await postJson(
      tb,
      'device/phone-1/tools/mail/deferred',
      {},
      caller.secret,
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining('realtime delivery'),
    })
  })

  it('returns a realtime result when fallback dispatch completes', async () => {
    const { tb, caller } = await mountedMailboxApp({
      ws: async () => new Response(null, { status: 501 }),
      invoke: async (_deviceId, request) => {
        expect(request.arguments).toEqual({ text: 'now' })
        return {
          disposition: 'completed',
          result: { ok: true, value: { delivered: 'now' } },
        }
      },
    })
    const response = await postJson(
      tb,
      'device/phone-1/tools/mail/send',
      { '~delivery': 'fallback', 'text': 'now' },
      caller.secret,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('x-tb-delivery')).toBe('realtime')
    expect(await response.json()).toEqual({ delivered: 'now' })
  })

  it('does not enqueue when fallback delivery becomes unknown after dispatch', async () => {
    const { tb, caller } = await mountedMailboxApp({
      ws: async () => new Response(null, { status: 501 }),
      invoke: async () => ({
        disposition: 'unknown',
        result: {
          ok: false,
          error: { code: 'unavailable', message: 'device disconnected', retryable: true },
        },
      }),
    })
    const response = await postJson(
      tb,
      'device/phone-1/tools/mail/send',
      { '~delivery': 'fallback', 'text': 'maybe' },
      caller.secret,
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'unavailable',
      message: expect.stringContaining('was not enqueued'),
      retryable: false,
    })
    const listed = await postJson(tb, '~device/operations/list', {
      deviceId: 'phone-1',
    }, caller.secret)
    expect(await listed.json()).toEqual({ items: [] })
  })

  it('uses an enqueue authorization snapshot after caller revocation', async () => {
    const { tb, device, caller } = await mountedMailboxApp()
    const enqueued = await postJson(
      tb,
      'device/phone-1/tools/mail/send',
      { '~delivery': 'mailbox', 'text': 'accepted-before-revoke' },
      caller.secret,
    )
    expect(enqueued.status).toBe(202)
    await disableKey(tb, caller.key.id)

    const claim = await postJson(tb, '~device/mailbox/claim', {
      deviceId: 'phone-1',
    }, device.secret)
    expect(claim.status).toBe(200)
    expect(await claim.json()).toMatchObject({
      operation: { arguments: { text: 'accepted-before-revoke' } },
    })
  })

  it('revalidates the current device bearer on every lease transition', async () => {
    const { tb, device, caller } = await mountedMailboxApp()
    expect((await postJson(
      tb,
      'device/phone-1/tools/mail/send',
      { '~delivery': 'mailbox', 'text': 'credential-lifecycle' },
      caller.secret,
    )).status).toBe(202)
    const claimResponse = await postJson(tb, '~device/mailbox/claim', {
      deviceId: 'phone-1',
    }, device.secret)
    const claim = await claimResponse.json() as {
      operation: { leaseId: string, operationId: string }
    }
    await disableKey(tb, device.key.id)

    const renew = await postJson(tb, '~device/mailbox/renew', {
      deviceId: 'phone-1',
      operationId: claim.operation.operationId,
      leaseId: claim.operation.leaseId,
    }, device.secret)
    expect(renew.status).toBe(401)
    const complete = await postJson(tb, '~device/mailbox/complete', {
      deviceId: 'phone-1',
      operationId: claim.operation.operationId,
      leaseId: claim.operation.leaseId,
      outcome: 'result_unknown',
    }, device.secret)
    expect(complete.status).toBe(401)
  })

  it('lets another key of the operation owner manage it without inheriting execution authority', async () => {
    const { tb, caller } = await mountedMailboxApp()
    const response = await postJson(
      tb,
      'device/phone-1/tools/mail/send',
      { '~delivery': 'mailbox', 'text': 'cancel me' },
      caller.secret,
    )
    const operation = await response.json() as { operationId: string }
    const ownerPeer = await issueKey(tb, 'agent:alice', [])
    const cancelled = await postJson(tb, '~device/operations/cancel', {
      deviceId: 'phone-1',
      operationId: operation.operationId,
    }, ownerPeer.secret)
    expect(cancelled.status).toBe(200)
    expect(await cancelled.json()).toMatchObject({ state: 'cancelled' })
  })

  it('does not expose hidden operations through a management-list cursor', async () => {
    const { tb, caller } = await mountedMailboxApp()
    for (const text of ['first', 'second']) {
      expect((await postJson(
        tb,
        'device/phone-1/tools/mail/send',
        { '~delivery': 'mailbox', text },
        caller.secret,
      )).status).toBe(202)
    }
    const other = await issueKey(tb, 'agent:bob', [{
      pattern: 'device/**',
      actions: ['read', 'call'],
    }])
    const hidden = await postJson(tb, '~device/operations/list', {
      deviceId: 'phone-1',
      opts: { limit: 1 },
    }, other.secret)
    expect(hidden.status).toBe(200)
    expect(await hidden.json()).toEqual({ items: [] })

    const firstPage = await postJson(tb, '~device/operations/list', {
      deviceId: 'phone-1',
      opts: { limit: 1 },
    }, caller.secret)
    const firstBody = await firstPage.json() as { cursor?: string, items: unknown[] }
    expect(firstBody.items).toHaveLength(1)
    expect(firstBody.cursor).toBeDefined()
    const secondPage = await postJson(tb, '~device/operations/list', {
      deviceId: 'phone-1',
      opts: { cursor: firstBody.cursor, limit: 1 },
    }, caller.secret)
    expect(await secondPage.json()).toMatchObject({ items: [expect.any(Object)] })
  })

  it('rejects oversized mailbox HTTP bodies before persistence', async () => {
    const { tb, caller } = await mountedMailboxApp()
    const response = await postJson(
      tb,
      'device/phone-1/tools/mail/send',
      { '~delivery': 'mailbox', 'text': 'x'.repeat(280 * 1024) },
      caller.secret,
    )
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({
      code: 'rate_limited',
      message: expect.stringContaining('request body'),
    })
  })
})
