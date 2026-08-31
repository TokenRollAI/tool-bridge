import { encodeCredentialValues } from '@tool-bridge/core'
import { Command } from 'commander'
import type { Page, SecretSummary } from '../types'
import { parseFieldSpecs, parsePageOpts, resolveTarget, withGlobalOpts, withPageOpts } from '../args'
import { printJson, printLine, table } from '../output'
import { confirmDestructive } from '../confirm'
import { readStdinCredential } from '../stdin'
import { callDirect, CliError } from '../http'

/**
 * `tb secret set --name <n> [--value <v> | --field k=v ...]` → SecretStore.Set(system/secret)。
 *
 * 单值凭证经 --value 或 stdin(建议 stdin,避免明文进 shell history)。多字段凭证
 * (plugin export 声明了 credentialFields,如飞书的 appId+appSecret)用可重复的 --field,
 * 落库为 JSON 对象。只写不读。
 */
export function secretSetCommand() {
  return withGlobalOpts(new Command('set'))
    .description('Set an upstream secret (write-only; prefer stdin for value)')
    .requiredOption('--name <name>', 'Secret name')
    .option('--value <value>', 'Secret value (omit to read from stdin)')
    .option(
      '--field <key=value>',
      'One field of a multi-field credential (repeatable; mutually exclusive with --value)',
      (entry: string, previous: string[] = []) => [...previous, entry],
    )
    .action(async (opts) => {
      const asJson = Boolean(opts.json)
      const name = String(opts.name ?? '').trim()
      if (!name) throw new CliError('--name is required')

      const fields = opts.field ?? []
      if (fields.length > 0 && opts.value !== undefined) {
        throw new CliError('--field and --value are mutually exclusive')
      }

      let value: string
      if (fields.length > 0) {
        // 多字段凭证(plugin 的 `credentialFields`)经 --field 写入,落库形态是一个 JSON 对象。
        value = encodeCredentialValues(parseFieldSpecs(fields))
      } else if (opts.value !== undefined) {
        value = opts.value
      } else {
        if (process.stdin.isTTY) {
          throw new CliError('provide --value, --field, or pipe the secret via stdin')
        }
        value = await readStdinCredential()
      }

      await callDirect(resolveTarget(opts), '/system/secret/set', { name, value })
      // 只回名字与字段名,**不回显值**(字段名不是机密,能帮用户确认写对了哪几个)。
      const written = fields.length > 0 ? Object.keys(parseFieldSpecs(fields)).sort() : undefined
      if (asJson) printJson({ ok: true, name, ...(written === undefined ? {} : { fields: written }) })
      else printLine(`set secret: ${name}${written === undefined ? '' : ` (fields: ${written.join(', ')})`}`)
    })
}

/** `tb secret ls` → SecretStore.List:只见 name + updatedAt(明文不回显)。 */
export function secretLsCommand() {
  return withPageOpts(withGlobalOpts(new Command('ls')))
    .description('List secrets (name + updatedAt only)')
    .action(async (opts) => {
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
export function secretRmCommand() {
  return withGlobalOpts(new Command('rm'))
    .description('Delete a secret (nodes referencing it fail on next call)')
    .argument('<name>', 'Secret name')
    .option('--yes', 'Skip the confirmation prompt')
    .action(async (nameArg, opts) => {
      const asJson = Boolean(opts.json)
      const name = String(nameArg ?? '').trim()
      if (!name) throw new CliError('secret name is required')
      await confirmDestructive(opts, `Delete secret '${name}'? Nodes referencing it will fail on next call.`)
      await callDirect(resolveTarget(opts), '/system/secret/delete', { name })
      if (asJson) printJson({ ok: true, name })
      else printLine(`deleted secret: ${name}`)
    })
}

export function secretCommand() {
  return new Command('secret')
    .description('Manage upstream secrets (system/secret; admin scope)')
    .addCommand(secretSetCommand())
    .addCommand(secretLsCommand())
    .addCommand(secretRmCommand())
}
