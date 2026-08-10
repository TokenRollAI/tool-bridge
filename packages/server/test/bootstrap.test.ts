/**
 * Node/Docker 首次引导 fail closed(Phase 1 DoD 项 3)。
 * 缺 TB_BOOTSTRAP_ADMIN_SK 且未开 TB_ALLOW_INSECURE_BOOTSTRAP → start() 抛错、不监听、
 * 不打印 Admin SK 明文;逃生阀开启 → 保留随机生成并打印一次的旧行为;显式预置 → 干净启动。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { KEY_BOOTSTRAPPED } from '@tool-bridge/core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configFromEnv, createTbServer } from '../src'

const ENCRYPTION_KEY = '3ZwpbBkSrp3eT9ylcZedfN33yq9fJLlmeusH98qNbt8'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
  vi.restoreAllMocks()
})

function tmpDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-bootstrap-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

describe('Node 引导 fail closed', () => {
  it('缺 Admin SK 且未开逃生阀 → start() 拒绝,不监听,不打印明文', async () => {
    const config = configFromEnv({
      TB_PORT: '0',
      TB_HOST: '127.0.0.1',
      TB_DATA_DIR: tmpDataDir(),
      TB_SECRET_ENCRYPTION_KEY: ENCRYPTION_KEY,
      // 不设 TB_BOOTSTRAP_ADMIN_SK,不设 TB_ALLOW_INSECURE_BOOTSTRAP
    })
    expect(config.adminSk).toBeUndefined()
    expect(config.allowInsecureBootstrap).toBe(false)

    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')))
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')))

    const server = createTbServer(config)
    cleanups.push(() => server.close())
    await expect(server.start()).rejects.toThrow(/TB_BOOTSTRAP_ADMIN_SK/)

    // 关键安全属性:没有任何 Admin SK 明文被打印。
    expect(logs.join('\n')).not.toContain('Admin SK (shown once)')
    // "不监听"的可验证代理:引导幂等标志未落库 → 实例停在引导阶段,没有进入 serve()。
    await expect(server.state.get(KEY_BOOTSTRAPPED)).resolves.toBeNull()
  })

  it('逃生阀开启(TB_ALLOW_INSECURE_BOOTSTRAP=true)→ 随机生成并打印一次,可启动', async () => {
    const config = configFromEnv({
      TB_PORT: '0',
      TB_HOST: '127.0.0.1',
      TB_DATA_DIR: tmpDataDir(),
      TB_SECRET_ENCRYPTION_KEY: ENCRYPTION_KEY,
      TB_ALLOW_INSECURE_BOOTSTRAP: 'true',
    })
    expect(config.allowInsecureBootstrap).toBe(true)

    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')))
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')))

    const server = createTbServer(config)
    cleanups.push(() => server.close())
    const { port } = await server.start()
    expect(port).toBeGreaterThan(0)
    expect(logs.join('\n')).toContain('Admin SK (shown once)')
  })

  it('显式预置 TB_BOOTSTRAP_ADMIN_SK → 干净启动,不打印明文', async () => {
    const config = configFromEnv({
      TB_PORT: '0',
      TB_HOST: '127.0.0.1',
      TB_DATA_DIR: tmpDataDir(),
      TB_SECRET_ENCRYPTION_KEY: ENCRYPTION_KEY,
      TB_BOOTSTRAP_ADMIN_SK: 'tbk_provided_admin_0000000000',
    })
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')))

    const server = createTbServer(config)
    cleanups.push(() => server.close())
    const { port } = await server.start()
    expect(port).toBeGreaterThan(0)
    expect(logs.join('\n')).not.toContain('Admin SK (shown once)')
  })
})

// canonical origin 配置面对等(Phase 1 DoD 项 4):Node 与 Workers 同一解析真源,
// 配置了但非法 → configFromEnv 抛错(进程拒绝启动),不静默回退到请求期 origin。
describe('Node canonical origin 对等', () => {
  const base = {
    TB_PORT: '0',
    TB_HOST: '127.0.0.1',
    TB_DATA_DIR: '/tmp/tb-canonical-unused',
    TB_SECRET_ENCRYPTION_KEY: ENCRYPTION_KEY,
    TB_BOOTSTRAP_ADMIN_SK: 'tbk_canonical_admin_000000000',
  }

  it('未配置 → canonicalOrigin undefined(单域名部署行为不变)', () => {
    expect(configFromEnv(base).canonicalOrigin).toBeUndefined()
  })

  it('合法值 → 取 origin(与 Workers 同语义,丢弃 path)', () => {
    const c = configFromEnv({ ...base, TB_CANONICAL_ORIGIN: 'https://tb.example.com/ui' })
    expect(c.canonicalOrigin).toBe('https://tb.example.com')
  })

  it('配置了但非法 → 抛错,进程拒绝启动(不静默回退)', () => {
    expect(() => configFromEnv({ ...base, TB_CANONICAL_ORIGIN: 'not-a-url' })).toThrow(
      /TB_CANONICAL_ORIGIN/,
    )
  })
})
