#!/usr/bin/env node

import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'

// Railway GitHub Source 的 Watch Paths 配置在平台侧；这里保留可测试的同形判定，
// 让路径边界在仓库内可审阅。GitHub Actions 本身只做验证，不调用本脚本部署。

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

export function railwayDeploymentNeeded(paths) {
  const normalized = paths.map(normalizedPath).filter(Boolean)
  const shared = path => matches(path, sharedBuildFiles, sharedRuntimePrefixes)

  return normalized.some(path => shared(path) || matches(path, new Set([
    '.dockerignore',
    'Dockerfile.railway',
  ]), ['packages/server/']))
}

function main() {
  const paths = readFileSync(0, 'utf8').split(/\r?\n/)
  process.stdout.write(`railway=${railwayDeploymentNeeded(paths)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
