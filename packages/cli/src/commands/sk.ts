import { Command } from 'commander'
import type { Page, SecretKeyCreated, SecretKeyInput, SecretKeyView } from '../types'
import {
  collect,
  parseIsoTimestamp,
  parsePageOpts,
  resolveTarget,
  withGlobalOpts,
  withPageOpts,
} from '../args'
import { guard, printJson, printLine, table } from '../output'
import { callTool, CliError } from '../http'
import { parseScope } from '../scope'

interface SkGlobalOpts {
  baseUrl?: string
  cursor?: string
  json?: boolean
  limit?: string
  sk?: string
}

export function scopeSummary(k: SecretKeyView): string {
  return (k.scopes ?? [])
    .map(s => `${s.pattern}:${s.actions.join('+')}${s.effect === 'deny' ? '(deny)' : ''}`)
    .join(' ')
}

function printKey(k: SecretKeyView): void {
  printLine(`id:          ${k.id}`)
  printLine(`owner:       ${k.owner}`)
  printLine(`state:       ${k.disabled ? 'disabled' : 'active'}`)
  printLine(`expires:     ${k.expiresAt ?? 'never'}`)
  printLine(`description: ${k.description ?? '-'}`)
  printLine(`scopes:      ${scopeSummary(k) || '-'}`)
  printLine(`register:    ${(k.registerPaths ?? []).join(', ') || '-'}`)
}

/** `tb sk list` → SKRegistry.List(system/sk),裁掉 hash。 */
export function skListCommand(): Command {
  return withPageOpts(withGlobalOpts(new Command('list')))
    .description('List secret keys (hash never returned)')
    .action(async (opts: SkGlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const pageOpts = parsePageOpts(opts)
        const page = await callTool<Page<SecretKeyView>>(
          resolveTarget(opts),
          '/system/sk',
          'list',
          Object.keys(pageOpts).length ? { opts: pageOpts } : {},
        )
        if (asJson) {
          printJson(page)
          return
        }
        const rows = (page.items ?? []).map(k => [
          k.id,
          k.owner,
          k.disabled ? 'disabled' : 'active',
          k.expiresAt ?? '-',
          scopeSummary(k),
        ])
        printLine(table(['ID', 'OWNER', 'STATE', 'EXPIRES', 'SCOPES'], rows))
        if (page.cursor) printLine(`next cursor: ${page.cursor}`)
      })
    })
}

/** `tb sk get <id>` → SKRegistry.Get。 */
export function skGetCommand(): Command {
  return withGlobalOpts(new Command('get'))
    .description('Show one secret key (hash and plaintext secret are never returned)')
    .argument('<id>', 'Secret key id')
    .action(async (idArg: string, opts: SkGlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const id = String(idArg ?? '').trim()
        if (!id) throw new CliError('secret key id is required')
        const key = await callTool<SecretKeyView>(resolveTarget(opts), '/system/sk', 'get', { id })
        if (asJson) printJson(key)
        else printKey(key)
      })
    })
}

interface SkCreateOpts extends SkGlobalOpts {
  description?: string
  expires?: string
  owner: string
  registerPath: string[]
  scope: string[]
}

/**
 * `tb sk create` → SKRegistry.Write(system/sk)。
 * --owner(必填)/--scope(可重复 "pattern:actions")/--register-path(可重复)/--expires/--description。
 * 明文 secret 仅签发一次:人类模式醒目警示,--json 原样输出 {key, secret}。
 */
export function skCreateCommand(): Command {
  return withGlobalOpts(new Command('create'))
    .description('Issue a new secret key (secret shown ONCE)')
    .requiredOption('--owner <ref>', 'Owner ref: user:<name> / agent:<name> / device:<id>')
    .option(
      '--scope <scope>',
      'Scope "pattern:actions" — path glob + comma-joined actions (read/write/call/register/admin); repeatable',
      collect,
      [],
    )
    .option('--register-path <prefix>', 'Allowed register path prefix (repeatable)', collect, [])
    .option('--expires <ts>', 'Expiry ISO 8601 timestamp with timezone')
    .option('--description <text>', 'Human description')
    .addHelpText(
      'after',
      `
Examples:
  tb sk create --owner agent:researcher --scope 'docs/**:read,call' --description "read-only docs agent"
  tb sk create --owner user:alice --scope '**:read,write,call,register,admin'
  tb sk create --owner device:build-01 --scope 'device/build-01/**:read,call' --register-path device/build-01`,
    )
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
          ...(opts.expires ? { expiresAt: parseIsoTimestamp(String(opts.expires)) } : {}),
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

function collectOptional(value: string, previous?: string[]): string[] {
  return [...(previous ?? []), value]
}

interface SkUpdateOpts extends SkGlobalOpts {
  description?: string
  disable?: boolean
  enable?: boolean
  expires?: string
  owner?: string
  registerPath?: string[]
  scope?: string[]
}

/** `tb sk update <id>` → SKRegistry.Update；仅发送显式给出的字段。 */
export function skUpdateCommand(): Command {
  return withGlobalOpts(new Command('update'))
    .description('Patch an issued secret key')
    .argument('<id>', 'Secret key id')
    .option('--owner <ref>', 'New owner ref')
    .option('--scope <scope>', 'Replace scopes; repeatable "pattern:actions"', collectOptional)
    .option('--register-path <prefix>', 'Replace allowed register paths; repeatable', collectOptional)
    .option('--expires <ts>', 'Replace expiry with an ISO 8601 timestamp with timezone')
    .option('--description <text>', 'Replace human description')
    .option('--disable', 'Disable the key immediately; mutually exclusive with --enable')
    .option('--enable', 'Re-enable the key immediately; mutually exclusive with --disable')
    .action(async (idArg: string, opts: SkUpdateOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const id = String(idArg ?? '').trim()
        if (!id) throw new CliError('secret key id is required')
        if (opts.disable && opts.enable) {
          throw new CliError('--disable and --enable are mutually exclusive')
        }
        const patch: Record<string, unknown> = {}
        if (opts.owner !== undefined) {
          const owner = String(opts.owner).trim()
          if (!owner) throw new CliError('--owner must not be empty')
          patch.owner = owner
        }
        if (opts.scope !== undefined) patch.scopes = opts.scope.map(parseScope)
        if (opts.registerPath !== undefined) patch.registerPaths = opts.registerPath
        if (opts.expires !== undefined) patch.expiresAt = parseIsoTimestamp(String(opts.expires))
        if (opts.description !== undefined) patch.description = String(opts.description)
        if (opts.disable) patch.disabled = true
        if (opts.enable) patch.disabled = false
        if (Object.keys(patch).length === 0) {
          throw new CliError('nothing to update: pass at least one patch option')
        }
        const key = await callTool<SecretKeyView>(resolveTarget(opts), '/system/sk', 'update', {
          id,
          patch,
        })
        if (asJson) printJson(key)
        else printKey(key)
      })
    })
}

function skStateCommand(name: 'disable' | 'enable', disabled: boolean): Command {
  return withGlobalOpts(new Command(name))
    .description(`${disabled ? 'Disable' : 'Re-enable'} a secret key without deleting it`)
    .argument('<id>', 'Secret key id')
    .action(async (idArg: string, opts: SkGlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const id = String(idArg ?? '').trim()
        if (!id) throw new CliError('secret key id is required')
        const key = await callTool<SecretKeyView>(resolveTarget(opts), '/system/sk', 'update', {
          id,
          patch: { disabled },
        })
        if (asJson) printJson(key)
        else printLine(`${disabled ? 'disabled' : 'enabled'} SK: ${id}`)
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
    .addCommand(skGetCommand())
    .addCommand(skCreateCommand())
    .addCommand(skUpdateCommand())
    .addCommand(skStateCommand('disable', true))
    .addCommand(skStateCommand('enable', false))
    .addCommand(skRmCommand())
}
