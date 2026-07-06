/**
 * 设备侧 shell executor(Proto §6.3 shell 契约):spawn(shell:true) 执行整条 command,
 * 聚合 { stdout, stderr, exitCode }。执行前必过 isCommandAllowed(白名单),不过 →
 * TBError permission_denied(判定在设备侧执行前完成,Proto §6.2)。
 *
 * 有界缓冲:stdout/stderr 各上限 SHELL_OUTPUT_LIMIT_BYTES,超出截断加标记(v1 教训:
 * 无界读取会 OOM)。超时 kill(SIGKILL),exitCode 记 124(GNU timeout 约定)并在
 * stderr 加标记。spawn 可注入以便单测(截断/超时/失败路径不依赖真实进程)。
 */

import { spawn as nodeSpawn } from 'node:child_process'
import { describeAllow, isCommandAllowed } from '../device/shellAllow'
import { TBError } from '../errors'

/** 单流输出上限(1MiB);超出截断。 */
export const SHELL_OUTPUT_LIMIT_BYTES = 1024 * 1024

/**
 * 设备侧缺省执行超时:略低于网关 60s(DEVICE_CALL_TIMEOUT_MS),让真实超时错误
 * 先于网关的 unavailable 到达调用方。
 */
export const SHELL_EXEC_DEFAULT_TIMEOUT_MS = 55_000

/** 超时被 SIGKILL 时的 exitCode(GNU timeout 约定)。 */
export const SHELL_TIMEOUT_EXIT_CODE = 124

export interface ShellExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface ShellExecOptions {
  cwd?: string
  timeoutMs?: number
}

/** 注入用最小子进程面(node:child_process 的 ChildProcess 结构兼容)。 */
export interface SpawnedProcess {
  stdout: { on(event: 'data', cb: (chunk: Uint8Array | string) => void): void } | null
  stderr: { on(event: 'data', cb: (chunk: Uint8Array | string) => void): void } | null
  on(event: 'close', cb: (code: number | null, signal: string | null) => void): void
  on(event: 'error', cb: (err: Error) => void): void
  kill(signal?: 'SIGKILL'): void
}

export type SpawnFn = (command: string, opts: { shell: true; cwd?: string }) => SpawnedProcess

export interface ShellExecutorOptions {
  /** 白名单(Proto §6.2 语义);缺省 [] = 拒绝一切。 */
  allow?: string[]
  /** 单测注入;缺省 node:child_process.spawn。 */
  spawn?: SpawnFn
  /** 单流输出上限;缺省 SHELL_OUTPUT_LIMIT_BYTES。 */
  maxOutputBytes?: number
  /** 缺省 SHELL_EXEC_DEFAULT_TIMEOUT_MS。 */
  defaultTimeoutMs?: number
}

export type ShellExecutor = (command: string, opts?: ShellExecOptions) => Promise<ShellExecResult>

/** 有界收集器:超上限丢弃后续字节并记截断。 */
class BoundedBuffer {
  private chunks: Buffer[] = []
  private size = 0
  truncated = false

  constructor(private readonly limit: number) {}

  push(chunk: Uint8Array | string): void {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk)
    const remain = this.limit - this.size
    if (remain <= 0) {
      this.truncated = true
      return
    }
    if (buf.byteLength > remain) {
      this.chunks.push(buf.subarray(0, remain))
      this.size = this.limit
      this.truncated = true
      return
    }
    this.chunks.push(buf)
    this.size += buf.byteLength
  }

  text(): string {
    const text = Buffer.concat(this.chunks).toString('utf8')
    return this.truncated ? `${text}\n[output truncated at ${this.limit} bytes]` : text
  }
}

export function createShellExecutor(opts: ShellExecutorOptions = {}): ShellExecutor {
  const spawn: SpawnFn = opts.spawn ?? ((command, spawnOpts) => nodeSpawn(command, spawnOpts))
  const limit = opts.maxOutputBytes ?? SHELL_OUTPUT_LIMIT_BYTES
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? SHELL_EXEC_DEFAULT_TIMEOUT_MS

  return async (command, execOpts = {}) => {
    if (!isCommandAllowed(command, opts.allow)) {
      throw new TBError('permission_denied', `命令不在白名单:${describeAllow(opts.allow)}`)
    }
    const timeoutMs = execOpts.timeoutMs ?? defaultTimeoutMs
    return new Promise<ShellExecResult>((resolvePromise, rejectPromise) => {
      const child = spawn(command, { shell: true, cwd: execOpts.cwd })
      const stdout = new BoundedBuffer(limit)
      const stderr = new BoundedBuffer(limit)
      child.stdout?.on('data', (chunk) => stdout.push(chunk))
      child.stderr?.on('data', (chunk) => stderr.push(chunk))
      let settled = false
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, timeoutMs)
      child.on('error', (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        rejectPromise(new TBError('internal', `spawn 失败:${err.message}`))
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const suffix = timedOut ? `\n[timeout: killed after ${timeoutMs}ms (SIGKILL)]` : ''
        resolvePromise({
          stdout: stdout.text(),
          stderr: stderr.text() + suffix,
          exitCode: timedOut ? SHELL_TIMEOUT_EXIT_CODE : (code ?? -1),
        })
      })
    })
  }
}
