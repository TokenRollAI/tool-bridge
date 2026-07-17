import { Command } from 'commander'
import type { Page, SecretSummary } from '../types'
import { guard, printJson, printLine, table } from '../output'
import { resolveTarget, withGlobalOpts } from '../args'
import { callTool, CliError } from '../http'

/** 从 stdin 读取全部内容(去掉尾随换行)——用于 secret set 避免值进 shell history。 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8').replace(/\n$/, '')
}

interface SecretGlobalOpts {
  baseUrl?: string
  json?: boolean
  sk?: string
}

/**
 * `tb secret set --name <n> [--value <v>]` → SecretStore.Set(system/secret)。
 * 值经 --value 或 stdin(建议 stdin,避免明文进 shell history)。只写不读。
 */
export function secretSetCommand(): Command {
  return withGlobalOpts(new Command('set'))
    .description('Set an upstream secret (write-only; prefer stdin for value)')
    .requiredOption('--name <name>', 'Secret name')
    .option('--value <value>', 'Secret value (omit to read from stdin)')
    .action(async (opts: SecretGlobalOpts & { name: string, value?: string }) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const name = String(opts.name ?? '').trim()
        if (!name) throw new CliError('--name is required')
        let value = opts.value
        if (value === undefined) {
          if (process.stdin.isTTY) {
            throw new CliError('provide --value or pipe the secret via stdin')
          }
          value = await readStdin()
        }
        await callTool(resolveTarget(opts), '/system/secret', 'set', { name, value })
        if (asJson) printJson({ ok: true, name })
        else printLine(`set secret: ${name}`)
      })
    })
}

/** `tb secret ls` → SecretStore.List:只见 name + updatedAt(明文不回显)。 */
export function secretLsCommand(): Command {
  return withGlobalOpts(new Command('ls'))
    .description('List secrets (name + updatedAt only)')
    .action(async (opts: SecretGlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const page = await callTool<Page<SecretSummary>>(
          resolveTarget(opts),
          '/system/secret',
          'list',
          {},
        )
        if (asJson) {
          printJson(page)
          return
        }
        const rows = (page.items ?? []).map(s => [s.name, s.updatedAt ?? '-'])
        printLine(table(['NAME', 'UPDATED'], rows))
      })
    })
}

/** `tb secret rm <name>` → SecretStore.Delete。 */
export function secretRmCommand(): Command {
  return withGlobalOpts(new Command('rm'))
    .description('Delete a secret')
    .argument('<name>', 'Secret name')
    .action(async (nameArg: string, opts: SecretGlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const name = String(nameArg ?? '').trim()
        if (!name) throw new CliError('secret name is required')
        await callTool(resolveTarget(opts), '/system/secret', 'delete', { name })
        if (asJson) printJson({ ok: true, name })
        else printLine(`deleted secret: ${name}`)
      })
    })
}

export function secretCommand(): Command {
  return new Command('secret')
    .description('Manage upstream secrets (system/secret; admin scope)')
    .addCommand(secretSetCommand())
    .addCommand(secretLsCommand())
    .addCommand(secretRmCommand())
}
