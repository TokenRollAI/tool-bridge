/** Host-neutral durable device mailbox assembly and bounded maintenance. */

import {
  type DeviceMailboxCleanupResult,
  DeviceMailboxService,
  TBError,
} from '@tool-bridge/core'
import type { TbAppDeps } from './deps'
import { type CursorCleanupProgress, positiveInt, runCursorCleanup } from './cursorCleanup'

export const KEY_DEVICE_MAILBOX_CLEANUP_PROGRESS = 'sys:device-mailbox-cleanup-progress:v1'

export interface CleanupDeviceMailboxOptions {
  limit?: number
  maxPages?: number
}

function parseProgress(value: unknown): CursorCleanupProgress<string> {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || typeof (value as { cursor?: unknown }).cursor !== 'string'
    || !Number.isSafeInteger((value as { revision?: unknown }).revision)
    || ((value as { revision: number }).revision < 1)
  ) throw new TBError('internal', 'device mailbox cleanup progress is invalid')
  return value as CursorCleanupProgress<string>
}

export function createDeviceMailboxService(deps: TbAppDeps): DeviceMailboxService {
  if (!deps.mailboxRepository) throw new TBError('unavailable', 'mailbox requires a domain repository')
  return new DeviceMailboxService(deps.mailboxRepository, deps.encryptionKeyring ?? deps.encryptionKey)
}

/**
 * One bounded host tick with a CAS-protected durable cursor.
 * 编排骨架与 default Store 共用(cursorCleanup.ts);此处只保留 Mailbox 的持久进度
 * 形状({cursor,revision})、页参数与结果聚合。
 */
export async function cleanupDeviceMailbox(
  deps: TbAppDeps,
  opts: CleanupDeviceMailboxOptions = {},
): Promise<DeviceMailboxCleanupResult> {
  await deps.ensureReady?.()
  if (deps.state.compareAndSwap === undefined) {
    throw new TBError('unavailable', 'device mailbox cleanup requires StateStore.compareAndSwap')
  }
  const mailbox = createDeviceMailboxService(deps)
  const maxPages = Math.min(positiveInt(opts.maxPages, 8, 'maxPages'), 64)
  const limit = Math.min(positiveInt(opts.limit, 200, 'limit'), 200)
  const aggregate: DeviceMailboxCleanupResult = { deleted: 0, expired: 0, scanned: 0 }

  const cursor = await runCursorCleanup<string>({
    // {cursor,revision} 即持久形状,原样落库。
    encodeProgress: progress => progress,
    maxPages,
    parseProgress,
    progressKey: KEY_DEVICE_MAILBOX_CLEANUP_PROGRESS,
    runPage: async (pageCursor) => {
      const page = await mailbox.cleanup({
        limit,
        ...(pageCursor === undefined ? {} : { cursor: pageCursor }),
      })
      aggregate.deleted += page.deleted
      aggregate.expired += page.expired
      aggregate.scanned += page.scanned
      return page.cursor
    },
    state: deps.state,
  })
  return { ...aggregate, ...(cursor === undefined ? {} : { cursor }) }
}
