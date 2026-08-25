#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import process from 'node:process'

/** 一次 registry metadata 请求得到 exact versions 与 latest；畸形响应一律 fail closed。 */
export async function npmRegistrySnapshot(name, fetcher = globalThis.fetch) {
  if (typeof name !== 'string' || name === '') throw new TypeError('package name is required')
  if (typeof fetcher !== 'function') throw new TypeError('fetcher must be a function')

  const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  })
  if (response.status === 404) return { exists: false, latest: null, versions: new Set() }
  if (!response.ok) throw new Error(`registry ${name} → HTTP ${response.status}`)

  const body = await response.json()
  const versions = body?.versions
  if (versions === null || typeof versions !== 'object' || Array.isArray(versions)) {
    throw new Error(`registry ${name} 缺少 versions 对象`)
  }
  const latest = body?.['dist-tags']?.latest
  return {
    exists: true,
    latest: typeof latest === 'string' ? latest : null,
    versions: new Set(Object.keys(versions)),
  }
}

export async function npmRegistryVersionState(name, version, fetcher = globalThis.fetch) {
  if (typeof version !== 'string' || version === '') throw new TypeError('package version is required')
  const snapshot = await npmRegistrySnapshot(name, fetcher)
  return snapshot.versions.has(version) ? 'present' : 'absent'
}

const isMain = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === process.argv[1]

if (isMain) {
  try {
    process.stdout.write(`${await npmRegistryVersionState(process.argv[2], process.argv[3])}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
