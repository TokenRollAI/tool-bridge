import { CliError } from './http'

/**
 * 输出与错误落地:`--json` → 可解析 JSON 到 stdout;人类模式 → 简洁行/表格。
 * 错误一律经 reportError:stderr 友好消息 + 退出码 1(TBError code 在 --json 下保留)。
 */

export function printLine(s = ''): void {
  process.stdout.write(`${s}\n`)
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

/** TBError / 网络错误 → 退出码 1。--json 时输出 `{ok:false,error,code,retryable,…}`。 */
export function reportError(asJson: boolean, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  const cli = err instanceof CliError ? err : undefined
  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        error: message,
        code: cli?.code,
        retryable: cli?.retryable,
        hint: cli?.hint,
        feedback: cli?.feedback,
      })}\n`,
    )
  } else {
    const retry = cli?.retryable === true ? ' (retryable — try again)' : ''
    process.stderr.write(`error: ${message}${retry}\n`)
    if (cli?.hint) process.stderr.write(`${cli.hint}\n`)
  }
  process.exitCode = 1
}

/** 命令主体包裹:捕获任何抛出并统一落地为退出码 1。 */
export async function guard(asJson: boolean, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    reportError(asJson, err)
  }
}

/** citty 的重复 flag 可能是 string | string[] | undefined,统一成 string[]。 */
export function asArray(v: unknown): string[] {
  if (v === undefined || v === null || v === '') return []
  return Array.isArray(v) ? v.map(String) : [String(v)]
}

/** SK 明文打码:显示前缀(含 `tbk_`)+ 省略号,其余不回显。 */
export function maskSecret(sk: string): string {
  if (sk.length <= 8) return `${sk.slice(0, 2)}…`
  return `${sk.slice(0, 8)}…`
}

/** 极简对齐表格(人类可读输出)。 */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)))
  const fmt = (cells: string[]): string =>
    cells
      .map((c, i) => (c ?? '').padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd()
  return [fmt(headers), ...rows.map(fmt)].join('\n')
}
