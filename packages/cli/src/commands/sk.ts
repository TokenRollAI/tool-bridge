import { Command } from 'commander'
import { collect, resolveTarget, withGlobalOpts } from '../args'
import { CliError, callTool } from '../http'
import { guard, printJson, printLine, table } from '../output'
import { parseScope } from '../scope'
import type { Page, SecretKeyCreated, SecretKeyInput, SecretKeyView } from '../types'

interface SkGlobalOpts {
  json?: boolean
  baseUrl?: string
  sk?: string
}

export function scopeSummary(k: SecretKeyView): string {
  return (k.scopes ?? [])
    .map((s) => `${s.pattern}:${s.actions.join('+')}${s.effect === 'deny' ? '(deny)' : ''}`)
    .join(' ')
}

/** `tb sk list` → SKRegistry.List(system/sk),裁掉 hash。 */
export function skListCommand(): Command {
  return withGlobalOpts(new Command('list'))
    .description('List secret keys (hash never returned)')
    .action(async (opts: SkGlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const page = await callTool<Page<SecretKeyView>>(
          resolveTarget(opts),
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
    })
}

interface SkCreateOpts extends SkGlobalOpts {
  owner: string
  scope: string[]
  registerPath: string[]
  expires?: string
  description?: string
}

/**
 * `tb sk create` → SKRegistry.Write(system/sk)。
 * --owner(必填)/--scope(可重复 "pattern:actions")/--register-path(可重复)/--expires/--description。
 * 明文 secret 仅签发一次:人类模式醒目警示,--json 原样输出 {key, secret}。
 */
export function skCreateCommand(): Command {
  return withGlobalOpts(new Command('create'))
    .description('Issue a new secret key (secret shown ONCE)')
    .requiredOption('--owner <ref>', 'Owner ref, e.g. user:alice / agent:x')
    .option('--scope <scope>', 'Scope "pattern:actions" (repeatable)', collect, [])
    .option('--register-path <prefix>', 'Allowed register path prefix (repeatable)', collect, [])
    .option('--expires <ts>', 'Expiry ISO 8601 timestamp')
    .option('--description <text>', 'Human description')
    .action(async (opts: SkCreateOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const owner = String(opts.owner ?? '').trim()
        if (!owner) throw new CliError('--owner is required')

        const scopes = opts.scope.map(parseScope)
        const registerPaths = opts.registerPath
        const input: SecretKeyInput = {
          owner,
          scopes,
          ...(registerPaths.length ? { registerPaths } : {}),
          ...(opts.expires ? { expiresAt: String(opts.expires) } : {}),
          ...(opts.description ? { description: String(opts.description) } : {}),
        }

        const created = await callTool<SecretKeyCreated>(
          resolveTarget(opts),
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
    })
}

/** `tb sk rm <id>` → SKRegistry.Delete(吊销)。 */
export function skRmCommand(): Command {
  return withGlobalOpts(new Command('rm'))
    .description('Revoke (delete) a secret key')
    .argument('<id>', 'Secret key id')
    .action(async (idArg: string, opts: SkGlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const id = String(idArg ?? '').trim()
        if (!id) throw new CliError('secret key id is required')
        await callTool(resolveTarget(opts), '/system/sk', 'delete', { id })
        if (asJson) printJson({ ok: true, id })
        else printLine(`revoked SK: ${id}`)
      })
    })
}

export function skCommand(): Command {
  return new Command('sk')
    .description('Manage secret keys (system/sk; admin scope)')
    .addCommand(skListCommand())
    .addCommand(skCreateCommand())
    .addCommand(skRmCommand())
}
