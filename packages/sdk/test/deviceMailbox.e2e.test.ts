import { MemoryMailboxRepository, MemoryStateStore, SecretStoreImpl } from '@tool-bridge/core'
import { createTbApp, processDeviceHello, runBootstrap } from '@tool-bridge/app'
import { describe, expect, it, vi } from 'vitest'
import {
  createDeviceMailboxProcessor,
  type DeviceOperationJournal,
  type DeviceOperationJournalEntry,
} from '../src/device/index'
import { createToolBridgeClient } from '../src/client/index'

const ADMIN_SK = 'tbk_test_admin_key_0000000000'
const ENCRYPTION_KEY = '3ZwpbBkSrp3eT9ylcZedfN33yq9fJLlmeusH98qNbt8'
const BASE_URL = 'https://local-mailbox.test'

class CountingStateStore extends MemoryStateStore {
  readonly counts = {
    compareAndSwap: 0,
    delete: 0,
    get: 0,
    getMany: 0,
    list: 0,
    put: 0,
    putIfAbsent: 0,
  }

  resetCounts(): void {
    for (const key of Object.keys(this.counts) as Array<keyof typeof this.counts>) {
      this.counts[key] = 0
    }
  }

  override async compareAndSwap(
    key: string,
    expectedRevision: number | null,
    value: unknown | null,
  ): Promise<boolean> {
    this.counts.compareAndSwap++
    return await super.compareAndSwap(key, expectedRevision, value)
  }

  override async delete(key: string): Promise<void> {
    this.counts.delete++
    await super.delete(key)
  }

  override async get(key: string): Promise<unknown | null> {
    this.counts.get++
    return await super.get(key)
  }

  override async getMany(keys: readonly string[]): Promise<Map<string, unknown>> {
    this.counts.getMany++
    return await super.getMany(keys)
  }

  override async list(
    prefix: string,
    opts?: { cursor?: string, limit?: number },
  ): Promise<{ cursor?: string, items: Array<{ key: string, value: unknown }> }> {
    this.counts.list++
    return await super.list(prefix, opts)
  }

  override async put(key: string, value: unknown): Promise<void> {
    this.counts.put++
    await super.put(key, value)
  }

  override async putIfAbsent(key: string, value: unknown): Promise<boolean> {
    this.counts.putIfAbsent++
    return await super.putIfAbsent(key, value)
  }
}

class RecordingJournal implements DeviceOperationJournal {
  readonly entries = new Map<string, DeviceOperationJournalEntry>()
  readonly events: string[] = []

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

interface IssuedKey {
  key: { id: string }
  secret: string
}

describe('server Agent -> gateway -> Device SDK mailbox', () => {
  it('completes the local durable round trip with five HTTP requests on the discovery path', async () => {
    const state = new CountingStateStore()
    await runBootstrap(state, { adminSk: ADMIN_SK })
    const app = createTbApp({
      allowInsecureHttp: false,
      encryptionKey: ENCRYPTION_KEY,
      remote: {
        allowInsecure: false,
        allowlist: [],
        instanceId: 'local-mailbox-e2e',
        maxHops: 4,
      },
      secrets: new SecretStoreImpl(state, ENCRYPTION_KEY),
      state,
      version: 'test',
      mailboxRepository: new MemoryMailboxRepository(),
    })
    const requests: Array<{ authorization: string | null, method: string, path: string }> = []
    const fetcher: typeof fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push({
        authorization: request.headers.get('authorization'),
        method: request.method,
        path: new URL(request.url).pathname,
      })
      return await app.request(request)
    }
    const admin = createToolBridgeClient({ baseUrl: BASE_URL, fetcher, sk: ADMIN_SK })
    const device = await admin.invokeJson<IssuedKey>('system/sk/write', {
      owner: 'device:phone-1',
      scopes: [{ pattern: 'device/**', actions: ['read', 'call', 'register'] }],
    })
    const agent = await admin.invokeJson<IssuedKey>('system/sk/write', {
      owner: 'agent:server-worker',
      scopes: [{ pattern: 'device/**', actions: ['read', 'call'] }],
    })
    const expose = {
      nodes: [{
        path: 'tools/mail',
        kind: 'tool' as const,
        description: 'mail',
        cmds: [{ name: 'send', delivery: 'both' as const }],
      }],
    }
    await processDeviceHello({
      authorization: `Bearer ${device.secret}`,
      deviceIdHint: 'phone-1',
      hello: { deviceId: 'phone-1', expose },
      store: state,
    })
    requests.length = 0
    state.resetCounts()

    const agentClient = createToolBridgeClient({
      baseUrl: BASE_URL,
      fetcher,
      sk: agent.secret,
    })
    const help = await agentClient.getHelp('device/phone-1/tools/mail')
    expect(help.cmds).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'send', delivery: 'both' }),
    ]))
    const delivery = await agentClient.invokeJson(
      'device/phone-1/tools/mail/send',
      { text: 'hello from server Agent' },
      { delivery: 'fallback', idempotencyKey: 'agent-task-1' },
    )
    expect(delivery.delivery).toBe('mailbox')
    if (delivery.delivery !== 'mailbox') throw new Error('expected mailbox delivery')
    const queued = delivery.operation

    const journal = new RecordingJournal()
    const handler = vi.fn(async ({ arguments: args }) => ({
      delivered: true,
      text: args.text,
    }))
    const processor = createDeviceMailboxProcessor({
      baseUrl: BASE_URL,
      credentialProvider: {
        prepare: () => ({ headers: { authorization: `Bearer ${device.secret}` } }),
      },
      deviceId: 'phone-1',
      expose,
      fetcher,
      handler,
      journal,
    })
    const processed = await processor.pullOnce()
    expect(processed).toMatchObject({
      processed: true,
      operation: {
        operationId: queued.operationId,
        result: { delivered: true, text: 'hello from server Agent' },
        state: 'succeeded',
      },
    })
    expect(handler).toHaveBeenCalledOnce()
    expect(journal.events).toEqual([
      `get:${queued.operationId}`,
      'put:discovered',
      'put:executing',
      'put:terminal',
      `remove:${queued.operationId}`,
    ])

    const detail = await agentClient.deviceOperations.get('phone-1', queued.operationId)
    expect(detail).toMatchObject({
      result: { delivered: true, text: 'hello from server Agent' },
      state: 'succeeded',
    })
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /device/phone-1/tools/mail/~help',
      'POST /device/phone-1/tools/mail/send',
      'POST /~device/mailbox/claim',
      'POST /~device/mailbox/complete',
      'POST /~device/operations/get',
    ])
    expect(requests.filter(({ authorization }) => authorization === `Bearer ${agent.secret}`))
      .toHaveLength(3)
    expect(requests.filter(({ authorization }) => authorization === `Bearer ${device.secret}`))
      .toHaveLength(2)
    // 小邮箱快路径的存储成本基线：enqueue/claim/complete 各一次 CAS，cap 与 claim
    // Domain repositories own the ledger; StateStore has no operation mutations/scans.
    // get 包含五次 Bearer 鉴权和 registry 精确读取，保留
    // 小幅实现余量，但防止无意引入数量级回归。
    expect(state.counts.compareAndSwap).toBe(0)
    expect(state.counts.list).toBe(0)
    expect(state.counts.get).toBeLessThanOrEqual(20)
  })
})
