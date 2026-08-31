import {
  createDeviceMailboxProcessor,
  openPortableDeviceConnection,
  type OpenPortableDeviceConnectionOptions,
} from '@tool-bridge/sdk/device'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startDeviceConnection } from '../src/deviceRuntime'

const runtime = vi.hoisted(() => ({
  close: vi.fn(),
  drain: vi.fn(async () => ({ processed: 0 })),
  options: undefined as OpenPortableDeviceConnectionOptions | undefined,
}))

vi.mock('@tool-bridge/sdk/device', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tool-bridge/sdk/device')>()
  return {
    ...actual,
    createDeviceMailboxProcessor: vi.fn(() => ({
      drain: runtime.drain,
      pullOnce: vi.fn(),
    })),
    openPortableDeviceConnection: vi.fn((options: OpenPortableDeviceConnectionOptions) => {
      runtime.options = options
      return {
        ready: new Promise<string>(() => {}),
        closed: new Promise<void>(() => {}),
        state: 'connecting' as const,
        close: runtime.close,
        restart: vi.fn(),
        resume: vi.fn(),
        suspend: vi.fn(),
      }
    }),
  }
})

vi.mock('../src/deviceMailboxJournal', () => ({
  createFileDeviceOperationJournal: vi.fn(() => ({
    get: vi.fn(async () => null),
    put: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  })),
}))

afterEach(() => {
  runtime.close.mockClear()
  runtime.drain.mockClear()
  runtime.options = undefined
  vi.mocked(createDeviceMailboxProcessor).mockClear()
  vi.mocked(openPortableDeviceConnection).mockClear()
})

describe('CLI device Mailbox lifecycle', () => {
  it('为 mailbox-capable profile 建 processor，并在每次 ready 后 drain', async () => {
    const handle = startDeviceConnection({
      baseUrl: 'https://gateway.example',
      sk: 'tbk_device',
      deviceId: 'device-1',
      expose: {
        nodes: [{
          path: 'ops',
          kind: 'tool',
          description: 'operations',
          cmds: [{ name: 'sync', delivery: 'both' }],
        }],
      },
      commandProfiles: [{
        version: 1,
        path: 'ops',
        description: 'operations',
        commands: [{
          name: 'sync',
          description: 'sync state',
          executable: '/usr/bin/true',
          effect: 'write',
          delivery: 'both',
        }],
      }],
    })

    expect(createDeviceMailboxProcessor).toHaveBeenCalledOnce()
    runtime.options?.onStateChange?.('ready')
    await vi.waitFor(() => expect(runtime.drain).toHaveBeenCalledOnce())
    await new Promise<void>(resolve => setImmediate(resolve))

    runtime.options?.onStateChange?.('reconnecting')
    runtime.options?.onStateChange?.('ready')
    await vi.waitFor(() => expect(runtime.drain).toHaveBeenCalledTimes(2))

    const processorOptions = vi.mocked(createDeviceMailboxProcessor).mock.calls[0]![0]
    processorOptions.credentialProvider.invalidate?.({
      code: 'permission_denied',
      message: 'device credential rejected',
      retryable: false,
    })
    await expect(handle.closed).rejects.toMatchObject({ code: 'permission_denied' })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(runtime.close).toHaveBeenCalledOnce()
  })
})
