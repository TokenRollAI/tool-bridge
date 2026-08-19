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
import { collect, resolveTarget, withGlobalOpts } from '../args'
import { guard, printJson } from '../output'
import { printMarkdown } from '../markdown'

/** 从 stdin 读整块内容(`--args-file -`;与 ctx put 的 stdin 读法一致)。 */
function readStdin(): string {
  try {
    return readFileSync(0, 'utf8')
  } catch (err) {
    throw new CliError(`cannot read stdin: ${(err as Error).message}`)
  }
}

/**
 * `--arg k=v` 的值类型规则(**保守的标量解析**,只认四类字面量):
 * - `true` / `false` → boolean
 * - `null` → null
 * - 纯整数/小数(`-?\d+(\.\d+)?`)→ number
 * - 其余一律保持 string
 *
 * 刻意不尝试解析嵌套 JSON、数组或指数/十六进制记数法:那是 `--args` 整块 JSON 的活。
 * 需要精确类型(字符串 `"true"`、字符串 `"42"`、大整数)或嵌套结构时改用 `--args`。
 */
function parseArgScalar(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  return raw
}

/**
 * 可重复 `--arg k=v` → 扁平 arguments 对象。
 * 第一个 `=` 之后全算 value(value 可含 `=`);value 不 trim(空白可能有意义);
 * key 为空 → CliError;重复 key 后者覆盖前者(与 shell 里追加覆盖的直觉一致)。
 */
export function parseArgEntries(entries: readonly string[]): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  for (const entry of entries) {
    const at = entry.indexOf('=')
    if (at < 0) throw new CliError(`invalid --arg "${entry}": expected "key=value"`)
    const key = entry.slice(0, at).trim()
    if (!key) throw new CliError(`invalid --arg "${entry}": empty key`)
    args[key] = parseArgScalar(entry.slice(at + 1))
  }
  return args
}

/**
 * 解析 positional JSON / `--args` / `--args-file` / 可重复 `--arg k=v` 为 arguments 对象。
 * 四源互斥(缺省 `{}`);`--args-file -` 从 stdin 读整块 JSON。
 */
export function parseCallArgs(
  argsStr?: string,
  argsFile?: string,
  positional?: string,
  argEntries: readonly string[] = [],
): Record<string, unknown> {
  const given = [
    positional !== undefined ? 'positional JSON' : null,
    argsStr !== undefined ? '--args' : null,
    argsFile !== undefined ? '--args-file' : null,
    argEntries.length > 0 ? '--arg' : null,
  ].filter((s): s is string => s !== null)
  if (given.length > 1) {
    throw new CliError(`${given.join(' and ')} are mutually exclusive`)
  }
  if (argEntries.length > 0) return parseArgEntries(argEntries)
  let raw: string | undefined
  if (argsFile === '-') {
    if (process.stdin.isTTY) {
      throw new CliError('pipe the arguments JSON via stdin when using --args-file -')
    }
    raw = readStdin()
  } else if (argsFile !== undefined) {
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
 * `tb call <path> ['<json>'] [--tool <name>] [--args '<json>' | --args-file <f> | --arg k=v …]`
 * —— 数据面调用。两种形态:
 * - `--tool` 给出 → 信封 `POST /<path>` + `{tool,arguments}`(适用一切 kind:
 *   builtin/context/device 的 cmd 不在直连路由上,信封是通用入口;旧用法不变)。
 * - `--tool` 省略 → path 即直连工具路径,`POST /<path>`、body 为 arguments 本体
 *   (`~help` 对 mcp/http/tool 工具宣告的形态:`tb call docs/context7/resolve-library-id`)。
 * arguments 四种给法互斥:第二 positional(裸 JSON)/ `--args` / `--args-file`(`-` = stdin)/
 * 可重复 `--arg k=v`(扁平标量,见 parseArgScalar)。
 * 默认人类模式:markdown 原样打印;`--json`:输出原始 JSON。TBError → stderr + exit 1。
 */
export interface CallArgs {
  arg?: string[]
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
    .option('--args-file <file>', 'Arguments from a JSON file, or `-` for stdin')
    .option(
      '--arg <key=value>',
      'One flat argument (repeatable; mutually exclusive with [args]/--args/--args-file)',
      collect,
      [],
    )
    .addHelpText(
      'after',
      `
Examples:
  tb call docs/context7/resolve-library-id '{"libraryName":"react"}'
  tb call docs/context7/resolve-library-id --args '{"libraryName":"react"}'
  tb call docs/context7/resolve-library-id --arg libraryName=react --arg tokens=5000
  cat args.json | tb call docs/context7/resolve-library-id --args-file -
  tb call system/status --tool get
  tb help <path>   shows each tool's arguments schema before you call it

--arg value typing (conservative scalars only):
  true/false -> boolean, null -> null, 42 / -1.5 -> number, anything else -> string.
  A repeated key wins with its last occurrence. For exact types (the string "true",
  the string "42") or nested objects/arrays, use --args / --args-file JSON instead.`,
    )
    .action(async (pathArg: string, argsPositional: string | undefined, opts: CallArgs) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const path = String(pathArg ?? '').trim()
        if (!path) throw new CliError('node path is required')
        const tool = opts.tool === undefined ? undefined : String(opts.tool).trim()
        if (tool === '') throw new CliError('--tool must be non-empty when given')

        const callArgs = parseCallArgs(opts.args, opts.argsFile, argsPositional, opts.arg ?? [])
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
