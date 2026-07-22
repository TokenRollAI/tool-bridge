import type { Command, CommanderError } from 'commander'
import { buildProgram } from './program'

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

/** 生产 CLI 入口：把 Commander 解析错误也纳入统一的 JSON/人类输出契约。 */
export async function runMain(argv: string[]): Promise<void> {
  const program = buildProgram()
  overrideExits(program)
  try {
    await program.parseAsync(argv)
  } catch (error) {
    const err = error as CommanderError
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
      process.exitCode = 0
      return
    }
    const message = String(err.message ?? error).replace(/^error:\s*/, '')
    if (parsedJsonMode(program)) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: message, code: err.code })}\n`)
    } else {
      process.stderr.write(`error: ${message}\n`)
    }
    process.exitCode = typeof err.exitCode === 'number' && err.exitCode !== 0 ? err.exitCode : 1
  }
}
