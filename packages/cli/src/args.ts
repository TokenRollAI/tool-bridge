import type { Command, OptionValues } from 'commander'
import { normalizeExpiresAt } from '@tool-bridge/core'
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
export function withGlobalOpts<
  Args extends unknown[],
  Opts extends OptionValues,
  GlobalOpts extends OptionValues,
>(cmd: Command<Args, Opts, GlobalOpts>) {
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
export function configureGlobalOpts<
  Args extends unknown[],
  Opts extends OptionValues,
  GlobalOpts extends OptionValues,
>(program: Command<Args, Opts, GlobalOpts>) {
  const configured = withGlobalOpts(program)
  configured.hook('preAction', (_thisCommand, actionCommand) => {
    for (const key of GLOBAL_OPTION_KEYS) {
      if (configured.getOptionValueSource(key) !== 'cli') continue
      if (actionCommand.getOptionValueSource(key) === 'cli') continue
      actionCommand.setOptionValueWithSource(key, configured.getOptionValue(key), 'cli')
    }
  })
  return configured
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
export function withPageOpts<
  Args extends unknown[],
  Opts extends OptionValues,
  GlobalOpts extends OptionValues,
>(cmd: Command<Args, Opts, GlobalOpts>) {
  return cmd
    .option('--limit <n>', 'Page size (1-200)')
    .option('--cursor <cursor>', 'Continue from a previous page cursor')
}

/** CLI 侧尽早校验过期时间；服务端仍会重复校验作为安全边界。 */
export function parseIsoTimestamp(value: string, flag = '--expires'): string {
  // 委托 core 的 normalizeExpiresAt(zod 日历感知校验 + UTC 规范化),
  // 保证 CLI 本地语义与服务端 Write/Update 完全一致;这里只补 flag 级错误措辞。
  try {
    return normalizeExpiresAt(value.trim())
  } catch {
    throw new CliError(`invalid ${flag} "${value}": expected an ISO 8601 timestamp with timezone`)
  }
}

/** repeatable string option 的收集器(`--allow a --allow b` → ['a','b'])。 */
export function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}

/**
 * 可重复 "key=value" flag 的统一解析器 —— 收敛此前散在 8 个命令里的 indexOf('=') 手写副本。
 * 只按第一个 `=` 切分(value 可含 `=`);key 一律 trim 且必填。其余语义由调用方显式声明:
 * - trimValue:标识符/URL 类值(--rename/--config/--header)→ true;
 *   凭证与元数据类值的空白可能有意义(--field/--meta/--arg)→ false。
 * - allowEmptyValue:false 时空值与空 key 合并成一条 "empty <k>/<v>" 措辞报错。
 * - onDuplicate:'error' 报错;'last-wins' 后者覆盖(与 shell 里追加覆盖的直觉一致)。
 * - expected/keyLabel/valueLabel:错误措辞沿用各 flag 的既有叫法(from=to、Name=value …)。
 */
export function parseKeyValueSpecs(
  specs: readonly string[],
  options: {
    allowEmptyValue?: boolean
    expected?: string
    flag: string
    keyLabel?: string
    onDuplicate: 'error' | 'last-wins'
    trimValue?: boolean
    valueLabel?: string
  },
): Record<string, string> {
  const {
    allowEmptyValue = false,
    expected = '"key=value"',
    flag,
    keyLabel = 'key',
    onDuplicate,
    trimValue = false,
    valueLabel = 'value',
  } = options
  const out: Record<string, string> = {}
  for (const spec of specs) {
    const idx = spec.indexOf('=')
    if (idx < 0) throw new CliError(`invalid ${flag} "${spec}": expected ${expected}`)
    const key = spec.slice(0, idx).trim()
    const raw = spec.slice(idx + 1)
    const value = trimValue ? raw.trim() : raw
    if (!key || (!allowEmptyValue && !value)) {
      throw new CliError(
        `invalid ${flag} "${spec}": empty ${allowEmptyValue ? keyLabel : `${keyLabel}/${valueLabel}`}`,
      )
    }
    if (onDuplicate === 'error' && Object.hasOwn(out, key)) {
      throw new CliError(`duplicate ${flag} key '${key}'`)
    }
    out[key] = value
  }
  return out
}

/**
 * `--field k=v` → 多字段凭证表。secret set 与 integration add 共用同一个 flag,
 * 此前两份同名实现语义相左(一边重复报错/允许空值,一边静默覆盖/空值报错),
 * 统一为:重复 key 报错、允许空值、值不 trim —— 凭证里的空白可能是有意义的,
 * 而同一 key 给两遍多半是笔误,静默覆盖会吞掉真实凭证。
 */
export function parseFieldSpecs(specs: readonly string[]): Record<string, string> {
  return parseKeyValueSpecs(specs, { allowEmptyValue: true, flag: '--field', onDuplicate: 'error' })
}

/**
 * 可选正整数 flag(--ttl 等)。语义取此前 4 份副本中最严的一档:
 * 正整数且 Number.isSafeInteger(超出安全整数范围的秒数无意义,静默透传更糟)。
 */
export function parsePositiveInt(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new CliError(`${flag} must be a positive integer`)
  }
  return n
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
