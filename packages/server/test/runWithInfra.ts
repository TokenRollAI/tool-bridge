import { spawn } from 'node:child_process'
import { startTestInfra } from './helpers/infra'

const [command, ...args] = process.argv.slice(2)
if (!command) throw new Error('Usage: node scripts/test/infra.mjs <command> [arguments...]')
const infrastructure = await startTestInfra()
try {
  const child = spawn(command, args, { env: infrastructure.env, stdio: 'inherit' })
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', code => resolve(code ?? 1))
  })
} finally {
  await infrastructure.close()
}
