import { describe, expect, it } from 'vitest'
import {
  base64urlEncode,
  DeviceMailboxService,
  MemoryStateStore,
  TBError,
} from '../../src/index'

const ENCRYPTION_KEY = base64urlEncode(new Uint8Array(32).fill(7))
const START = Date.parse('2026-08-28T00:00:00.000Z')

function sequenceRandom(): (length: number) => Uint8Array {
  let value = 0
  return length => new Uint8Array(length).fill(++value)
}

function fixture(opts: ConstructorParameters<typeof DeviceMailboxService>[2] = {}) {
  const state = new MemoryStateStore()
  let now = START
  const mailbox = new DeviceMailboxService(state, ENCRYPTION_KEY, {
    now: () => now,
    randomBytes: sequenceRandom(),
    ...opts,
  })
  const enqueue = (overrides: Partial<Parameters<typeof mailbox.enqueue>[0]> = {}) => mailbox.enqueue({
    deviceId: 'phone-1',
    deviceKeyId: 'device-key-1',
    mountPath: 'device/phone-1',
    targetPath: 'device/phone-1/tools/echo/run',
    path: 'tools/echo/run',
    arguments: { secret: 'plaintext-must-not-persist', value: 1 },
    caller: { keyId: 'caller-key-1', owner: 'agent:alice' },
    traceId: 'trace-1',
    ...overrides,
  })
  return {
    state,
    mailbox,
    enqueue,
    advance(ms: number) {
      now += ms
    },
  }
}

describe('DeviceMailboxService', () => {
  it('requires CAS and a valid deployment encryption root', () => {
    const state = new MemoryStateStore()
    const withoutCas = {
      get: state.get.bind(state),
      getMany: state.getMany.bind(state),
      put: state.put.bind(state),
      delete: state.delete.bind(state),
      list: state.list.bind(state),
    }
    expect(() => new DeviceMailboxService(withoutCas, ENCRYPTION_KEY)).toThrowError(
      /compareAndSwap/,
    )
    expect(() => new DeviceMailboxService(state, undefined)).toThrowError(
      /TB_SECRET_ENCRYPTION_KEY/,
    )
    expect(() => new DeviceMailboxService(state, 'not-a-key')).toThrowError(/encryption key/)
  })

  it('persists ciphertext, claims with the bound device key, and completes idempotently', async () => {
    const { state, mailbox, enqueue } = fixture()
    const queued = await enqueue()
    expect(queued.state).toBe('queued')

    const rows = await state.list('deviceop:')
    expect(rows.items).toHaveLength(1)
    const persisted = JSON.stringify(rows.items[0]?.value)
    expect(persisted).not.toContain('plaintext-must-not-persist')
    expect(persisted).not.toContain('"arguments"')

    const wrongKey = await mailbox.claim({
      deviceId: 'phone-1',
      deviceKeyId: 'rotated-key',
    })
    expect(wrongKey.operation).toBeUndefined()

    const claimed = await mailbox.claim({
      deviceId: 'phone-1',
      deviceKeyId: 'device-key-1',
    })
    expect(claimed.operation?.arguments).toEqual({
      secret: 'plaintext-must-not-persist',
      value: 1,
    })
    expect(claimed.operation?.attempt).toBe(1)

    const lease = claimed.operation!
    const completed = await mailbox.complete({
      deviceId: 'phone-1',
      deviceKeyId: 'device-key-1',
      operationId: lease.operationId,
      leaseId: lease.leaseId,
    }, { outcome: 'succeeded', result: { echoed: true } })
    expect(completed).toMatchObject({
      state: 'succeeded',
      result: { echoed: true },
    })

    await expect(mailbox.complete({
      deviceId: 'phone-1',
      deviceKeyId: 'device-key-1',
      operationId: lease.operationId,
      leaseId: lease.leaseId,
    }, { outcome: 'succeeded', result: { echoed: true } })).resolves.toMatchObject({
      state: 'succeeded',
    })
    await expect(mailbox.complete({
      deviceId: 'phone-1',
      deviceKeyId: 'device-key-1',
      operationId: lease.operationId,
      leaseId: lease.leaseId,
    }, { outcome: 'succeeded', result: { echoed: false } })).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it('reuses idempotent enqueue and conflicts on a changed request', async () => {
    const { enqueue } = fixture()
    const first = await enqueue({ idempotencyKey: 'retry-1' })
    const replay = await enqueue({ idempotencyKey: 'retry-1' })
    expect(replay.operationId).toBe(first.operationId)
    await expect(enqueue({
      idempotencyKey: 'retry-1',
      arguments: { value: 2 },
    })).rejects.toMatchObject({ code: 'conflict' })
  })

  it('distinguishes queued expiry from claimed expiry and never invents result_unknown', async () => {
    const { mailbox, enqueue, advance } = fixture({ defaultTtlSeconds: 5, leaseSeconds: 2 })
    const queued = await enqueue({ arguments: { n: 1 } })
    const claimedSource = await enqueue({ arguments: { n: 2 } })
    const claim = await mailbox.claim({
      deviceId: 'phone-1',
      deviceKeyId: 'device-key-1',
    })
    expect(claim.operation?.operationId).toBeDefined()

    advance(5_001)
    const queuedExpired = await mailbox.get('phone-1',
      claim.operation?.operationId === queued.operationId ? claimedSource.operationId : queued.operationId)
    const claimedExpired = await mailbox.get('phone-1', claim.operation!.operationId)
    expect(queuedExpired).toMatchObject({
      state: 'expired',
      executionMayHaveOccurred: false,
    })
    expect(claimedExpired).toMatchObject({
      state: 'expired',
      executionMayHaveOccurred: true,
    })
    expect(claimedExpired.state).not.toBe('result_unknown')
  })

  it('turns queued cancel terminal and exposes claimed cancellation through renew', async () => {
    const { mailbox, enqueue } = fixture()
    const queued = await enqueue({ arguments: { n: 1 } })
    expect(await mailbox.cancel('phone-1', queued.operationId)).toMatchObject({
      state: 'cancelled',
    })

    const second = await enqueue({ arguments: { n: 2 } })
    const claim = await mailbox.claim({
      deviceId: 'phone-1',
      deviceKeyId: 'device-key-1',
    })
    expect(claim.operation?.operationId).toBe(second.operationId)
    const requested = await mailbox.cancel('phone-1', second.operationId)
    expect(requested.state).toBe('claimed')
    expect(requested.cancelRequestedAt).toBeDefined()
    await expect(mailbox.renew({
      deviceId: 'phone-1',
      deviceKeyId: 'device-key-1',
      operationId: second.operationId,
      leaseId: claim.operation!.leaseId,
    })).resolves.toMatchObject({ cancelRequestedAt: requested.cancelRequestedAt })
  })

  it('enforces the approximate pending cap while allowing an idempotent replay', async () => {
    const { enqueue } = fixture({ maxPendingPerDevice: 1 })
    const first = await enqueue({ idempotencyKey: 'same' })
    await expect(enqueue({ idempotencyKey: 'same' })).resolves.toMatchObject({
      operationId: first.operationId,
    })
    await expect(enqueue({ arguments: { another: true } })).rejects.toMatchObject({
      code: 'rate_limited',
    })
  })

  it('expires and removes records through bounded cleanup pages', async () => {
    const { mailbox, enqueue, advance, state } = fixture({
      defaultTtlSeconds: 1,
      terminalRetentionSeconds: 1,
    })
    await enqueue()
    advance(1_001)
    expect(await mailbox.cleanup({ limit: 1 })).toMatchObject({ expired: 1, scanned: 1 })
    advance(1_001)
    expect(await mailbox.cleanup({ limit: 1 })).toMatchObject({ deleted: 1, scanned: 1 })
    expect((await state.list('deviceop:')).items).toHaveLength(0)
  })

  it('rejects completion with an inactive lease', async () => {
    const { mailbox, enqueue } = fixture()
    const op = await enqueue()
    await expect(mailbox.complete({
      deviceId: 'phone-1',
      deviceKeyId: 'device-key-1',
      operationId: op.operationId,
      leaseId: 'dop_AAAAAAAAAAAAAAAAAAAAAAAA',
    }, {
      outcome: 'failed',
      error: new TBError('internal', 'failure').toJSON(),
    })).rejects.toMatchObject({ code: 'conflict' })
  })

  it('applies the payload limit independently to terminal result data', async () => {
    const { mailbox, enqueue } = fixture({ maxPayloadBytes: 64 })
    const operation = await enqueue({ arguments: {} })
    const claim = await mailbox.claim({
      deviceId: 'phone-1',
      deviceKeyId: 'device-key-1',
    })
    await expect(mailbox.complete({
      deviceId: 'phone-1',
      deviceKeyId: 'device-key-1',
      operationId: operation.operationId,
      leaseId: claim.operation!.leaseId,
    }, {
      outcome: 'succeeded',
      result: { value: 'x'.repeat(100) },
    })).rejects.toMatchObject({ code: 'rate_limited' })
    await expect(mailbox.get('phone-1', operation.operationId)).resolves.toMatchObject({
      state: 'claimed',
    })
  })
})
