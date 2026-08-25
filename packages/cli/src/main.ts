import { type Command, CommanderError } from 'commander'
import { buildProgram } from './program'
import { reportError } from './output'
import { CliError } from './http'

function overrideExits(cmd: Command): void {
  cmd.exitOverride()
  cmd.configureOutput({ writeErr: () => {} })
  for (const child of cmd.commands) overrideExits(child)
}

/**
 * 只认 Commander 实际解析为 CLI option 的 `--json`。
 *
 * 不能扫描裸 argv：`--json` 可能位于 `--` 之后，属于 positional value，
 * 此时即使其它参数触发解析错误，也不应切换成 JSON 错误输出。
 */
function parsedJsonMode(cmd: Command): boolean {
  if (cmd.getOptionValueSource('json') === 'cli' && cmd.getOptionValue('json') === true) {
    return true
  }
  return cmd.commands.some(parsedJsonMode)
}

export interface RunMainOptions {
  /** 测试只改变 argv 形状，仍必须经过生产 catch/reportError。 */
  from?: 'node' | 'user'
}

export type RunMainResult
  = | { ok: true }
    | { code?: string, kind: 'action' | 'commander', ok: false }

/** 生产 CLI 唯一错误边界：action 必须自然 reject 到这里。 */
export async function runMain(
  argv: string[],
  options: RunMainOptions = {},
): Promise<RunMainResult> {
  const program = buildProgram()
  overrideExits(program)
  try {
    await program.parseAsync(argv, { from: options.from ?? 'node' })
    return { ok: true }
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
        process.exitCode = 0
        return { ok: true }
      }
      const message = error.message.replace(/^error:\s*/, '')
      reportError(
        parsedJsonMode(program),
        new CliError(message, error.code),
        error.exitCode,
      )
      return { ok: false, kind: 'commander', code: error.code }
    }
    reportError(parsedJsonMode(program), error)
    return {
      ok: false,
      kind: 'action',
      ...(error instanceof CliError && error.code !== undefined ? { code: error.code } : {}),
    }
  }
}
