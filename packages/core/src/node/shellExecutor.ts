/**
 * 设备侧 shell executor(shell 契约):spawn(shell:true) 执行整条 command,
 * 聚合兼容的 { stdout, stderr, exitCode } 与机器可读终态。执行前必过
 * isCommandAllowed(白名单),不过 →
 * TBError permission_denied(判定在设备侧执行前完成)。
 *
 * 有界缓冲:stdout/stderr 各上限 SHELL_OUTPUT_LIMIT_BYTES,超出截断加标记(v1 教训:
 * 无界读取会 OOM)。超时 kill(SIGKILL),exitCode 记 124(GNU timeout 约定)并在
 * stderr 加标记。spawn 可注入以便单测(截断/超时/失败路径不依赖真实进程)。
 */

import { spawn as nodeSpawn } from 'node:child_process'
import {
  executeProcess,
  type ProcessExecutionResult,
  type SpawnedProcess,
} from './processExecution'
import { describeAllow, isCommandAllowed } from '../device/shellAllow'
import { TBError } from '../errors'

export type { SpawnedProcess } from './processExecution'

/** 单流输出上限(1MiB);超出截断。 */
export const SHELL_OUTPUT_LIMIT_BYTES = 1024 * 1024

/**
 * 设备侧缺省执行超时:略低于网关 60s(DEVICE_CALL_TIMEOUT_MS),让真实超时错误
 * 先于网关的 unavailable 到达调用方。
 */
export const SHELL_EXEC_DEFAULT_TIMEOUT_MS = 55_000

/** 超时被 SIGKILL 时的 exitCode(GNU timeout 约定)。 */
export const SHELL_TIMEOUT_EXIT_CODE = 124

export type ShellExecResult = ProcessExecutionResult

export interface ShellExecOptions {
  cwd?: string
  timeoutMs?: number
}

export type SpawnFn = (command: string, opts: { cwd?: string, shell: true }) => SpawnedProcess

export interface ShellExecutorOptions {
  /** 白名单;缺省 [] = 拒绝一切。 */
  allow?: string[]
  /** 缺省 SHELL_EXEC_DEFAULT_TIMEOUT_MS。 */
  defaultTimeoutMs?: number
  /** 单流输出上限;缺省 SHELL_OUTPUT_LIMIT_BYTES。 */
  maxOutputBytes?: number
  /** 单测注入;缺省 node:child_process.spawn。 */
  spawn?: SpawnFn
}

export type ShellExecutor = (command: string, opts?: ShellExecOptions) => Promise<ShellExecResult>

export function createShellExecutor(opts: ShellExecutorOptions = {}): ShellExecutor {
  const spawn: SpawnFn = opts.spawn ?? ((command, spawnOpts) => nodeSpawn(command, spawnOpts))
  const limit = opts.maxOutputBytes ?? SHELL_OUTPUT_LIMIT_BYTES
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? SHELL_EXEC_DEFAULT_TIMEOUT_MS

  return async (command, execOpts = {}) => {
    if (!isCommandAllowed(command, opts.allow)) {
      throw new TBError(
        'permission_denied',
        `command not in allowlist — ${describeAllow(opts.allow)}`,
      )
    }
    const timeoutMs = execOpts.timeoutMs ?? defaultTimeoutMs
    return executeProcess(
      () => spawn(command, { shell: true, cwd: execOpts.cwd }),
      {
        timeoutMs,
        maxOutputBytes: limit,
        timeoutExitCode: SHELL_TIMEOUT_EXIT_CODE,
      },
    )
  }
}
