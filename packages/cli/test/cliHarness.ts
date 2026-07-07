import type { Command } from 'commander'
import { buildProgram } from '../src/program'

/**
 * 解析级测试入口:经真实 buildProgram() 走 commander 完整解析。
 * - exitOverride 须逐层应用(commander 不向 addCommand 的子命令继承),
 *   使解析错误(未知 flag / 缺 required / 多余 positional)以异常抛出而非 process.exit。
 * - 静默 commander 自身的 stdout/stderr(错误消息在抛出的 CommanderError.message 里)。
 */
function overrideExits(cmd: Command): void {
  cmd.exitOverride()
  cmd.configureOutput({ writeOut: () => {}, writeErr: () => {} })
  for (const sub of cmd.commands) overrideExits(sub)
}

/** 跑一条 tb 命令行(argv 不含 node/脚本名),解析错误抛 CommanderError。 */
export async function runCli(argv: string[]): Promise<void> {
  const program = buildProgram()
  overrideExits(program)
  await program.parseAsync(argv, { from: 'user' })
}

/** 断言用:跑一条命令行并捕获解析错误,返回 CommanderError.code(无错误 → null)。 */
export async function parseError(argv: string[]): Promise<string | null> {
  try {
    await runCli(argv)
    return null
  } catch (err) {
    return (err as { code?: string }).code ?? 'unknown'
  }
}
