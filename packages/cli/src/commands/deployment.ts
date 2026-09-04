import { readFile } from 'node:fs/promises'
import { Command } from 'commander'
import { resolveTarget, withGlobalOpts } from '../args'
import { runDeploymentAgent } from '../deploymentAgent'
import { callDirect, CliError } from '../http'
import { readStdinRaw } from '../stdin'
import { printJson } from '../output'

export function deploymentCommand() {
  const command = new Command('deployment').description('Manage a local Compose app through a restricted deployment agent')
  for (const name of ['get', 'status', 'schema'] as const) {
    command.addCommand(withGlobalOpts(new Command(name)).action(async opts => printJson(await callDirect(resolveTarget(opts), `/system/deployment/${name}`))))
  }
  command.addCommand(withGlobalOpts(new Command('update'))
    .requiredOption('--revision <number>', 'Current deployment revision')
    .option('--file <path>', 'Deployment settings JSON file; - reads stdin', '-')
    .action(async (opts) => {
      const revision = Number(opts.revision)
      if (!/^\d+$/.test(opts.revision) || !Number.isSafeInteger(revision)) throw new CliError('revision must be a nonnegative integer')
      let settings: unknown
      try {
        settings = JSON.parse(opts.file === '-' ? await readStdinRaw() : await readFile(opts.file, 'utf8'))
      } catch {
        throw new CliError('invalid deployment JSON file')
      }
      printJson(await callDirect(resolveTarget(opts), '/system/deployment/update', { expectedRevision: revision, settings }))
    }))
  command.addCommand(withGlobalOpts(new Command('agent'))
    .requiredOption('--compose <path>', 'Compose YAML file on this deployment host; only app can be changed')
    .option('--once', 'Observe/claim once and exit', false)
    .action(async opts => runDeploymentAgent({ compose: opts.compose, once: opts.once, target: resolveTarget(opts) })))
  return command
}
