#!/usr/bin/env node

import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'

const sharedBuildFiles = new Set([
  '.github/workflows/ci.yml',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'turbo.json',
])

const sharedRuntimePrefixes = [
  'packages/app/',
  'packages/core/',
  'packages/dashboard/',
  'packages/plugin-sdk/',
  'packages/plugins/',
]

function normalizedPath(path) {
  return path.trim().replace(/^\.\//, '')
}

function matches(path, exactFiles, prefixes) {
  return exactFiles.has(path) || prefixes.some(prefix => path.startsWith(prefix))
}

export function deploymentTargets(paths) {
  const normalized = paths.map(normalizedPath).filter(Boolean)
  const shared = path => matches(path, sharedBuildFiles, sharedRuntimePrefixes)

  return {
    cloudflare: normalized.some(path => shared(path) || matches(path, new Set([
      'scripts/provision.mjs',
    ]), ['packages/gateway/'])),
    railway: normalized.some(path => shared(path) || matches(path, new Set([
      '.dockerignore',
      'Dockerfile.railway',
    ]), ['packages/server/'])),
  }
}

function main() {
  const paths = readFileSync(0, 'utf8').split(/\r?\n/)
  const targets = deploymentTargets(paths)
  process.stdout.write(`railway=${targets.railway}\ncloudflare=${targets.cloudflare}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
