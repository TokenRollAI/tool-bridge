import { describe, expect, it, vi } from 'vitest'
import {
  createDeviceMailboxProcessor,
  type DeviceOperationJournal,
  type DeviceOperationJournalEntry,
} from '../src/device/index'

const OPERATION_ID = 'dop_AAAAAAAAAAAAAAAAAAAAAAAA'
const SERVER_NOW = '2026-08-28T00:00:00.000Z'
const EXPIRES_AT = '2026-08-29T00:00:00.000Z'
const LEASE_UNTIL = '2026-08-28T00:01:00.000Z'

const claim = {
  operationId: OPERATION_ID,
  targetPath: 'device/phone-1/tools/mail/send',
  path: 'tools/mail/send',
  arguments: { text: 'hello' },
  caller: { keyId: 'caller-key', owner: 'agent:alice' },
  traceId: 'trace-1',
  createdAt: SERVER_NOW,
  expiresAt: EXPIRES_AT,
  attempt: 1,
  leaseId: 'lease-1',
  leaseUntil: LEASE_UNTIL,
}

function detail(state: 'succeeded' | 'rejected' | 'failed' | 'result_unknown', extra = {}) {
  return {
    operationId: OPERATION_ID,
    deviceId: 'phone-1',
    mountPath: 'device/phone-1',
    targetPath: 'device/phone-1/tools/mail/send',
    caller: claim.caller,
    traceId: 'trace-1',
    createdAt: SERVER_NOW,
    updatedAt: SERVER_NOW,
    expiresAt: EXPIRES_AT,
    state,
    attempt: 1,
    executionMayHaveOccurred: false,
    terminalAt: SERVER_NOW,
    ...extra,
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

class MemoryJournal implements DeviceOperationJournal {
  readonly events: string[] = []
  readonly entries = new Map<string, DeviceOperationJournalEntry>()

  async get(operationId: string): Promise<DeviceOperationJournalEntry | null> {
    this.events.push(`get:${operationId}`)
    return this.entries.get(operationId) ?? null
  }

  async put(entry: DeviceOperationJournalEntry): Promise<void> {
    this.events.push(`put:${entry.state}`)
    this.entries.set(entry.operationId, structuredClone(entry))
  }

  async remove(operationId: string): Promise<void> {
    this.events.push(`remove:${operationId}`)
    this.entries.delete(operationId)
  }
}

function processor(
  fetcher: typeof fetch,
  journal: DeviceOperationJournal,
  overrides: Partial<Parameters<typeof createDeviceMailboxProcessor>[0]> = {},
) {
  return createDeviceMailboxProcessor({
    baseUrl: 'https://gw.example',
    deviceId: 'phone-1',
    credentialProvider: {
      prepare: () => ({ headers: { authorization: 'Bearer device-secret' } }),
    },
    expose: {
      nodes: [{
        path: 'tools/mail',
        kind: 'tool',
        description: 'mail',
        cmds: [{ name: 'send', delivery: 'both' }],
      }],
    },
    fetcher,
    handler: async () => ({ delivered: true }),
    journal,
    ...overrides,
  })
}

describe('device durable mailbox processor', () => {
  it('journals discovered/executing/terminal before acknowledging a successful operation', async () => {
    const requests: Array<{ body: Record<string, unknown>, path: string }> = []
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push({ path, body })
      if (path.endsWith('/claim')) return json({ serverNow: SERVER_NOW, operation: claim })
      if (path.endsWith('/complete')) {
        return json(detail('succeeded', { result: { delivered: true } }))
      }
      throw new Error(`unexpected ${path}`)
    })
    const journal = new MemoryJournal()
    const handler = vi.fn(async () => ({ delivered: true }))
    const value = processor(fetcher as typeof fetch, journal, { handler })

    const result = await value.pullOnce()
    expect(result).toMatchObject({ processed: true, operation: { state: 'succeeded' } })
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      id: OPERATION_ID,
      path: 'tools/mail/send',
      arguments: { text: 'hello' },
      context: expect.objectContaining({ traceId: 'trace-1' }),
    }))
    expect(journal.events).toEqual([
      `get:${OPERATION_ID}`,
      'put:discovered',
      'put:executing',
      'put:terminal',
      `remove:${OPERATION_ID}`,
    ])
    expect(requests.map(request => request.path)).toEqual([
      '/~device/mailbox/claim',
      '/~device/mailbox/complete',
    ])
    expect(requests[1]?.body).toMatchObject({
      operationId: OPERATION_ID,
      leaseId: 'lease-1',
      outcome: 'succeeded',
      result: { delivered: true },
    })
  })

  it('turns a recovered executing journal entry into result_unknown without rerunning the handler', async () => {
    const completions: Record<string, unknown>[] = []
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/claim')) return json({ serverNow: SERVER_NOW, operation: claim })
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      completions.push(body)
      return json(detail('result_unknown', { error: body.error }))
    })
    const journal = new MemoryJournal()
    journal.entries.set(OPERATION_ID, {
      operationId: OPERATION_ID,
      expiresAt: EXPIRES_AT,
      state: 'executing',
      updatedAt: SERVER_NOW,
    })
    const handler = vi.fn()

    await processor(fetcher as typeof fetch, journal, { handler }).pullOnce()
    expect(handler).not.toHaveBeenCalled()
    expect(completions[0]).toMatchObject({
      outcome: 'result_unknown',
      error: { retryable: false },
    })
    expect(journal.entries.has(OPERATION_ID)).toBe(false)
  })

  it('live-revalidates the current expose declaration and rejects a removed mailbox command', async () => {
    let completion: Record<string, unknown> | undefined
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/claim')) return json({ serverNow: SERVER_NOW, operation: claim })
      completion = JSON.parse(String(init?.body)) as Record<string, unknown>
      return json(detail('rejected', { error: completion.error }))
    })
    const journal = new MemoryJournal()
    const handler = vi.fn()
    await processor(fetcher as typeof fetch, journal, {
      handler,
      expose: {
        nodes: [{
          path: 'tools/mail',
          kind: 'tool',
          description: 'mail',
          cmds: [{ name: 'send', delivery: 'realtime' }],
        }],
      },
    }).pullOnce()
    expect(handler).not.toHaveBeenCalled()
    expect(completion).toMatchObject({
      outcome: 'rejected',
      error: { code: 'invalid_argument', retryable: false },
    })
  })

  it('continues a bounded prefix scan when a page has no claimable operation', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ serverNow: SERVER_NOW, cursor: 'next-page' }))
      .mockResolvedValueOnce(json({ serverNow: SERVER_NOW }))
    const result = await processor(fetcher as typeof fetch, new MemoryJournal()).drain()
    expect(result).toEqual({ processed: 0, serverNow: SERVER_NOW })
    const second = fetcher.mock.calls[1] as unknown as [string, RequestInit]
    expect(JSON.parse(String(second[1].body))).toEqual({
      deviceId: 'phone-1',
      cursor: 'next-page',
    })
  })

  it('fails closed without a durable journal or with credential-controlled reserved headers', async () => {
    expect(() => processor(vi.fn() as unknown as typeof fetch, null as never)).toThrowError(
      /durable journal/,
    )
    const invalid = processor(vi.fn() as unknown as typeof fetch, new MemoryJournal(), {
      credentialProvider: {
        prepare: () => ({
          headers: {
            'authorization': 'Bearer device-secret',
            'x-tb-idempotency-key': 'forged',
          },
        }),
      },
    })
    await expect(invalid.pullOnce()).rejects.toMatchObject({ code: 'invalid_argument' })
  })
})
