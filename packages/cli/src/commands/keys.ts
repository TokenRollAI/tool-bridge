import type { KeyBackup } from '@tool-bridge/sdk/client'
import { Command, Option } from 'commander'
import { open, rm } from 'node:fs/promises'
import { resolveTarget, withGlobalOpts } from '../args'
import { callDirect, CliError } from '../http'
import { printJson } from '../output'

function revision(value: string) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new CliError('revision must be a nonnegative integer')
  return Number(value)
}
export function keysCommand() {
  const command = new Command('keys').description('Manage encryption and signing roots, resumable rotation, retirement and explicit backups (admin)')
  command.addCommand(withGlobalOpts(new Command('status'))
    .action(async opts => printJson(await callDirect(resolveTarget(opts), '/system/keys/status'))))
  command.addCommand(withGlobalOpts(new Command('rotate'))
    .addOption(new Option('--target <kind>', 'Key domain').choices(['encryption', 'signing']).makeOptionMandatory())
    .requiredOption('--revision <number>', 'Current keyring revision', revision)
    .option('--revoke-existing', 'Invalidate outstanding signing tokens immediately', false)
    .action(async (opts) => {
      if (opts.revokeExisting && opts.target !== 'signing') throw new CliError('--revoke-existing is only available for signing keys')
      printJson(await callDirect(resolveTarget(opts), '/system/keys/rotate', { expectedRevision: opts.revision, target: opts.target, ...(opts.revokeExisting ? { revokeExisting: true } : {}) }))
    }))
  command.addCommand(withGlobalOpts(new Command('resume'))
    .argument('<job-id>', 'Encryption rotation job')
    .action(async (jobId, opts) => printJson(await callDirect(resolveTarget(opts), '/system/keys/resume', { jobId }))))
  command.addCommand(withGlobalOpts(new Command('retire'))
    .argument('<key-id>', 'Inactive key to retire after all references and retention expire')
    .addOption(new Option('--target <kind>', 'Key domain').choices(['encryption', 'signing']).makeOptionMandatory())
    .requiredOption('--revision <number>', 'Current keyring revision', revision)
    .action(async (keyId, opts) => printJson(await callDirect(resolveTarget(opts), '/system/keys/retire', { expectedRevision: opts.revision, keyId, target: opts.target }))))
  command.addCommand(withGlobalOpts(new Command('backup'))
    .description('Write a secret backup to a new 0600 file; never print secret material')
    .requiredOption('--out <path>', 'New output file; existing files are never overwritten')
    .action(async (opts) => {
      let file
      try {
        file = await open(opts.out, 'wx', 0o600)
      } catch {
        throw new CliError('cannot create backup file; choose a new writable path')
      }
      try {
        const backup = await callDirect<KeyBackup>(resolveTarget(opts), '/system/keys/backup')
        await file.writeFile(`${JSON.stringify(backup, null, 2)}\n`, 'utf8')
        await file.sync()
      } catch {
        await file.close()
        await rm(opts.out, { force: true })
        throw new CliError('key backup failed; incomplete output was removed')
      }
      await file.close()
      printJson({ ok: true, path: opts.out })
    }))
  return command
}
