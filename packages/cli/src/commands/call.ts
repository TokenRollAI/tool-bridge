import { readFileSync } from 'node:fs'
import { defineCommand } from 'citty'
import { globalArgs, resolveTarget } from '../args'
import { CliError, callTool, callToolText } from '../http'
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
 * `tb call <path> --tool <name> [--args '<json>' | --args-file <f>]` —— 数据面调用(§1.4)。
 * 默认人类模式:markdown 原样打印;`--json`:输出原始 JSON。TBError → stderr + exit 1。
 */
export const callCommand = defineCommand({
  meta: { name: 'call', description: 'Invoke a tool on a node (POST /<path>)' },
  args: {
    ...globalArgs,
    path: { type: 'positional', description: 'Node tree path', required: true },
    tool: { type: 'string', description: 'Tool/cmd name', required: true },
    args: { type: 'string', description: 'Arguments as inline JSON object' },
    'args-file': { type: 'string', description: 'Arguments from a JSON file' },
  },
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const path = String(args.path ?? '').trim()
      if (!path) throw new CliError('node path is required')
      const tool = String(args.tool ?? '').trim()
      if (!tool) throw new CliError('--tool is required')

      const callArgs = parseCallArgs(
        args.args as string | undefined,
        args['args-file'] as string | undefined,
      )
      const target = resolveTarget(args)
      const nodeUri = `/${path.replace(/^\/+|\/+$/g, '')}`

      if (asJson) {
        const result = await callTool<unknown>(target, nodeUri, tool, callArgs)
        printJson(result)
      } else {
        const text = await callToolText(target, nodeUri, tool, callArgs)
        printLine(text.replace(/\n$/, ''))
      }
    })
  },
})
