import type { Command } from 'commander'
import { currentProfile, readConfig } from './config'
import { CliError, type Target } from './http'

const GLOBAL_OPTION_KEYS = ['json', 'baseUrl', 'sk', 'timeout'] as const

/**
 * 全局开关(每个子命令共享):
 * - `--json`:输出可解析 JSON。
 * - `--base-url` / `--sk`:覆盖环境变量与配置文件。
 * - `--timeout`:单请求等待上限(秒;默认 120)。
 *
 * 叶子命令也保留这些 option,让局部 help 自包含并保持历史调用兼容。
 */
export function withGlobalOpts(cmd: Command): Command {
  return cmd
    .option('--json', 'Output parseable JSON', false)
    .option('--base-url <url>', 'Gateway base URL (default: $TB_BASE_URL or config profile)')
    .option('--sk <sk>', 'Secret Key (default: $TB_SK or config profile)')
    .option(
      '--timeout <seconds>',
      'Per-request HTTP wait limit in seconds (default: 120; not for long-running commands)',
    )
}

/**
 * 把共享参数注册到根命令,并在 action 前合并到实际叶子命令。
 *
 * Commander 会把这些 option 解析到声明它们的命令,但 action 收到的是叶子 opts。
 * 这里把根命令上的显式值补到尚未显式设置同名参数的叶子命令,因此以下写法等价:
 * `tb --json sk list` / `tb sk --json list` / `tb sk list --json`。
 */
export function configureGlobalOpts(program: Command): Command {
  withGlobalOpts(program)
  program.hook('preAction', (_thisCommand, actionCommand) => {
    for (const key of GLOBAL_OPTION_KEYS) {
      if (program.getOptionValueSource(key) !== 'cli') continue
      if (actionCommand.getOptionValueSource(key) === 'cli') continue
      actionCommand.setOptionValueWithSource(key, program.getOptionValue(key), 'cli')
    }
  })
  return program
}

/** 分页参数的统一解析与网关上限校验。 */
export function parsePageOpts(opts: { cursor?: string, limit?: string }): {
  cursor?: string
  limit?: number
} {
  let limit: number | undefined
  if (opts.limit !== undefined) {
    limit = Number(opts.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new CliError(`invalid --limit "${opts.limit}": expected an integer between 1 and 200`)
    }
  }
  const cursor = opts.cursor === undefined ? undefined : String(opts.cursor).trim()
  if (opts.cursor !== undefined && !cursor) throw new CliError('--cursor must not be empty')
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(cursor === undefined ? {} : { cursor }),
  }
}

/** 为返回 Page 的命令附加统一的 limit/cursor 参数。 */
export function withPageOpts(cmd: Command): Command {
  return cmd
    .option('--limit <n>', 'Page size (1-200)')
    .option('--cursor <cursor>', 'Continue from a previous page cursor')
}

/** CLI 侧尽早校验过期时间；服务端仍会重复校验作为安全边界。 */
export function parseIsoTimestamp(value: string, flag = '--expires'): string {
  const input = value.trim()
  const match
    = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      input,
    )
  if (!match) {
    throw new CliError(`invalid ${flag} "${value}": expected an ISO 8601 timestamp with timezone`)
  }
  const [, year, month, day, hour, minute, second] = match
  const parts = [year, month, day, hour, minute, second].map(Number)
  const [y, mo, d, h, mi, s] = parts
  const calendar = new Date(Date.UTC(y!, mo! - 1, d!, h!, mi!, s!))
  if (
    mo! < 1
    || mo! > 12
    || d! < 1
    || h! > 23
    || mi! > 59
    || s! > 59
    || calendar.getUTCFullYear() !== y
    || calendar.getUTCMonth() !== mo! - 1
    || calendar.getUTCDate() !== d
  ) {
    throw new CliError(`invalid ${flag} "${value}": expected a real calendar date and time`)
  }
  const timestamp = Date.parse(input)
  if (!Number.isFinite(timestamp)) throw new CliError(`invalid ${flag} "${value}"`)
  return new Date(timestamp).toISOString()
}

/** repeatable string option 的收集器(`--allow a --allow b` → ['a','b'])。 */
export function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}

/**
 * 解析 base URL / SK,优先级(高→低):
 * 1. 显式 flag `--base-url`/`--sk`
 * 2. 环境变量 `TB_BASE_URL`/`TB_SK`
 3. `tb login`/`use` 落盘的当前 profile
 *
 * env 高于配置文件是刻意约定(便于 CI/临时覆盖)。
 */
export function resolveTarget(opts: { baseUrl?: string, sk?: string, timeout?: string }): Target {
  const profile = currentProfile(readConfig())
  let timeoutMs: number | undefined
  if (opts.timeout !== undefined) {
    const seconds = Number(opts.timeout)
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86_400) {
      throw new CliError(
        `invalid --timeout "${opts.timeout}": expected seconds in the range (0, 86400]`,
      )
    }
    timeoutMs = Math.max(1, Math.round(seconds * 1000))
  }
  return {
    baseUrl: opts.baseUrl ?? process.env.TB_BASE_URL ?? profile?.baseUrl,
    sk: opts.sk ?? process.env.TB_SK ?? profile?.sk,
    timeoutMs,
  }
}
