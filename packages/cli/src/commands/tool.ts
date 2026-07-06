import { defineCommand } from 'citty'
import { globalArgs, resolveTarget } from '../args'
import { CliError } from '../http'
import { guard, printJson, printLine } from '../output'
import { buildVirtualize, deleteNode, parseToolsFile, registerNode } from '../registry'
import type { NodeConfig, NodeInput } from '../types'

/**
 * `tb tool mount <path>` —— 挂载 mcp / http 工具源(NodeRegistry.Write via ~register,§3.3)。
 * mcp:`--kind mcp --url <u> [--auth-ref name]`。
 * http:`--kind http --endpoint <u> --tools-file <json> [--auth-ref name]`。
 * 共用:`--description d` 与虚拟化 `--prefix p / --rename from=to / --hide t / --describe from=text`。
 */
export const toolMountCommand = defineCommand({
  meta: { name: 'mount', description: 'Mount an mcp/http tool source' },
  args: {
    ...globalArgs,
    path: { type: 'positional', description: 'Tree path to mount at', required: true },
    kind: { type: 'string', description: 'Source kind: mcp | http', required: true },
    url: { type: 'string', description: '[mcp] Streamable HTTP URL' },
    endpoint: { type: 'string', description: '[http] base endpoint URL' },
    'tools-file': { type: 'string', description: '[http] JSON file of HttpToolDef[]' },
    'auth-ref': { type: 'string', description: 'SecretStore ref for upstream credential' },
    'auth-header': { type: 'string', description: '[http] header name for authRef credential' },
    'auth-scheme': {
      type: 'string',
      description: '[http] auth scheme; empty string sends the secret as-is',
    },
    description: { type: 'string', description: 'One-line node description' },
    prefix: { type: 'string', description: 'Virtualize: prefix added to tool names' },
    rename: { type: 'string', description: 'Virtualize: rename "from=to" (repeatable)' },
    hide: { type: 'string', description: 'Virtualize: hide tool name (repeatable)' },
    describe: {
      type: 'string',
      description: 'Virtualize: override description "from=text" (repeatable)',
    },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const path = String(args.path ?? '').trim()
      if (!path) throw new CliError('tree path is required')
      const kind = String(args.kind ?? '').trim()
      const authRef = args['auth-ref'] ? String(args['auth-ref']) : undefined

      let config: NodeConfig
      if (kind === 'mcp') {
        const url = String(args.url ?? '').trim()
        if (!url) throw new CliError('--url is required for --kind mcp')
        config = { kind: 'mcp', url, ...(authRef ? { authRef } : {}) }
      } else if (kind === 'http') {
        const endpoint = String(args.endpoint ?? '').trim()
        if (!endpoint) throw new CliError('--endpoint is required for --kind http')
        const toolsFile = String(args['tools-file'] ?? '').trim()
        if (!toolsFile) throw new CliError('--tools-file is required for --kind http')
        const tools = parseToolsFile(toolsFile)
        const authHeader =
          args['auth-header'] !== undefined ? String(args['auth-header']).trim() : undefined
        const authScheme =
          args['auth-scheme'] !== undefined ? String(args['auth-scheme']) : undefined
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

      const virtualize = buildVirtualize(args)
      const input: NodeInput = {
        path,
        kind,
        description: args.description ? String(args.description) : '',
        config,
        ...(virtualize ? { virtualize } : {}),
      }

      const node = await registerNode(resolveTarget(args), input)
      if (asJson) printJson(node)
      else printLine(`mounted ${kind} node at ${path}`)
    })
  },
})

/** `tb tool rm <path>` —— 卸载节点(管理面 system/registry delete,§3.3)。 */
export const toolRmCommand = defineCommand({
  meta: { name: 'rm', description: 'Unmount a tool node' },
  args: {
    ...globalArgs,
    path: { type: 'positional', description: 'Tree path to remove', required: true },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const path = String(args.path ?? '').trim()
      if (!path) throw new CliError('tree path is required')
      await deleteNode(resolveTarget(args), path, ['mcp', 'http'])
      if (asJson) printJson({ ok: true, path })
      else printLine(`removed node: ${path}`)
    })
  },
})

export const toolCommand = defineCommand({
  meta: { name: 'tool', description: 'Mount/remove mcp & http tool sources' },
  subCommands: {
    mount: toolMountCommand,
    rm: toolRmCommand,
  },
})
