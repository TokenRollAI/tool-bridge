import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import {
  apiJson,
  callDirect,
  callDirectText,
  callTool,
  callToolText,
  CliError,
  type Target,
} from '../http'
import { resolveTarget, withGlobalOpts } from '../args'
import { guard, printJson } from '../output'
import { printMarkdown } from '../markdown'

/** 解析 positional JSON / --args / --args-file 为 arguments 对象(三源互斥;缺省 {})。 */
export function parseCallArgs(
  argsStr?: string,
  argsFile?: string,
  positional?: string,
): Record<string, unknown> {
  const given = [
    positional !== undefined ? 'positional JSON' : null,
    argsStr !== undefined ? '--args' : null,
    argsFile !== undefined ? '--args-file' : null,
  ].filter((s): s is string => s !== null)
  if (given.length > 1) {
    throw new CliError(`${given.join(' and ')} are mutually exclusive`)
  }
  let raw: string | undefined
  if (argsFile !== undefined) {
    try {
      raw = readFileSync(argsFile, 'utf8')
    } catch (err) {
      throw new CliError(`cannot read --args-file "${argsFile}": ${(err as Error).message}`)
    }
  } else {
    raw = positional ?? argsStr
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

/** 上游/服务端类错误:值得在报错前查一眼该 path 的既往经验。 */
const FEEDBACK_HINT_CODES = new Set(['unavailable', 'internal', 'invalid_argument', 'rate_limited'])

/**
 * 调用失败时把该 path 的 `~feedback` 头部条目挂上错误(踩坑现场是查/提经验的最强触发点)。
 * 尽力而为:拉取限时 5s、任何失败静默,绝不改变主错误。
 */
export async function attachFeedbackHint(
  err: unknown,
  target: Target,
  nodeUri: string,
): Promise<void> {
  if (!(err instanceof CliError) || err.code === undefined) return
  if (!FEEDBACK_HINT_CODES.has(err.code)) return
  const cleanPath = nodeUri.replace(/^\/+/, '')
  try {
    const page = await apiJson<{ items?: Array<{ id: string, score: number, title: string }> }>(
      { ...target, timeoutMs: Math.min(target.timeoutMs ?? 5000, 5000) },
      { path: `${nodeUri}/~feedback` },
    )
    const items = (page.items ?? []).slice(0, 3)
    if (items.length > 0) {
      err.feedback = items.map(({ id, title, score }) => ({ id, title, score }))
      err.hint = [
        `hint: known pitfalls from other agents — details: tb feedback get ${cleanPath} <id>`,
        ...items.map(f => `  - ${f.id} (${f.score >= 0 ? '+' : ''}${f.score}) "${f.title}"`),
      ].join('\n')
    } else {
      err.hint = `hint: no known pitfalls recorded for this path yet — if you figure this out, help the next agent:\n  tb feedback submit ${cleanPath} --title "<short summary>" --detail "<how to avoid>"`
    }
  } catch {
    // hint 拉取失败不影响主错误报告
  }
}

/**
 * `tb call <path> ['<json>'] [--tool <name>] [--args '<json>' | --args-file <f>]` —— 数据面调用。
 * 两种形态:
 * - `--tool` 给出 → 信封 `POST /<path>` + `{tool,arguments}`(适用一切 kind:
 *   builtin/context/device 的 cmd 不在直连路由上,信封是通用入口;旧用法不变)。
 * - `--tool` 省略 → path 即直连工具路径,`POST /<path>`、body 为 arguments 本体
 *   (`~help` 对 mcp/http/tool 工具宣告的形态:`tb call docs/context7/resolve-library-id`)。
 * arguments 三种给法互斥:第二 positional(裸 JSON)/ `--args` / `--args-file`。
 * 默认人类模式:markdown 原样打印;`--json`:输出原始 JSON。TBError → stderr + exit 1。
 */
export interface CallArgs {
  args?: string
  argsFile?: string
  baseUrl?: string
  json?: boolean
  sk?: string
  timeout?: string
  tool?: string
}

export function callCommand(): Command {
  return withGlobalOpts(new Command('call'))
    .description(
      'Invoke a tool: `tb call <node>/<tool> \'<json>\'` or `tb call <node> --tool <name>`',
    )
    .argument(
      '<path>',
      'Direct tool path (e.g. docs/context7/resolve-library-id), or node path when --tool is given',
    )
    .argument('[args]', 'Arguments as an inline JSON object (same as --args)')
    .option('--tool <name>', 'Tool/cmd name (envelope form; works for every node kind)')
    .option('--args <json>', 'Arguments as inline JSON object')
    .option('--args-file <file>', 'Arguments from a JSON file')
    .addHelpText(
      'after',
      `
Examples:
  tb call docs/context7/resolve-library-id '{"libraryName":"react"}'
  tb call docs/context7/resolve-library-id --args '{"libraryName":"react"}'
  tb call system/status --tool get
  tb help <path>   shows each tool's arguments schema before you call it`,
    )
    .action(async (pathArg: string, argsPositional: string | undefined, opts: CallArgs) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const path = String(pathArg ?? '').trim()
        if (!path) throw new CliError('node path is required')
        const tool = opts.tool === undefined ? undefined : String(opts.tool).trim()
        if (tool === '') throw new CliError('--tool must be non-empty when given')

        const callArgs = parseCallArgs(opts.args, opts.argsFile, argsPositional)
        const target = resolveTarget(opts)
        const nodeUri = `/${path.replace(/^\/+|\/+$/g, '')}`

        try {
          if (asJson) {
            const result
              = tool !== undefined
                ? await callTool<unknown>(target, nodeUri, tool, callArgs)
                : await callDirect<unknown>(target, nodeUri, callArgs)
            printJson(result)
          } else {
            const text
              = tool !== undefined
                ? await callToolText(target, nodeUri, tool, callArgs)
                : await callDirectText(target, nodeUri, callArgs)
            // 人类模式的结果是网关的 markdown 表现:TTY → ANSI 渲染,管道 → 原样。
            printMarkdown(text)
          }
        } catch (err) {
          await attachFeedbackHint(err, target, nodeUri)
          throw err
        }
      })
    })
}
