import { defineCommand } from 'citty'
import { globalArgs, repeatableArg, resolveTarget } from '../args'
import { CliError, callTool } from '../http'
import { guard, printJson, printLine, table } from '../output'
import { parseScope } from '../scope'
import type { Page, SecretKeyCreated, SecretKeyInput, SecretKeyView } from '../types'

function scopeSummary(k: SecretKeyView): string {
  return (k.scopes ?? [])
    .map((s) => `${s.pattern}:${s.actions.join('+')}${s.effect === 'deny' ? '(deny)' : ''}`)
    .join(' ')
}

/** `tb sk list` → SKRegistry.List(system/sk),裁掉 hash。 */
export const skListCommand = defineCommand({
  meta: { name: 'list', description: 'List secret keys (hash never returned)' },
  args: globalArgs,
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const page = await callTool<Page<SecretKeyView>>(
        resolveTarget(args),
        '/system/sk',
        'list',
        {},
      )
      if (asJson) {
        printJson(page)
        return
      }
      const rows = (page.items ?? []).map((k) => [
        k.id,
        k.owner,
        k.disabled ? 'disabled' : 'active',
        k.expiresAt ?? '-',
        scopeSummary(k),
      ])
      printLine(table(['ID', 'OWNER', 'STATE', 'EXPIRES', 'SCOPES'], rows))
    })
  },
})

/**
 * `tb sk create` → SKRegistry.Write(system/sk)。
 * --owner(必填)/--scope(可重复 "pattern:actions")/--register-path(可重复)/--expires/--description。
 * 明文 secret 仅签发一次:人类模式醒目警示,--json 原样输出 {key, secret}。
 */
export const skCreateCommand = defineCommand({
  meta: { name: 'create', description: 'Issue a new secret key (secret shown ONCE)' },
  args: {
    ...globalArgs,
    owner: { type: 'string', description: 'Owner ref, e.g. user:alice / agent:x', required: true },
    scope: { type: 'string', description: 'Scope "pattern:actions" (repeatable)' },
    'register-path': { type: 'string', description: 'Allowed register path prefix (repeatable)' },
    expires: { type: 'string', description: 'Expiry ISO 8601 timestamp' },
    description: { type: 'string', description: 'Human description' },
  },
  async run({ args, rawArgs }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const owner = String(args.owner ?? '').trim()
      if (!owner) throw new CliError('--owner is required')

      const scopes = repeatableArg(args.scope, rawArgs, 'scope').map(parseScope)
      const registerPaths = repeatableArg(args['register-path'], rawArgs, 'register-path')
      const input: SecretKeyInput = {
        owner,
        scopes,
        ...(registerPaths.length ? { registerPaths } : {}),
        ...(args.expires ? { expiresAt: String(args.expires) } : {}),
        ...(args.description ? { description: String(args.description) } : {}),
      }

      const created = await callTool<SecretKeyCreated>(
        resolveTarget(args),
        '/system/sk',
        'write',
        input as unknown as Record<string, unknown>,
      )

      if (asJson) {
        printJson(created)
        return
      }
      printLine(`created SK: ${created.key.id} (owner ${created.key.owner})`)
      printLine('')
      printLine('!! SECRET (shown once — store it now, it cannot be retrieved again):')
      printLine(`   ${created.secret}`)
    })
  },
})

/** `tb sk rm <id>` → SKRegistry.Delete(吊销)。 */
export const skRmCommand = defineCommand({
  meta: { name: 'rm', description: 'Revoke (delete) a secret key' },
  args: {
    ...globalArgs,
    id: { type: 'positional', description: 'Secret key id', required: true },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const id = String(args.id ?? '').trim()
      if (!id) throw new CliError('secret key id is required')
      await callTool(resolveTarget(args), '/system/sk', 'delete', { id })
      if (asJson) printJson({ ok: true, id })
      else printLine(`revoked SK: ${id}`)
    })
  },
})

export const skCommand = defineCommand({
  meta: { name: 'sk', description: 'Manage secret keys (system/sk; admin scope)' },
  subCommands: {
    list: skListCommand,
    create: skCreateCommand,
    rm: skRmCommand,
  },
})
