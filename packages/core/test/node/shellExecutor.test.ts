import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { isTBError } from '../../src/errors'
import {
  createShellExecutor,
  SHELL_EXEC_DEFAULT_TIMEOUT_MS,
  SHELL_OUTPUT_LIMIT_BYTES,
  SHELL_TIMEOUT_EXIT_CODE,
  type SpawnedProcess,
  type SpawnFn,
} from '../../src/node/shellExecutor'

let cwd: string

beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'tb-shell-'))
})

afterAll(async () => {
  await rm(cwd, { recursive: true, force: true })
})

describe('真实 spawn(shell:true)', () => {
  it('echo → stdout 聚合,exitCode 0', async () => {
    const exec = createShellExecutor({ allow: ['echo'] })
    expect(await exec('echo hi')).toEqual({ stdout: 'hi\n', stderr: '', exitCode: 0 })
  })

  it('stderr 与非零 exitCode 保真(allow *)', async () => {
    const exec = createShellExecutor({ allow: ['*'] })
    const result = await exec('echo err 1>&2; exit 3')
    expect(result.stderr).toBe('err\n')
    expect(result.exitCode).toBe(3)
  })

  it('cwd 生效', async () => {
    const exec = createShellExecutor({ allow: ['pwd'] })
    const { stdout } = await exec('pwd', { cwd })
    expect(stdout.trim().endsWith(cwd.split('/').pop() as string)).toBe(true)
  })

  it('超时:SIGKILL + exitCode 124 + stderr 标记', async () => {
    const exec = createShellExecutor({ allow: ['sleep'] })
    const result = await exec('sleep 5', { timeoutMs: 100 })
    expect(result.exitCode).toBe(SHELL_TIMEOUT_EXIT_CODE)
    expect(result.stderr).toContain('[timeout: killed after 100ms (SIGKILL)]')
  })
})

describe('白名单前置判定(执行前完成)', () => {
  it('不在白名单 → permission_denied,且不 spawn', async () => {
    const spawn = vi.fn()
    const exec = createShellExecutor({ allow: ['echo'], spawn: spawn as unknown as SpawnFn })
    try {
      await exec('rm -rf /')
      expect.unreachable('应当抛 permission_denied')
    } catch (e) {
      expect(isTBError(e) && e.code).toBe('permission_denied')
      expect(isTBError(e) && e.message).toContain('allowed commands: echo')
    }
    expect(spawn).not.toHaveBeenCalled()
  })

  it('缺省 allow = [] → 一切拒(与默认拒对齐)', async () => {
    const exec = createShellExecutor({})
    await expect(exec('echo hi')).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('元字符注入拒(白名单非 *)', async () => {
    const exec = createShellExecutor({ allow: ['echo'] })
    await expect(exec('echo hi; rm -rf /')).rejects.toMatchObject({ code: 'permission_denied' })
  })
})

/** 可控假子进程:测截断与 spawn 失败路径。 */
function fakeProcess() {
  const listeners = new Map<string, Array<(...args: never[]) => void>>()
  const on = (event: string, cb: (...args: never[]) => void) => {
    const list = listeners.get(event) ?? []
    list.push(cb)
    listeners.set(event, list)
  }
  const emit = (event: string, ...args: unknown[]) => {
    for (const cb of listeners.get(event) ?? []) (cb as (...a: unknown[]) => void)(...args)
  }
  const child: SpawnedProcess = {
    stdout: { on: (event, cb) => on(`stdout:${event}`, cb as never) },
    stderr: { on: (event, cb) => on(`stderr:${event}`, cb as never) },
    on: (event: string, cb: (...args: never[]) => void) => on(event, cb),
    kill: () => emit('close', null, 'SIGKILL'),
  }
  return { child, emit }
}

describe('有界缓冲与失败路径(注入 spawn)', () => {
  it('stdout 超上限截断并加标记(默认 1MiB,此处缩小到 8B)', async () => {
    const { child, emit } = fakeProcess()
    const exec = createShellExecutor({ allow: ['*'], spawn: () => child, maxOutputBytes: 8 })
    const pending = exec('big')
    emit('stdout:data', 'abcdef')
    emit('stdout:data', 'ghijkl') // 累计 12B > 8B:后半截断
    emit('close', 0, null)
    const result = await pending
    expect(result.stdout).toBe('abcdefgh\n[output truncated at 8 bytes]')
    expect(result.exitCode).toBe(0)
    expect(SHELL_OUTPUT_LIMIT_BYTES).toBe(1024 * 1024)
  })

  it('spawn error 事件 → TBError internal', async () => {
    const { child, emit } = fakeProcess()
    const exec = createShellExecutor({ allow: ['*'], spawn: () => child })
    const pending = exec('boom')
    emit('error', new Error('ENOENT: no such cwd'))
    await expect(pending).rejects.toMatchObject({ code: 'internal' })
  })

  it('缺省超时常量:略低于网关 60s', () => {
    expect(SHELL_EXEC_DEFAULT_TIMEOUT_MS).toBeLessThan(60_000)
  })
})
