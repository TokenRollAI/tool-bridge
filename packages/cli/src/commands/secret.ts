import { encodeCredentialValues } from '@tool-bridge/core'
import { Command } from 'commander'
import type { Page, SecretSummary } from '../types'
import { parsePageOpts, resolveTarget, withGlobalOpts, withPageOpts } from '../args'
import { printJson, printLine, table } from '../output'
import { confirmDestructive } from '../confirm'
import { callDirect, CliError } from '../http'

/** 从 stdin 读取全部内容(去掉尾随换行)——用于 secret set 避免值进 shell history。 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8').replace(/\n$/, '')
}

interface SecretGlobalOpts {
  baseUrl?: string
  cursor?: string
  json?: boolean
  limit?: string
  sk?: string
}

/**
 * `--field k=v` → 字段表。多字段凭证(plugin 的 `credentialFields`)用它写入,
 * 落库形态是一个 JSON 对象;单值凭证仍走 --value/stdin。
 */
function parseFields(entries: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (const entry of entries) {
    const at = entry.indexOf('=')
    if (at <= 0) throw new CliError(`--field must be key=value, got '${entry}'`)
    const key = entry.slice(0, at).trim()
    if (key === '') throw new CliError(`--field must be key=value, got '${entry}'`)
    if (key in values) throw new CliError(`duplicate --field key '${key}'`)
    // 值不 trim:凭证里的空白可能是有意义的。
    values[key] = entry.slice(at + 1)
  }
  return values
}

/**
 * `tb secret set --name <n> [--value <v> | --field k=v ...]` → SecretStore.Set(system/secret)。
 *
 * 单值凭证经 --value 或 stdin(建议 stdin,避免明文进 shell history)。多字段凭证
 * (plugin export 声明了 credentialFields,如飞书的 appId+appSecret)用可重复的 --field,
 * 落库为 JSON 对象。只写不读。
 */
export function secretSetCommand(): Command {
  return withGlobalOpts(new Command('set'))
    .description('Set an upstream secret (write-only; prefer stdin for value)')
    .requiredOption('--name <name>', 'Secret name')
    .option('--value <value>', 'Secret value (omit to read from stdin)')
    .option(
      '--field <key=value>',
      'One field of a multi-field credential (repeatable; mutually exclusive with --value)',
      (entry: string, previous: string[] = []) => [...previous, entry],
    )
    .action(async (opts: SecretGlobalOpts & { field?: string[], name: string, value?: string }) => {
      const asJson = Boolean(opts.json)
      const name = String(opts.name ?? '').trim()
      if (!name) throw new CliError('--name is required')

      const fields = opts.field ?? []
      if (fields.length > 0 && opts.value !== undefined) {
        throw new CliError('--field and --value are mutually exclusive')
      }

      let value: string
      if (fields.length > 0) {
        value = encodeCredentialValues(parseFields(fields))
      } else if (opts.value !== undefined) {
        value = opts.value
      } else {
        if (process.stdin.isTTY) {
          throw new CliError('provide --value, --field, or pipe the secret via stdin')
        }
        value = await readStdin()
      }

      await callDirect(resolveTarget(opts), '/system/secret/set', { name, value })
      // 只回名字与字段名,**不回显值**(字段名不是机密,能帮用户确认写对了哪几个)。
      const written = fields.length > 0 ? Object.keys(parseFields(fields)).sort() : undefined
      if (asJson) printJson({ ok: true, name, ...(written === undefined ? {} : { fields: written }) })
      else printLine(`set secret: ${name}${written === undefined ? '' : ` (fields: ${written.join(', ')})`}`)
    })
}

/** `tb secret ls` → SecretStore.List:只见 name + updatedAt(明文不回显)。 */
export function secretLsCommand(): Command {
  return withPageOpts(withGlobalOpts(new Command('ls')))
    .description('List secrets (name + updatedAt only)')
    .action(async (opts: SecretGlobalOpts) => {
      const asJson = Boolean(opts.json)
      const pageOpts = parsePageOpts(opts)
      const page = await callDirect<Page<SecretSummary>>(
        resolveTarget(opts), '/system/secret/list',
        Object.keys(pageOpts).length ? { opts: pageOpts } : {},
      )
      if (asJson) {
        printJson(page)
        return
      }
      const rows = (page.items ?? []).map(s => [s.name, s.updatedAt ?? '-'])
      printLine(table(['NAME', 'UPDATED'], rows))
      if (page.cursor) printLine(`next cursor: ${page.cursor}`)
    })
}

/** `tb secret rm <name>` → SecretStore.Delete。 */
export function secretRmCommand(): Command {
  return withGlobalOpts(new Command('rm'))
    .description('Delete a secret (nodes referencing it fail on next call)')
    .argument('<name>', 'Secret name')
    .option('--yes', 'Skip the confirmation prompt')
    .action(async (nameArg: string, opts: SecretGlobalOpts & { yes?: boolean }) => {
      const asJson = Boolean(opts.json)
      const name = String(nameArg ?? '').trim()
      if (!name) throw new CliError('secret name is required')
      await confirmDestructive(opts, `Delete secret '${name}'? Nodes referencing it will fail on next call.`)
      await callDirect(resolveTarget(opts), '/system/secret/delete', { name })
      if (asJson) printJson({ ok: true, name })
      else printLine(`deleted secret: ${name}`)
    })
}

export function secretCommand(): Command {
  return new Command('secret')
    .description('Manage upstream secrets (system/secret; admin scope)')
    .addCommand(secretSetCommand())
    .addCommand(secretLsCommand())
    .addCommand(secretRmCommand())
}
