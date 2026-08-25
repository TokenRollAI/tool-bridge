#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import process from 'node:process'

export async function npmRegistryVersionState(name, version, fetcher = globalThis.fetch) {
  if (typeof name !== 'string' || name === '' || typeof version !== 'string' || version === '') {
    throw new TypeError('package name and version are required')
  }
  if (typeof fetcher !== 'function') throw new TypeError('fetcher must be a function')

  const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  })
  if (response.status === 404) return 'absent'
  if (!response.ok) throw new Error(`registry ${name} → HTTP ${response.status}`)

  const body = await response.json()
  const versions = body?.versions
  return versions !== null
    && typeof versions === 'object'
    && Object.hasOwn(versions, version)
    ? 'present'
    : 'absent'
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
