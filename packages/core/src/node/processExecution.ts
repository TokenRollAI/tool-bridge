/** Node 子进程的有界输出与机器可读终态；shell/argv executor 共用。 */

import type { DeviceAbortSignal } from '../device/client'
import { TBError } from '../errors'

export interface SpawnedProcess {
  kill(signal?: 'SIGKILL'): void
  on(event: 'close', cb: (code: number | null, signal: string | null) => void): void
  on(event: 'exit', cb: (code: number | null, signal: string | null) => void): void
  on(event: 'error', cb: (err: Error) => void): void
  stderr: { on(event: 'data', cb: (chunk: Uint8Array | string) => void): void } | null
  stdout: { on(event: 'data', cb: (chunk: Uint8Array | string) => void): void } | null
}

export interface ProcessExecutionResult {
  completedAt: string
  exitCode: number
  outcome: 'exited' | 'signaled' | 'timed_out'
  signal?: string
  startedAt: string
  stderr: string
  stderrTruncated: boolean
  stdout: string
  stdoutTruncated: boolean
}

export interface ProcessExecutionOptions {
  maxOutputBytes: number
  /** 调用方取消时杀掉子进程；结果通常会被上层 device cancel 丢弃。 */
  signal?: DeviceAbortSignal
  timeoutExitCode: number
  timeoutMs: number
}

class BoundedBuffer {
  private readonly chunks: Buffer[] = []
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

/**
 * 从 spawn 开始到 stdio 排空的统一收敛器。timeout 时等 exit，避免 shell 孙进程
 * 持有管道导致 close 永不及时到达；正常路径等 close 保证输出完整。
 */
export function executeProcess(
  spawn: () => SpawnedProcess,
  opts: ProcessExecutionOptions,
): Promise<ProcessExecutionResult> {
  const startedAt = new Date().toISOString()
  return new Promise<ProcessExecutionResult>((resolvePromise, rejectPromise) => {
    let child: SpawnedProcess
    try {
      child = spawn()
    } catch (error) {
      rejectPromise(new TBError(
        'internal',
        `spawn 失败:${error instanceof Error ? error.message : String(error)}`,
      ))
      return
    }
    const stdout = new BoundedBuffer(opts.maxOutputBytes)
    const stderr = new BoundedBuffer(opts.maxOutputBytes)
    child.stdout?.on('data', chunk => stdout.push(chunk))
    child.stderr?.on('data', chunk => stderr.push(chunk))
    let settled = false
    let timedOut = false
    let forcedSignal: string | null = null
    const kill = () => {
      forcedSignal = 'SIGKILL'
      child.kill('SIGKILL')
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, opts.timeoutMs)
    const onAbort = () => kill()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    if (opts.signal?.aborted === true) onAbort()

    const settle = (code: number | null, processSignal: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      const signal = processSignal ?? forcedSignal
      const suffix = timedOut
        ? `\n[timeout: killed after ${opts.timeoutMs}ms (SIGKILL)]`
        : ''
      resolvePromise({
        startedAt,
        completedAt: new Date().toISOString(),
        stdout: stdout.text(),
        stderr: stderr.text() + suffix,
        exitCode: timedOut ? opts.timeoutExitCode : (code ?? -1),
        outcome: timedOut ? 'timed_out' : signal === null ? 'exited' : 'signaled',
        ...(signal !== null ? { signal } : {}),
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
      })
    }

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      rejectPromise(new TBError('internal', `spawn 失败:${error.message}`))
    })
    child.on('close', (code, signal) => settle(code, signal))
    child.on('exit', (code, signal) => {
      if (timedOut || opts.signal?.aborted === true) settle(code, signal)
    })
  })
}
