import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import { resolveTarget, withGlobalOpts } from '../args'
import { CliError, callDirect, callDirectText, callTool, callToolText } from '../http'
import { guard, printJson, printLine } from '../output'

/** 解析 --args / --args-file 为 arguments 对象(互斥;缺省 {})。 */
export function parseCallArgs(argsStr?: string, argsFile?: string): Record<string, unknown> {
  if (argsStr !== undefined && argsFile !== undefined) {
    throw new CliError('--args and --args-file are mutually exclusive')
  }
  let raw: string | undefined
  if (argsFile !== undefined) {
    try {
      raw = readFileSync(argsFile, 'utf8')
    } catch (err) {
      throw new CliError(`cannot read --args-file "${argsFile}": ${(err as Error).message}`)
    }
  } else if (argsStr !== undefined) {
    raw = argsStr
  }
  if (raw === undefined || raw.trim() === '') return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CliError('arguments must be valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CliError('arguments must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

/**
 * `tb call <path> [--tool <name>] [--args '<json>' | --args-file <f>]` —— 数据面调用。
 * 两种形态:
 * - `--tool` 给出 → 信封 `POST /<path>` + `{tool,arguments}`(适用一切 kind:
 *   builtin/context/device 的 cmd 不在直连路由上,信封是通用入口;旧用法不变)。
 * - `--tool` 省略 → path 即直连工具路径,`POST /<path>`、body 为 arguments 本体
 *   (`~help` 对 mcp/http/tool 工具宣告的形态:`tb call docs/context7/resolve-library-id`)。
 * 默认人类模式:markdown 原样打印;`--json`:输出原始 JSON。TBError → stderr + exit 1。
 */
export interface CallArgs {
  tool?: string
  args?: string
  argsFile?: string
  json?: boolean
  baseUrl?: string
  sk?: string
}

export function callCommand(): Command {
  return withGlobalOpts(new Command('call'))
    .description('Invoke a tool: `tb call <node>/<tool>` or `tb call <node> --tool <name>`')
    .argument(
      '<path>',
      'Direct tool path (e.g. docs/context7/resolve-library-id), or node path when --tool is given',
    )
    .option('--tool <name>', 'Tool/cmd name (envelope form; works for every node kind)')
    .option('--args <json>', 'Arguments as inline JSON object')
    .option('--args-file <file>', 'Arguments from a JSON file')
    .addHelpText(
      'after',
      `
Examples:
  tb call docs/context7/resolve-library-id --args '{"libraryName":"react"}'
  tb call system/status --tool get
  tb help <path>   shows each tool's arguments schema before you call it`,
    )
    .action(async (pathArg: string, opts: CallArgs) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const path = String(pathArg ?? '').trim()
        if (!path) throw new CliError('node path is required')
        const tool = opts.tool === undefined ? undefined : String(opts.tool).trim()
        if (tool === '') throw new CliError('--tool must be non-empty when given')

        const callArgs = parseCallArgs(opts.args, opts.argsFile)
        const target = resolveTarget(opts)
        const nodeUri = `/${path.replace(/^\/+|\/+$/g, '')}`

        if (asJson) {
          const result =
            tool !== undefined
              ? await callTool<unknown>(target, nodeUri, tool, callArgs)
              : await callDirect<unknown>(target, nodeUri, callArgs)
          printJson(result)
        } else {
          const text =
            tool !== undefined
              ? await callToolText(target, nodeUri, tool, callArgs)
              : await callDirectText(target, nodeUri, callArgs)
          printLine(text.replace(/\n$/, ''))
        }
      })
    })
}
