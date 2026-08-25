import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeDeviceId, resolveDeviceId } from '../src/deviceId'
import { buildExpose } from '../src/commands/connect'
import { deviceWsUrl } from '../src/deviceRuntime'
import { resetFetch, setFetch } from '../src/http'
import { configPath } from '../src/config'
import { runCli } from './cliHarness'

function stdoutText(): string {
  const stdout = process.stdout.write as unknown as ReturnType<typeof vi.fn>
  return stdout.mock.calls.map(c => String(c[0])).join('')
}

function captureFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )
  setFetch(fn as unknown as typeof fetch)
  return fn
}

let tmpConfig: string | undefined
const oldXdg = process.env.XDG_CONFIG_HOME

beforeEach(() => {
  process.exitCode = 0
  tmpConfig = mkdtempSync(join(tmpdir(), 'tb-cli-device-'))
  process.env.XDG_CONFIG_HOME = tmpConfig
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
  process.exitCode = 0
  resetFetch()
  vi.restoreAllMocks()
  if (tmpConfig) rmSync(tmpConfig, { recursive: true, force: true })
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = oldXdg
})

describe('deviceId', () => {
  it('规范化 hostname/device id:小写 + 非法字符转 -', () => {
    expect(normalizeDeviceId('Build Box_01!!')).toBe('build-box_01')
  })

  it('首次生成后持久化到 XDG config;显式 --device-id 不改配置', () => {
    const generated = resolveDeviceId()
    expect(generated).toBeTruthy()
    const cfg1 = JSON.parse(readFileSync(configPath(), 'utf8')) as { device?: { id?: string } }
    expect(cfg1.device?.id).toBe(generated)

    expect(resolveDeviceId('Override Box')).toBe('override-box')
    const cfg2 = JSON.parse(readFileSync(configPath(), 'utf8')) as { device?: { id?: string } }
    expect(cfg2.device?.id).toBe(generated)
  })
})

describe('device runtime helpers', () => {
  it('deviceWsUrl:https→wss + /system/device/ws + deviceId query', () => {
    expect(deviceWsUrl('https://tool.example/base', 'd1')).toBe(
      'wss://tool.example/system/device/ws?deviceId=d1',
    )
  })

  it('buildExpose:默认暴露 shell(allow 默认 []);--no-shell + --fs 只暴露 fs', () => {
    expect(buildExpose({})).toEqual({ shell: { allow: [] } })
    expect(buildExpose({ allow: ['echo', 'git'], fs: ['/tmp'], fsReadonly: true })).toEqual({
      shell: { allow: ['echo', 'git'] },
      fs: { roots: ['/tmp'], readOnly: true },
    })
    expect(buildExpose({ shell: false, fs: '/tmp' })).toEqual({
      fs: { roots: ['/tmp'], readOnly: false },
    })
  })
})

describe('tb device ls', () => {
  const lastSeenAt = '2026-01-01T00:00:00.000Z'

  it('调用 system/registry list(prefix=device),只输出 online 字段存在的设备根', async () => {
    const fn = captureFetch({
      items: [
        {
          path: 'device/d1',
          kind: 'directory',
          description: '设备 d1',
          online: true,
          lastSeenAt,
        },
        { path: 'device/d1/shell', kind: 'device', description: 'shell' },
        { path: 'device/d2', kind: 'directory', description: '设备 d2', online: false },
      ],
    })
    await runCli(['device', 'ls', '--base-url', 'https://gw', '--sk', 'tbk_x'])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/system/registry/list')
    expect(JSON.parse(init.body as string)).toEqual({ prefix: 'device' })
    const text = stdoutText()
    expect(text).toContain('d1')
    expect(text).toContain('yes')
    expect(text).toContain('d2')
    expect(text).toContain('no')
    expect(text).not.toContain('shell')
  })

  it('LAST_SEEN 列展示 lastSeenAt,缺省记为 -', async () => {
    captureFetch({
      items: [
        { path: 'device/d1', kind: 'directory', online: true, lastSeenAt },
        { path: 'device/d2', kind: 'directory', online: true },
      ],
    })
    await runCli(['device', 'ls', '--base-url', 'https://gw', '--sk', 'tbk_x'])
    const lines = stdoutText().split('\n')
    expect(lines[0]).toContain('LAST_SEEN')
    // 本地化渲染依赖时区,用同一转换求期望值而非硬编码字面量。
    expect(lines[1]).toContain(new Date(lastSeenAt).toLocaleString())
    expect(lines[2]).toContain('-')
  })
})
