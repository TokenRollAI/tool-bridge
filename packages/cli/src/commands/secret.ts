import { defineCommand } from 'citty'
import { globalArgs, resolveTarget } from '../args'
import { CliError, callTool } from '../http'
import { guard, printJson, printLine, table } from '../output'
import type { Page, SecretSummary } from '../types'

/** 从 stdin 读取全部内容(去掉尾随换行)——用于 secret set 避免值进 shell history。 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8').replace(/\n$/, '')
}

/**
 * `tb secret set --name <n> [--value <v>]` → SecretStore.Set(system/secret)。
 * 值经 --value 或 stdin(建议 stdin,避免明文进 shell history)。只写不读(Proto §2.5)。
 */
export const secretSetCommand = defineCommand({
  meta: { name: 'set', description: 'Set an upstream secret (write-only; prefer stdin for value)' },
  args: {
    ...globalArgs,
    name: { type: 'string', description: 'Secret name', required: true },
    value: { type: 'string', description: 'Secret value (omit to read from stdin)' },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const name = String(args.name ?? '').trim()
      if (!name) throw new CliError('--name is required')
      let value = args.value as string | undefined
      if (value === undefined) {
        if (process.stdin.isTTY) {
          throw new CliError('provide --value or pipe the secret via stdin')
        }
        value = await readStdin()
      }
      await callTool(resolveTarget(args), '/system/secret', 'set', { name, value })
      if (asJson) printJson({ ok: true, name })
      else printLine(`set secret: ${name}`)
    })
  },
})

/** `tb secret ls` → SecretStore.List:只见 name + updatedAt(明文不回显)。 */
export const secretLsCommand = defineCommand({
  meta: { name: 'ls', description: 'List secrets (name + updatedAt only)' },
  args: globalArgs,
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const page = await callTool<Page<SecretSummary>>(
        resolveTarget(args),
        '/system/secret',
        'list',
        {},
      )
      if (asJson) {
        printJson(page)
        return
      }
      const rows = (page.items ?? []).map((s) => [s.name, s.updatedAt ?? '-'])
      printLine(table(['NAME', 'UPDATED'], rows))
    })
  },
})

/** `tb secret rm <name>` → SecretStore.Delete。 */
export const secretRmCommand = defineCommand({
  meta: { name: 'rm', description: 'Delete a secret' },
  args: {
    ...globalArgs,
    name: { type: 'positional', description: 'Secret name', required: true },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const name = String(args.name ?? '').trim()
      if (!name) throw new CliError('secret name is required')
      await callTool(resolveTarget(args), '/system/secret', 'delete', { name })
      if (asJson) printJson({ ok: true, name })
      else printLine(`deleted secret: ${name}`)
    })
  },
})

export const secretCommand = defineCommand({
  meta: { name: 'secret', description: 'Manage upstream secrets (system/secret; admin scope)' },
  subCommands: {
    set: secretSetCommand,
    ls: secretLsCommand,
    rm: secretRmCommand,
  },
})
