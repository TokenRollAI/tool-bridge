// Copy the prebuilt dashboard (npm package @tool-bridge/dashboard) into ./public,
// where wrangler.jsonc's assets.directory expects it. Runs before dev/deploy.
import { cpSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const dashboardDir = dirname(require.resolve('@tool-bridge/dashboard/package.json'))
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

rmSync(target, { recursive: true, force: true })
cpSync(join(dashboardDir, 'dist'), target, { recursive: true })
console.log(`dashboard assets → ${target}`)
