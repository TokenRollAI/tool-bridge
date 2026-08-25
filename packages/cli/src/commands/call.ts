import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import {
  callDirect,
  callDirectText,
  CliError,
  type Target,
  withClient,
} from '../http'
import { collect, resolveTarget, withGlobalOpts } from '../args'
import { printMarkdown } from '../markdown'
import { printJson } from '../output'

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
    const feedbackTarget = { ...target, timeoutMs: Math.min(target.timeoutMs ?? 5000, 5000) }
    const page = await withClient(
      feedbackTarget,
      async client => await client.feedback.list(cleanPath),
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
 * `tb call <path> ['<json>'] [--args '<json>' | --args-file <f> | --arg k=v …]`
 * —— 数据面调用。唯一形态:path 即完整命令路径,`POST /<path>`、body 为 arguments 本体
 * (无 `{tool,arguments}` 信封)。适用一切 kind:命令是节点下的虚拟叶子,
 * `tb call system/status/get`、`tb call docs/context7/resolve-library-id`。
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
}

export function callCommand(): Command {
  return withGlobalOpts(new Command('call'))
    .description(
      'Invoke a command: `tb call <node>/<command> \'<json>\'` (body is the arguments object)',
    )
    .argument(
      '<path>',
      'Full command path, e.g. system/status/get or docs/context7/resolve-library-id',
    )
    .argument('[args]', 'Arguments as an inline JSON object (same as --args)')
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
  tb call system/status/get
  tb call docs/context7/resolve-library-id '{"libraryName":"react"}'
  tb call docs/context7/resolve-library-id --args '{"libraryName":"react"}'
  tb call docs/context7/resolve-library-id --arg libraryName=react --arg tokens=5000
  cat args.json | tb call docs/context7/resolve-library-id --args-file -
  tb call contexts/main/get --arg path=readme.md
  tb help <path>   shows each command's arguments schema before you call it

--arg value typing (conservative scalars only):
  true/false -> boolean, null -> null, 42 / -1.5 -> number, anything else -> string.
  A repeated key wins with its last occurrence. For exact types (the string "true",
  the string "42") or nested objects/arrays, use --args / --args-file JSON instead.`,
    )
    .action(async (pathArg: string, argsPositional: string | undefined, opts: CallArgs) => {
      const asJson = Boolean(opts.json)
      const path = String(pathArg ?? '').trim()
      if (!path) throw new CliError('command path is required')

      const callArgs = parseCallArgs(opts.args, opts.argsFile, argsPositional, opts.arg ?? [])
      const target = resolveTarget(opts)
      const nodeUri = `/${path.replace(/^\/+|\/+$/g, '')}`

      try {
        if (asJson) {
          printJson(await callDirect<unknown>(target, nodeUri, callArgs))
        } else {
          // 人类模式的结果是网关的 markdown 表现:TTY → ANSI 渲染,管道 → 原样。
          printMarkdown(await callDirectText(target, nodeUri, callArgs))
        }
      } catch (err) {
        await attachFeedbackHint(err, target, nodeUri)
        throw err
      }
    })
}
