/** Node CLI 的 installation-local durable Mailbox journal。 */

import type {
  DeviceOperationJournal,
  DeviceOperationJournalEntry,
} from '@tool-bridge/sdk/device'
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { configDir } from './config'
import { CliError } from './http'

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function journalRoot(baseUrl: string, deviceId: string): string {
  const url = new URL(baseUrl)
  const gateway = `${url.protocol}//${url.host}`
  return join(configDir(), 'device-mailbox', digest(`${gateway}\n${deviceId}`))
}

function entryPath(root: string, operationId: string): string {
  if (operationId.trim() === '') throw new CliError('device mailbox operation id is empty')
  return join(root, `${digest(operationId)}.json`)
}

function syncDirectory(path: string): void {
  const fd = openSync(path, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function durableWrite(path: string, value: DeviceOperationJournalEntry): void {
  const root = dirname(path)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  chmodSync(root, 0o700)
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    const fd = openSync(temporary, 'wx', 0o600)
    try {
      writeFileSync(fd, `${JSON.stringify(value)}\n`)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temporary, path)
    syncDirectory(root)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function parseEntry(path: string): DeviceOperationJournalEntry {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('entry is not an object')
    }
    return value as DeviceOperationJournalEntry
  } catch (error) {
    throw new CliError(`cannot read device mailbox journal: ${(error as Error).message}`)
  }
}

function removeEntry(root: string, path: string): void {
  if (!existsSync(path)) return
  rmSync(path, { force: true })
  syncDirectory(root)
}

function pruneExpired(root: string, now = Date.now()): void {
  if (!existsSync(root)) return
  for (const name of readdirSync(root)) {
    if (!name.endsWith('.json')) continue
    const path = join(root, name)
    let entry: DeviceOperationJournalEntry
    try {
      entry = parseEntry(path)
    } catch {
      // 损坏的 executing/terminal 记录不能静默删除，否则可能重复副作用。
      continue
    }
    const expiresAt = Date.parse(entry.expiresAt)
    if (Number.isFinite(expiresAt) && expiresAt <= now) removeEntry(root, path)
  }
}

/**
 * 每个 gateway + device installation 独占目录；put 在 rename 前 fsync 文件、rename 后
 * fsync 目录，确保 SDK 的 executing barrier 真正先于 handler 执行落盘。
 */
export function createFileDeviceOperationJournal(input: {
  baseUrl: string
  deviceId: string
}): DeviceOperationJournal {
  const root = journalRoot(input.baseUrl, input.deviceId)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  chmodSync(root, 0o700)
  pruneExpired(root)
  return {
    async get(operationId) {
      const path = entryPath(root, operationId)
      if (!existsSync(path)) return null
      const entry = parseEntry(path)
      if (entry.operationId !== operationId) {
        throw new CliError('device mailbox journal identity mismatch')
      }
      if (Date.parse(entry.expiresAt) <= Date.now()) {
        removeEntry(root, path)
        return null
      }
      return entry
    },
    async put(entry) {
      durableWrite(entryPath(root, entry.operationId), entry)
    },
    async remove(operationId) {
      removeEntry(root, entryPath(root, operationId))
    },
  }
}
