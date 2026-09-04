import {
  createSetupClient,
  parseConfigUpdate,
  parseRuntimeConfig,
  parseStorageRotate,
  parseStorageWrite,
} from '@tool-bridge/sdk/client'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { Command } from 'commander'
import { callDirect, CliError, getFetch, requireTarget } from '../http'
import { resolveTarget, withGlobalOpts } from '../args'
import { readStdinRaw } from '../stdin'
import { printJson } from '../output'

async function readInput(file: string): Promise<unknown> {
  if (file === '-' && process.stdin.isTTY) throw new CliError('provide JSON through stdin or --file <path>')
  let raw: string
  try {
    raw = file === '-' ? await readStdinRaw() : await readFile(file, 'utf8')
  } catch {
    throw new CliError('cannot read input file')
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new CliError('input must be valid JSON')
  }
}

function revision(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new CliError('--revision must be a nonnegative integer')
  return Number(value)
}

export function configCommand() {
  const command = new Command('config').description('Manage instance settings and their applied revision (admin)')
  for (const name of ['schema', 'get', 'status'] as const) {
    command.addCommand(withGlobalOpts(new Command(name))
      .description(`${name} instance configuration`)
      .action(async opts => printJson(await callDirect(resolveTarget(opts), `/system/config/${name}`))))
  }
  command.addCommand(withGlobalOpts(new Command('validate'))
    .description('Validate runtime settings without saving')
    .option('--file <path>', 'JSON file; - reads stdin', '-')
    .action(async opts => printJson(await callDirect(resolveTarget(opts), '/system/config/validate', parseRuntimeConfig(await readInput(opts.file))))))
  command.addCommand(withGlobalOpts(new Command('update'))
    .description('Save desired runtime settings; run apply separately')
    .requiredOption('--revision <number>', 'Current configuration revision', revision)
    .option('--file <path>', 'Runtime settings JSON file; - reads stdin', '-')
    .action(async (opts) => {
      const payload = parseConfigUpdate({ expectedRevision: opts.revision, settings: await readInput(opts.file) })
      printJson(await callDirect(resolveTarget(opts), '/system/config/update', payload))
    }))
  command.addCommand(withGlobalOpts(new Command('apply'))
    .description('Apply the saved revision and report effective settings')
    .requiredOption('--revision <number>', 'Saved configuration revision', revision)
    .action(async opts => printJson(await callDirect(resolveTarget(opts), '/system/config/apply', { expectedRevision: opts.revision }))))
  return command
}

export function storageCommand() {
  const command = new Command('storage').description('Manage S3 backends and the default for new uploads (admin)')
  command.addCommand(withGlobalOpts(new Command('list')).alias('ls')
    .description('List current and historical backends without credentials')
    .action(async opts => printJson(await callDirect(resolveTarget(opts), '/system/storage/list'))))
  command.addCommand(withGlobalOpts(new Command('get'))
    .argument('<id>', 'Backend ID')
    .action(async (id, opts) => printJson(await callDirect(resolveTarget(opts), '/system/storage/get', { id }))))
  command.addCommand(withGlobalOpts(new Command('add'))
    .description('Create a backend from {name,connection}; credentials only through file/stdin')
    .option('--file <path>', 'JSON file; - reads stdin', '-')
    .action(async opts => printJson(await callDirect(resolveTarget(opts), '/system/storage/write', parseStorageWrite(await readInput(opts.file))))))
  for (const [name, operation] of [['test', 'test'], ['rm', 'delete']] as const) {
    command.addCommand(withGlobalOpts(new Command(name))
      .argument('<id>', 'Backend ID')
      .requiredOption('--revision <number>', 'Current backend revision', revision)
      .action(async (id, opts) => printJson(await callDirect(resolveTarget(opts), `/system/storage/${operation}`, { id, expectedRevision: opts.revision }))))
  }
  command.addCommand(withGlobalOpts(new Command('activate'))
    .argument('<id>', 'Backend ID')
    .requiredOption('--revision <number>', 'Current backend revision', revision)
    .requiredOption('--active-revision <number>', 'Current global active backend revision', revision)
    .action(async (id, opts) => printJson(await callDirect(resolveTarget(opts), '/system/storage/activate', { id, expectedRevision: opts.revision, expectedActiveRevision: opts.activeRevision }))))
  command.addCommand(withGlobalOpts(new Command('update'))
    .description('Rotate credentials while preserving the immutable backend location')
    .argument('<id>', 'Backend ID')
    .requiredOption('--revision <number>', 'Current backend revision', revision)
    .option('--file <path>', '{accessKeyId,secretAccessKey} JSON file; - reads stdin', '-')
    .action(async (id, opts) => {
      const credentials = await readInput(opts.file)
      if (credentials === null || typeof credentials !== 'object' || Array.isArray(credentials)) throw new CliError('input must be a credential object')
      const payload = parseStorageRotate({ ...credentials, id, expectedRevision: opts.revision })
      printJson(await callDirect(resolveTarget(opts), '/system/storage/update', payload))
    }))
  return command
}

async function readPairingToken(file: string): Promise<string> {
  let token: string
  try {
    token = (file === '-' ? await readStdinRaw() : await readFile(file, 'utf8')).replace(/\r?\n$/, '')
  } catch { throw new CliError('cannot read pairing token') }
  if (!token) throw new CliError('pairing token is empty')
  return token
}

export function setupCommand() {
  const command = new Command('setup').description('Pair, install or recover a self-hosted instance; no Admin SK required')
  command.addCommand(withGlobalOpts(new Command('pair'))
    .description('Issue a short-lived pairing token through the locally installed admin utility')
    .requiredOption('--directory <path>', 'Persistent bootstrap directory')
    .option('--recovery', 'Pair for recovery of an initialized instance', false)
    .action(async (opts) => {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('tool-bridge-admin', [opts.recovery ? 'recover' : 'pair', '--directory', opts.directory], { stdio: 'inherit', shell: false })
        child.once('error', () => reject(new CliError('cannot start tool-bridge-admin; install @tool-bridge/server on this deployment host')))
        child.once('close', code => code === 0 ? resolve() : reject(new CliError('local pairing command failed')))
      })
    }))
  command.addCommand(withGlobalOpts(new Command('status'))
    .description('Read installation and recovery state')
    .action(async (opts) => {
      const target = resolveTarget(opts)
      printJson(await createSetupClient({ baseUrl: requireTarget(target).baseUrl, fetcher: getFetch(), timeoutMs: target.timeoutMs }).status())
    }))
  command.addCommand(withGlobalOpts(new Command('defaults'))
    .description('Read available bundled services without credentials')
    .requiredOption('--token-file <path>', 'Pairing token file; - reads stdin')
    .action(async (opts) => {
      const token = await readPairingToken(opts.tokenFile)
      const target = resolveTarget(opts)
      printJson(await createSetupClient({ baseUrl: requireTarget(target).baseUrl, fetcher: getFetch(), timeoutMs: target.timeoutMs }).defaults(token))
    }))
  command.addCommand(withGlobalOpts(new Command('configure'))
    .description('Complete installation; save the returned Admin SK')
    .requiredOption('--token-file <path>', 'Pairing token file; - reads stdin')
    .option('--file <path>', 'Setup JSON file; - reads stdin', '-')
    .action(async (opts) => {
      if (opts.tokenFile === '-' && opts.file === '-') throw new CliError('token and configuration cannot both read stdin')
      const token = await readPairingToken(opts.tokenFile)
      const target = resolveTarget(opts)
      printJson(await createSetupClient({ baseUrl: requireTarget(target).baseUrl, fetcher: getFetch(), timeoutMs: target.timeoutMs ?? 120000 }).configure(token, await readInput(opts.file)))
    }))
  command.addCommand(withGlobalOpts(new Command('recover'))
    .description('Recover an initialized instance with a separate recovery pairing token')
    .requiredOption('--token-file <path>', 'Recovery token file; - reads stdin')
    .option('--file <path>', 'Recovery connection settings JSON file; - reads stdin', '-')
    .option('--backup-file <path>', 'Explicit key backup JSON file (kept only in memory)')
    .action(async (opts) => {
      if ([opts.tokenFile, opts.file, opts.backupFile].filter(value => value === '-').length > 1) throw new CliError('only one recovery input may read stdin')
      const token = await readPairingToken(opts.tokenFile)
      const value = await readInput(opts.file)
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new CliError('recovery settings must be an object')
      const backup = opts.backupFile ? await readInput(opts.backupFile) : undefined
      const target = resolveTarget(opts)
      printJson(await createSetupClient({ baseUrl: requireTarget(target).baseUrl, fetcher: getFetch(), timeoutMs: target.timeoutMs ?? 120000 }).recover(token, { ...value, ...(backup === undefined ? {} : { backup }) }))
    }))
  return command
}
