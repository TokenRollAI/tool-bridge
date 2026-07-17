import { readFile } from 'node:fs/promises'
import { Command } from 'commander'
import type { Page } from '../types'
import { guard, printJson, printLine, table } from '../output'
import { resolveTarget, withGlobalOpts } from '../args'
import { callTool, CliError } from '../http'

/**
 * `tb plugin` → builtin `system/plugin`(PluginRegistry;全部需 admin)。
 * cmd 表 = list/get/write/update/delete/health。
 * 线格式类型仅本文件使用,故就地定义(不进 types.ts)。
 */

export interface PluginManifest {
  auth: { kind: 'platform-token' } | { kind: 'bearer', secretRef: string }
  enabled: boolean
  endpoint: string
  healthPath: string
  id: string
  interfaceVersion: string
  kind: 'tool-provider' | 'context-provider'
}

/** Write/Update 返回:manifest + pluginToken(auth=platform-token 时仅该次响应出现一次)。 */
export interface PluginRegistration extends PluginManifest {
  pluginToken?: string
}

/** health cmd 返回(探活:独立 key,按需刷新)。 */
export interface PluginHealth {
  checkedAt?: string
  consecutiveFailures?: number
  healthy: boolean
}

interface PluginOpts {
  baseUrl?: string
  json?: boolean
  sk?: string
}

interface PluginFileOpts extends PluginOpts {
  file: string
}

/** 从 stdin 读取全部内容(`--file -`;与 secret set 的 stdin 语义一致)。 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** 读 manifest 文件(`-` = stdin)并解析为对象;不做字段校验(契约校验在网关)。 */
async function readManifest(file: string): Promise<Record<string, unknown>> {
  let raw: string
  if (file === '-') {
    if (process.stdin.isTTY) {
      throw new CliError('pipe the manifest via stdin when using --file -')
    }
    raw = await readStdin()
  } else {
    try {
      raw = await readFile(file, 'utf8')
    } catch (err) {
      throw new CliError(`cannot read manifest file: ${(err as Error).message}`)
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new CliError(`invalid manifest JSON: ${(err as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError('manifest must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

/**
 * `tb plugin register --file <manifest.json>` → PluginRegistry.Write(system/plugin)。
 * pluginToken 仅注册响应出现一次:人类模式醒目警示,--json 原样输出 PluginRegistration。
 */
export function pluginRegisterCommand(): Command {
  return withGlobalOpts(new Command('register'))
    .description('Register a plugin from a manifest file (`-` = stdin)')
    .requiredOption('--file <path>', 'Manifest JSON file path, or `-` for stdin')
    .action(async (opts: PluginFileOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const file = String(opts.file ?? '').trim()
        if (!file) throw new CliError('--file is required')
        const manifest = await readManifest(file)
        const reg = await callTool<PluginRegistration>(
          resolveTarget(opts),
          '/system/plugin',
          'write',
          manifest,
        )
        if (asJson) {
          printJson(reg)
          return
        }
        printLine(`registered plugin: ${reg.id} (${reg.kind}, ${reg.endpoint})`)
        if (reg.pluginToken) {
          printLine('')
          printLine('!! PLUGIN TOKEN (shown once — store it now, it cannot be retrieved again):')
          printLine(`   ${reg.pluginToken}`)
        }
      })
    })
}

/** `tb plugin list` → PluginRegistry.List。 */
export function pluginListCommand(): Command {
  return withGlobalOpts(new Command('list'))
    .description('List registered plugins')
    .action(async (opts: PluginOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const page = await callTool<Page<PluginManifest>>(
          resolveTarget(opts),
          '/system/plugin',
          'list',
          {},
        )
        if (asJson) {
          printJson(page)
          return
        }
        const rows = (page.items ?? []).map(p => [
          p.id,
          p.kind,
          p.endpoint,
          p.enabled ? 'enabled' : 'disabled',
        ])
        printLine(table(['ID', 'KIND', 'ENDPOINT', 'STATE'], rows))
      })
    })
}

/** `tb plugin get <id>` → PluginRegistry.Get。 */
export function pluginGetCommand(): Command {
  return withGlobalOpts(new Command('get'))
    .description('Show one plugin manifest')
    .argument('<id>', 'Plugin id')
    .action(async (idArg: string, opts: PluginOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const id = String(idArg ?? '').trim()
        if (!id) throw new CliError('plugin id is required')
        const m = await callTool<PluginManifest>(resolveTarget(opts), '/system/plugin', 'get', {
          id,
        })
        if (asJson) {
          printJson(m)
          return
        }
        printLine(`id:               ${m.id}`)
        printLine(`kind:             ${m.kind}`)
        printLine(`interfaceVersion: ${m.interfaceVersion}`)
        printLine(`endpoint:         ${m.endpoint}`)
        printLine(`auth:             ${m.auth?.kind ?? '-'}`)
        printLine(`healthPath:       ${m.healthPath}`)
        printLine(`state:            ${m.enabled ? 'enabled' : 'disabled'}`)
      })
    })
}

/**
 * `tb plugin update <id> --file <patch.json>` → PluginRegistry.Update(system/plugin)。
 * patch 为 Partial<PluginManifest>;auth 切到 platform-token 时响应含一次性 pluginToken,
 * 与 register 同款醒目警示。
 */
export function pluginUpdateCommand(): Command {
  return withGlobalOpts(new Command('update'))
    .description('Update a plugin manifest with a patch file (`-` = stdin)')
    .argument('<id>', 'Plugin id')
    .requiredOption(
      '--file <path>',
      'Patch JSON file path (Partial<PluginManifest>), or `-` for stdin',
    )
    .action(async (idArg: string, opts: PluginFileOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const id = String(idArg ?? '').trim()
        if (!id) throw new CliError('plugin id is required')
        const file = String(opts.file ?? '').trim()
        if (!file) throw new CliError('--file is required')
        const patch = await readManifest(file)
        const updated = await callTool<PluginRegistration>(
          resolveTarget(opts),
          '/system/plugin',
          'update',
          { id, patch },
        )
        if (asJson) {
          printJson(updated)
          return
        }
        printLine(`updated plugin: ${updated.id} (${updated.kind}, ${updated.endpoint})`)
        if (updated.pluginToken) {
          printLine('')
          printLine('!! PLUGIN TOKEN (shown once — store it now, it cannot be retrieved again):')
          printLine(`   ${updated.pluginToken}`)
        }
      })
    })
}

/** `tb plugin health <id>` → 按需探活;unhealthy → 退出码 1。 */
export function pluginHealthCommand(): Command {
  return withGlobalOpts(new Command('health'))
    .description('Probe a plugin health endpoint (exit 1 if unhealthy)')
    .argument('<id>', 'Plugin id')
    .action(async (idArg: string, opts: PluginOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const id = String(idArg ?? '').trim()
        if (!id) throw new CliError('plugin id is required')
        const h = await callTool<PluginHealth>(resolveTarget(opts), '/system/plugin', 'health', {
          id,
        })
        if (asJson) printJson(h)
        else
          printLine(`${id}: ${h.healthy ? 'healthy' : 'unhealthy'} (checked ${h.checkedAt ?? '-'})`)
        if (!h.healthy) process.exitCode = 1
      })
    })
}

/** `tb plugin rm <id>` → PluginRegistry.Delete(与 sk rm 同为直删,无确认交互)。 */
export function pluginRmCommand(): Command {
  return withGlobalOpts(new Command('rm'))
    .description('Unregister (delete) a plugin')
    .argument('<id>', 'Plugin id')
    .action(async (idArg: string, opts: PluginOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const id = String(idArg ?? '').trim()
        if (!id) throw new CliError('plugin id is required')
        await callTool(resolveTarget(opts), '/system/plugin', 'delete', { id })
        if (asJson) printJson({ ok: true, id })
        else printLine(`removed plugin: ${id}`)
      })
    })
}

export function pluginCommand(): Command {
  return new Command('plugin')
    .description('Manage plugins (system/plugin; admin scope)')
    .addCommand(pluginRegisterCommand())
    .addCommand(pluginListCommand())
    .addCommand(pluginGetCommand())
    .addCommand(pluginUpdateCommand())
    .addCommand(pluginHealthCommand())
    .addCommand(pluginRmCommand())
}
