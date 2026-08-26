import { cancel, confirm, isCancel } from '@clack/prompts'
import { Command } from 'commander'
import {
  daemonLogs,
  daemonStatus,
  type DaemonStatus,
  installDaemon,
  restartDaemon,
  runDaemon,
  uninstallDaemon,
} from '../daemon'
import {
  type ConnectArgs,
  prepareConnect,
  withDeviceConnectionGlobalOpts,
} from './connect'
import { asArray, printJson, printLine } from '../output'
import { collect, withGlobalOpts } from '../args'
import { CliError } from '../http'

interface LocalOpts {
  baseUrl?: string
  json?: boolean
  sk?: string
  timeout?: string
}

interface DaemonInstallOpts extends Omit<ConnectArgs, 'url'> {
  yes?: boolean
}

function assertLocalOpts(opts: LocalOpts): void {
  const invalid = [
    opts.baseUrl !== undefined ? '--base-url' : undefined,
    opts.sk !== undefined ? '--sk' : undefined,
    opts.timeout !== undefined ? '--timeout' : undefined,
  ].filter((value): value is string => value !== undefined)
  if (invalid.length > 0) {
    throw new CliError(`${invalid.join(', ')} do not apply to local daemon lifecycle commands`)
  }
}

async function confirmAllowAll(opts: DaemonInstallOpts): Promise<void> {
  const allow = asArray(opts.allow)
  if (allow.length !== 1 || allow[0] !== '*' || opts.yes) return
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new CliError(`--allow '*' grants remote arbitrary command execution; pass --yes to confirm`)
  }
  const accepted = await confirm({
    message: `--allow '*' permits remote arbitrary commands as this Linux user. Continue?`,
    initialValue: false,
  })
  if (isCancel(accepted) || !accepted) {
    cancel('Daemon installation cancelled')
    throw new CliError('daemon installation cancelled')
  }
}

function printStatus(status: DaemonStatus): void {
  printLine(`installed:  ${status.installed ? 'yes' : 'no'}`)
  printLine(`enabled:    ${status.enabled ? 'yes' : 'no'}`)
  printLine(`active:     ${status.active ? 'yes' : 'no'}`)
  printLine(`connection: ${status.connection}`)
  if (status.deviceId) printLine(`device:     ${status.deviceId}`)
  if (status.mountPath) printLine(`path:       ${status.mountPath}`)
}

function daemonInstallCommand() {
  return withDeviceConnectionGlobalOpts(new Command('install'))
    .description('Install or update the local device as a persistent systemd user service')
    .argument('[url]', 'Gateway base URL (mutually exclusive with --base-url)')
    .option('--device-id <id>', 'Override stable local device id')
    .option('--path <path>', 'Mount path (default: device/<device-id>)')
    .option(
      '--allow <cmd>',
      'Allowed shell command (repeatable, or "*"); mutually exclusive with --no-shell',
      collect,
      [],
    )
    .option('--fs <root>', 'Expose local filesystem root (repeatable)', collect, [])
    .option('--fs-readonly', 'Expose fs as read-only; requires at least one --fs', false)
    .option(
      '--command-profile <file>',
      'Expose a strict structured-command JSON profile (repeatable; direct argv, no implicit shell)',
      collect,
      [],
    )
    .option('--no-shell', 'Do not expose shell; mutually exclusive with --allow')
    .option('--yes', 'Confirm persistent arbitrary command execution when --allow "*" is used')
    .addHelpText(
      'after',
      `
Installs a user service, enables login linger, and starts it immediately.
The resolved gateway/SK are frozen in a private 0600 daemon config; the unit never contains the SK.

Examples:
  tb daemon install --allow git --allow npm
  tb daemon install --path device/build-01 --allow '*' --yes  # trusted machines only
  tb daemon install --no-shell --command-profile ./device-ops.json
  tb daemon install --no-shell --fs ~/projects --fs-readonly`,
    )
    .action(async (url, opts) => {
      const asJson = Boolean(opts.json)
      await confirmAllowAll(opts)
      const prepared = prepareConnect({ ...opts, url })
      const status = await installDaemon(prepared)
      if (asJson) printJson(status)
      else {
        printLine(`daemon installed for ${prepared.deviceId}`)
        printStatus(status)
        if (status.connection !== 'ready') {
          printLine('connection is still starting; inspect with `tb daemon status` or `tb daemon logs`')
        }
      }
    })
}

function daemonStatusCommand() {
  return withGlobalOpts(new Command('status'))
    .description('Show the local daemon and device connection state')
    .action(async (opts) => {
      const asJson = Boolean(opts.json)
      assertLocalOpts(opts)
      const status = await daemonStatus()
      if (asJson) printJson(status)
      else printStatus(status)
    })
}

function daemonRestartCommand() {
  return withGlobalOpts(new Command('restart'))
    .description('Restart the installed local device daemon')
    .action(async (opts) => {
      const asJson = Boolean(opts.json)
      assertLocalOpts(opts)
      const status = await restartDaemon()
      if (asJson) printJson(status)
      else {
        printLine('daemon restarted')
        printStatus(status)
      }
    })
}

function daemonUninstallCommand() {
  return withGlobalOpts(new Command('uninstall'))
    .description('Stop and remove the local daemon (does not revoke or delete the login profile)')
    .action(async (opts) => {
      const asJson = Boolean(opts.json)
      assertLocalOpts(opts)
      const result = await uninstallDaemon()
      if (asJson) printJson(result)
      else printLine(result.removed ? 'daemon uninstalled' : 'daemon is not installed')
    })
}

function parseLines(value: string): number {
  const lines = Number(value)
  if (!Number.isInteger(lines) || lines < 1 || lines > 10_000) {
    throw new CliError('--lines must be an integer between 1 and 10000')
  }
  return lines
}

function daemonLogsCommand() {
  return withGlobalOpts(new Command('logs'))
    .description('Read local daemon logs from the systemd user journal')
    .option('--follow', 'Follow new log entries', false)
    .option('--lines <n>', 'Number of existing lines to show (1-10000)', '100')
    .action(async (opts) => {
      const asJson = Boolean(opts.json)
      assertLocalOpts(opts)
      if (asJson) throw new CliError('--json is not supported with daemon logs')
      await daemonLogs({ follow: Boolean(opts.follow), lines: parseLines(opts.lines) })
    })
}

function daemonRunCommand() {
  return new Command('_run')
    .description('Internal systemd entrypoint')
    .requiredOption('--config <path>', 'Absolute daemon config path')
    .action(async (opts) => {
      await runDaemon(String(opts.config))
    })
}

export function daemonCommand() {
  const command = new Command('daemon').description('Manage the persistent local device connection')
  command.addCommand(daemonInstallCommand())
  command.addCommand(daemonStatusCommand())
  command.addCommand(daemonLogsCommand())
  command.addCommand(daemonRestartCommand())
  command.addCommand(daemonUninstallCommand())
  command.addCommand(daemonRunCommand(), { hidden: true })
  return command
}
