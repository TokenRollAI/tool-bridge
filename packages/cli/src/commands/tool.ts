import { Command } from 'commander'
import { collect, resolveTarget, withGlobalOpts } from '../args'
import { CliError } from '../http'
import { guard, printJson, printLine } from '../output'
import { buildVirtualize, deleteNode, parseToolsFile, registerNode } from '../registry'
import type { NodeConfig, NodeInput } from '../types'

interface ToolMountOpts {
  json?: boolean
  baseUrl?: string
  sk?: string
  kind: string
  url?: string
  endpoint?: string
  toolsFile?: string
  authRef?: string
  authHeader?: string
  authScheme?: string
  description?: string
  prefix?: string
  rename: string[]
  hide: string[]
  describe: string[]
}

/**
 * `tb tool mount <path>` —— 挂载 mcp / http 工具源(NodeRegistry.Write via ~register)。
 * mcp:`--kind mcp --url <u> [--auth-ref name]`。
 * http:`--kind http --endpoint <u> --tools-file <json> [--auth-ref name]`。
 * 共用:`--description d` 与虚拟化 `--prefix p / --rename from=to / --hide t / --describe from=text`。
 */
export function toolMountCommand(): Command {
  return withGlobalOpts(new Command('mount'))
    .description('Mount an mcp/http tool source')
    .argument('<path>', 'Tree path to mount at')
    .requiredOption('--kind <kind>', 'Source kind: mcp | http')
    .option('--url <url>', '[mcp] Streamable HTTP URL')
    .option('--endpoint <url>', '[http] base endpoint URL')
    .option('--tools-file <file>', '[http] JSON file of HttpToolDef[]')
    .option('--auth-ref <name>', 'SecretStore ref for upstream credential')
    .option('--auth-header <name>', '[http] header name for authRef credential')
    .option('--auth-scheme <scheme>', '[http] auth scheme; empty string sends the secret as-is')
    .option('--description <text>', 'One-line node description')
    .option('--prefix <p>', 'Virtualize: prefix added to tool names')
    .option('--rename <from=to>', 'Virtualize: rename "from=to" (repeatable)', collect, [])
    .option('--hide <name>', 'Virtualize: hide tool name (repeatable)', collect, [])
    .option(
      '--describe <from=text>',
      'Virtualize: override description "from=text" (repeatable)',
      collect,
      [],
    )
    .action(async (pathArg: string, opts: ToolMountOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const path = String(pathArg ?? '').trim()
        if (!path) throw new CliError('tree path is required')
        const kind = String(opts.kind ?? '').trim()
        const authRef = opts.authRef ? String(opts.authRef) : undefined

        let config: NodeConfig
        if (kind === 'mcp') {
          const url = String(opts.url ?? '').trim()
          if (!url) throw new CliError('--url is required for --kind mcp')
          config = { kind: 'mcp', url, ...(authRef ? { authRef } : {}) }
        } else if (kind === 'http') {
          const endpoint = String(opts.endpoint ?? '').trim()
          if (!endpoint) throw new CliError('--endpoint is required for --kind http')
          const toolsFile = String(opts.toolsFile ?? '').trim()
          if (!toolsFile) throw new CliError('--tools-file is required for --kind http')
          const tools = parseToolsFile(toolsFile)
          const authHeader =
            opts.authHeader !== undefined ? String(opts.authHeader).trim() : undefined
          const authScheme = opts.authScheme !== undefined ? String(opts.authScheme) : undefined
          config = {
            kind: 'http',
            endpoint,
            tools,
            ...(authRef ? { authRef } : {}),
            ...(authHeader ? { authHeader } : {}),
            ...(authScheme !== undefined ? { authScheme } : {}),
          }
        } else {
          throw new CliError(`invalid --kind "${kind}"; valid: mcp, http`)
        }

        const virtualize = buildVirtualize({
          prefix: opts.prefix,
          rename: opts.rename,
          hide: opts.hide,
          describe: opts.describe,
        })
        const input: NodeInput = {
          path,
          kind,
          description: opts.description ? String(opts.description) : '',
          config,
          ...(virtualize ? { virtualize } : {}),
        }

        const node = await registerNode(resolveTarget(opts), input)
        if (asJson) printJson(node)
        else printLine(`mounted ${kind} node at ${path}`)
      })
    })
}

/** `tb tool rm <path>` —— 卸载节点(管理面 system/registry delete)。 */
export function toolRmCommand(): Command {
  return withGlobalOpts(new Command('rm'))
    .description('Unmount a tool node')
    .argument('<path>', 'Tree path to remove')
    .action(async (pathArg: string, opts: { json?: boolean; baseUrl?: string; sk?: string }) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const path = String(pathArg ?? '').trim()
        if (!path) throw new CliError('tree path is required')
        await deleteNode(resolveTarget(opts), path, ['mcp', 'http'])
        if (asJson) printJson({ ok: true, path })
        else printLine(`removed node: ${path}`)
      })
    })
}

export function toolCommand(): Command {
  return new Command('tool')
    .description('Mount/remove mcp & http tool sources')
    .addCommand(toolMountCommand())
    .addCommand(toolRmCommand())
}
