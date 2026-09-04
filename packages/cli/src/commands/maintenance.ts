import { readFile } from 'node:fs/promises'
import { Command } from 'commander'
import { resolveTarget, withGlobalOpts } from '../args'
import { callDirect, CliError } from '../http'
import { readStdinRaw } from '../stdin'
import { printJson } from '../output'

function revision(value: string) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new CliError('revision must be a nonnegative integer')
  return Number(value)
}
async function input(file: string): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(file === '-' ? await readStdinRaw() : await readFile(file, 'utf8'))
  } catch { throw new CliError('maintenance input must be a JSON object from file/stdin') }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new CliError('maintenance input must be an object')
  return parsed as Record<string, unknown>
}

export function maintenanceCommand() {
  const command = new Command('maintenance').description('Perform database and Redis maintenance with revision and instance checks (admin)')
  command.addCommand(withGlobalOpts(new Command('status'))
    .action(async opts => printJson(await callDirect(resolveTarget(opts), '/system/maintenance/status'))))
  for (const [name, operation, field] of [['database', 'database', 'databaseUrl'], ['rotate-database-credentials', 'rotate_database_credentials', 'password']] as const) {
    command.addCommand(withGlobalOpts(new Command(name))
      .description(name === 'database' ? 'Migrate to an empty PostgreSQL database after a backup' : 'Create and verify a new database login, then retire the old login')
      .requiredOption('--revision <number>', 'Current maintenance revision', revision)
      .requiredOption('--instance-id <id>', 'Expected installation identity from tb setup status')
      .option('--file <path>', `JSON {${field}}; - reads stdin`, '-')
      .action(async (opts) => {
        const value = await input(opts.file)
        if (Object.keys(value).some(key => key !== field && !(field === 'password' && key === 'databaseAdminUrl')) || typeof value[field] !== 'string' || (value.databaseAdminUrl !== undefined && typeof value.databaseAdminUrl !== 'string')) throw new CliError(`input must contain only ${field}`)
        printJson(await callDirect(resolveTarget(opts), `/system/maintenance/${operation}`, { ...value, expectedRevision: opts.revision, expectedInstanceId: opts.instanceId }))
      }))
  }
  command.addCommand(withGlobalOpts(new Command('redis'))
    .description('Validate and switch Redis; {redisUrl:null} disables it')
    .requiredOption('--revision <number>', 'Current maintenance revision', revision)
    .option('--file <path>', 'JSON {redisUrl}; - reads stdin', '-')
    .action(async (opts) => {
      const value = await input(opts.file)
      if (Object.keys(value).some(key => key !== 'redisUrl') || (typeof value.redisUrl !== 'string' && value.redisUrl !== null)) throw new CliError('input must contain only redisUrl as a string or null')
      printJson(await callDirect(resolveTarget(opts), '/system/maintenance/redis', { ...value, expectedRevision: opts.revision }))
    }))
  return command
}
