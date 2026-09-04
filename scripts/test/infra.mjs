import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const child = spawn(
  process.execPath,
  [
    '--import',
    'tsx',
    fileURLToPath(
      new URL('../../packages/server/test/runWithInfra.ts', import.meta.url),
    ),
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
)
child.on('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
