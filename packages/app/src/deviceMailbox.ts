/** Host-neutral durable device mailbox assembly and bounded maintenance. */

import {
  type DeviceMailboxCleanupResult,
  DeviceMailboxService,
  TBError,
} from '@tool-bridge/core'
import type { TbAppDeps } from './deps'

export const KEY_DEVICE_MAILBOX_CLEANUP_PROGRESS = 'sys:device-mailbox-cleanup-progress:v1'

export interface CleanupDeviceMailboxOptions {
  limit?: number
  maxPages?: number
}

interface CleanupProgress {
  cursor: string
  revision: number
}

function positiveInt(value: number | undefined, fallback: number, field: string): number {
  const actual = value ?? fallback
  if (!Number.isSafeInteger(actual) || actual < 1) {
    throw new TBError('invalid_argument', `${field} must be a positive integer`)
  }
  return actual
}

function parseProgress(value: unknown): CleanupProgress {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || typeof (value as { cursor?: unknown }).cursor !== 'string'
    || !Number.isSafeInteger((value as { revision?: unknown }).revision)
    || ((value as { revision: number }).revision < 1)
  ) throw new TBError('internal', 'device mailbox cleanup progress is invalid')
  return value as CleanupProgress
}

export function createDeviceMailboxService(deps: TbAppDeps): DeviceMailboxService {
  return new DeviceMailboxService(deps.state, deps.encryptionKey)
}

/** One bounded host tick with a CAS-protected durable cursor. */
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
  const raw = await deps.state.get(KEY_DEVICE_MAILBOX_CLEANUP_PROGRESS)
  let progress = raw === null ? null : parseProgress(raw)
  let cursor = progress?.cursor
  const aggregate: DeviceMailboxCleanupResult = { deleted: 0, expired: 0, scanned: 0 }

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    const page = await mailbox.cleanup({ limit, ...(cursor === undefined ? {} : { cursor }) })
    aggregate.deleted += page.deleted
    aggregate.expired += page.expired
    aggregate.scanned += page.scanned
    if (page.cursor === undefined) {
      if (progress !== null) {
        await deps.state.compareAndSwap(
          KEY_DEVICE_MAILBOX_CLEANUP_PROGRESS,
          progress.revision,
          null,
        )
      }
      return aggregate
    }
    const next: CleanupProgress = {
      cursor: page.cursor,
      revision: (progress?.revision ?? 0) + 1,
    }
    if (!(await deps.state.compareAndSwap(
      KEY_DEVICE_MAILBOX_CLEANUP_PROGRESS,
      progress?.revision ?? null,
      next,
    ))) return aggregate
    progress = next
    cursor = next.cursor
  }
  return { ...aggregate, ...(cursor === undefined ? {} : { cursor }) }
}
