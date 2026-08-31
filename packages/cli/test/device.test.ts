import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileDeviceOperationJournal } from '../src/deviceMailboxJournal'
import { buildExpose, readCommandProfiles } from '../src/commands/connect'
import { normalizeDeviceId, resolveDeviceId } from '../src/deviceId'
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

  it('structured command profile 投影为显式 effect 的 device tool 节点', () => {
    if (tmpConfig === undefined) throw new Error('missing temp config')
    const file = join(tmpConfig, 'ops.json')
    writeFileSync(file, JSON.stringify({
      version: 1,
      path: 'ops/system',
      description: 'safe system inspection',
      commands: [{
        name: 'system-info',
        description: 'read system information',
        executable: '/usr/bin/uname',
        argv: ['-a'],
        effect: 'read',
        delivery: 'both',
      }],
    }))
    const profiles = readCommandProfiles([file])
    expect(buildExpose({ shell: false }, profiles)).toEqual({
      nodes: [{
        path: 'ops/system',
        kind: 'tool',
        description: 'safe system inspection',
        cmds: [expect.objectContaining({
          name: 'system-info',
          delivery: 'both',
          effect: 'read',
          inputSchema: expect.objectContaining({ additionalProperties: false }),
        })],
      }],
    })
  })

  it('profile 与 shell/fs/另一 profile 的路径冲突 fail closed', () => {
    if (tmpConfig === undefined) throw new Error('missing temp config')
    const writeProfile = (name: string, path: string) => {
      const file = join(tmpConfig!, name)
      writeFileSync(file, JSON.stringify({
        version: 1,
        path,
        description: path,
        commands: [{
          name: 'get',
          description: 'get',
          executable: '/usr/bin/true',
          effect: 'read',
        }],
      }))
      return file
    }
    expect(() => readCommandProfiles([writeProfile('shell.json', 'shell/status')]))
      .toThrow('conflicts with reserved \'shell\'')
    expect(() => readCommandProfiles([
      writeProfile('parent.json', 'ops'),
      writeProfile('child.json', 'ops/system'),
    ])).toThrow('conflicts with \'ops\'')
  })

  it('Mailbox journal 跨实例持久化 executing barrier，并使用私有权限', async () => {
    if (tmpConfig === undefined) throw new Error('missing temp config')
    const operationId = 'dop_AAAAAAAAAAAAAAAAAAAAAAAA'
    const entry = {
      operationId,
      state: 'executing' as const,
      expiresAt: '2099-01-01T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    }
    await createFileDeviceOperationJournal({
      baseUrl: 'https://gateway.example',
      deviceId: 'device-1',
    }).put(entry)

    const restarted = createFileDeviceOperationJournal({
      baseUrl: 'https://gateway.example',
      deviceId: 'device-1',
    })
    expect(await restarted.get(operationId)).toEqual(entry)

    const root = join(tmpConfig, 'tool-bridge', 'device-mailbox')
    const installation = join(root, readdirSync(root)[0]!)
    const file = join(installation, readdirSync(installation)[0]!)
    expect(statSync(installation).mode & 0o777).toBe(0o700)
    expect(statSync(file).mode & 0o777).toBe(0o600)

    await restarted.remove(operationId)
    expect(await restarted.get(operationId)).toBeNull()
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

const operation = {
  operationId: 'dop_AAAAAAAAAAAAAAAAAAAAAAAA',
  commandId: 'dop_AAAAAAAAAAAAAAAAAAAAAAAA',
  deviceId: 'phone-1',
  mountPath: 'device/phone-1',
  targetPath: 'device/phone-1/tools/mail/send',
  caller: { keyId: 'caller-key', owner: 'agent:alice' },
  traceId: 'trace-1',
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
  expiresAt: '2026-08-29T00:00:00.000Z',
  state: 'queued',
  attempt: 0,
  executionMayHaveOccurred: false,
}

describe('tb device durable operations', () => {
  it('call delivery reuses argument parsing and sends mailbox controls once', async () => {
    const fn = captureFetch(operation, 202)
    await runCli([
      'call',
      'device/phone-1/tools/mail/send',
      '--arg',
      'text=hello',
      '--delivery',
      'mailbox',
      '--ttl',
      '300',
      '--idempotency-key',
      'retry-1',
      '--json',
      '--base-url',
      'https://gw',
      '--sk',
      'tbk_x',
    ])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://gw/device/phone-1/tools/mail/send?ttlSeconds=300',
    )
    expect(JSON.parse(String(init.body))).toEqual({ '~delivery': 'mailbox', 'text': 'hello' })
    expect(new Headers(init.headers).get('x-tb-idempotency-key')).toBe('retry-1')
    expect(stdoutText()).toContain(operation.operationId)
  })

  it('op ls sends pagination/state filters and explains claimed-expired ambiguity', async () => {
    const expired = {
      ...operation,
      state: 'expired',
      attempt: 1,
      executionMayHaveOccurred: true,
      terminalAt: operation.updatedAt,
    }
    const fn = captureFetch({ items: [expired], cursor: 'next' })
    await runCli([
      'device',
      'op',
      'ls',
      'phone-1',
      '--state',
      'expired',
      '--limit',
      '10',
      '--base-url',
      'https://gw',
      '--sk',
      'tbk_x',
    ])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/~device/operations/list')
    expect(JSON.parse(String(init.body))).toEqual({
      deviceId: 'phone-1',
      opts: { limit: 10, states: ['expired'] },
    })
    expect(stdoutText()).toContain('may-have-run')
    expect(stdoutText()).toContain('next cursor: next')
  })

  it('op get/cancel use fixed management routes', async () => {
    const get = captureFetch(operation)
    await runCli([
      'device', 'op', 'get', 'phone-1', operation.operationId,
      '--json', '--base-url', 'https://gw', '--sk', 'tbk_x',
    ])
    expect(get.mock.calls[0]?.[0]).toBe('https://gw/~device/operations/get')
    expect(JSON.parse(String((get.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      deviceId: 'phone-1',
      operationId: operation.operationId,
    })

    const cancel = captureFetch({
      ...operation,
      state: 'cancelled',
      cancelRequestedAt: operation.updatedAt,
      terminalAt: operation.updatedAt,
    })
    await runCli([
      'device', 'op', 'cancel', 'phone-1', operation.operationId,
      '--json', '--base-url', 'https://gw', '--sk', 'tbk_x',
    ])
    expect(cancel.mock.calls[0]?.[0]).toBe('https://gw/~device/operations/cancel')
  })

  it('rejects invalid state/ttl before sending', async () => {
    const fn = captureFetch({ items: [] })
    await runCli([
      'device', 'op', 'ls', 'phone-1', '--state', 'unknown',
      '--base-url', 'https://gw', '--sk', 'tbk_x',
    ])
    expect(process.exitCode).toBe(1)
    expect(fn).not.toHaveBeenCalled()
    process.exitCode = 0
    await runCli([
      'device', 'enqueue', 'device/phone-1/tools/mail/send', '--ttl', '0',
      '--base-url', 'https://gw', '--sk', 'tbk_x',
    ])
    expect(process.exitCode).toBe(1)
    expect(fn).not.toHaveBeenCalled()
  })
})
