import type { Command } from 'commander'
import { currentProfile, readConfig } from './config'
import { CliError, type Target } from './http'

/**
 * 全局开关(每个子命令共享):
 * - `--json`:输出可解析 JSON。
 * - `--base-url` / `--sk`:覆盖环境变量与配置文件。
 * - `--timeout`:单请求等待上限(秒;默认 120)。
 *
 * commander 的父命令 option 不自动下发到子命令,故以共享 helper 在各子命令附加。
 */
export function withGlobalOpts(cmd: Command): Command {
  return cmd
    .option('--json', 'Output parseable JSON', false)
    .option('--base-url <url>', 'Gateway base URL (default: $TB_BASE_URL or config profile)')
    .option('--sk <sk>', 'Secret Key (default: $TB_SK or config profile)')
    .option('--timeout <seconds>', 'Per-request wait limit in seconds (default: 120)')
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
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new CliError(
        `invalid --timeout "${opts.timeout}": expected a positive number of seconds`,
      )
    }
    timeoutMs = Math.round(seconds * 1000)
  }
  return {
    baseUrl: opts.baseUrl ?? process.env.TB_BASE_URL ?? profile?.baseUrl,
    sk: opts.sk ?? process.env.TB_SK ?? profile?.sk,
    timeoutMs,
  }
}
