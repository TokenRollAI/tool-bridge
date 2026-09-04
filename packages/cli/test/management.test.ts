import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetFetch, setFetch } from '../src/http'
import { readStdinRaw } from '../src/stdin'
import { runCli } from './cliHarness'

vi.mock('../src/stdin', () => ({ readStdinRaw: vi.fn() }))
let directory = ''
let requests: Array<{ init: RequestInit, path: string }> = []
let output: string[] = []
const target = ['--base-url', 'https://tb.test', '--sk', 'tbk_admin', '--json']

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'tb-management-'))
  requests = []
  output = []
  process.exitCode = 0
  vi.spyOn(process.stdout, 'write').mockImplementation((value) => {
    output.push(String(value))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  setFetch(vi.fn(async (input, init) => {
    requests.push({ path: new URL(String(input)).pathname, init: init ?? {} })
    return new Response(JSON.stringify(String(input).endsWith('/~setup/configure') ? { state: 'ready', adminSk: 'new-admin', baseUrl: '' } : { ok: true }), { headers: { 'content-type': 'application/json' } })
  }))
})
afterEach(() => {
  resetFetch()
  vi.restoreAllMocks()
  rmSync(directory, { recursive: true, force: true })
  process.exitCode = 0
})

describe('instance management command parity', () => {
  it('config update validates settings and preserves the expected revision', async () => {
    vi.mocked(readStdinRaw).mockResolvedValue('{"maxHops":7}')
    await runCli(['config', 'update', '--revision', '12', ...target])
    expect(requests).toHaveLength(1)
    expect(requests[0]?.path).toBe('/system/config/update')
    expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({ expectedRevision: 12, settings: { maxHops: 7 } })
  })

  it('invalid revisions and unknown fields fail before any network request', async () => {
    await runCli(['config', 'apply', '--revision', '-1', ...target])
    vi.mocked(readStdinRaw).mockResolvedValue('{"maxHopz":7}')
    await runCli(['config', 'update', '--revision', '0', ...target])
    expect(requests).toEqual([])
  })

  it('storage add reads credentials from stdin and does not echo them', async () => {
    const secret = 'private-storage-secret'
    vi.mocked(readStdinRaw).mockResolvedValue(JSON.stringify({ name: 'archive', connection: { endpoint: 'https://s3.test', bucket: 'archive', accessKeyId: 'key', secretAccessKey: secret } }))
    await runCli(['storage', 'add', ...target])
    expect(requests[0]?.path).toBe('/system/storage/write')
    expect(JSON.parse(String(requests[0]?.init.body)).connection.secretAccessKey).toBe(secret)
    expect(output.join('')).not.toContain(secret)
  })

  it('activation carries both backend and global active-pointer revisions', async () => {
    await runCli(['storage', 'activate', 'backend-b', '--revision', '3', '--active-revision', '9', ...target])
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({ id: 'backend-b', expectedRevision: 3, expectedActiveRevision: 9 })
    expect(requests[0]?.path).toBe('/system/storage/activate')
  })

  it('setup uses the pairing header without sending the supplied Admin SK', async () => {
    const tokenFile = join(directory, 'pairing-token')
    writeFileSync(tokenFile, 'one-time-token\n')
    vi.mocked(readStdinRaw).mockResolvedValue('{}')
    await runCli(['setup', 'configure', '--token-file', tokenFile, ...target])
    expect(requests[0]?.path).toBe('/~setup/configure')
    const headers = new Headers(requests[0]?.init.headers)
    expect(headers.get('x-tb-setup-token')).toBe('one-time-token')
    expect(headers.has('authorization')).toBe(false)
    expect(JSON.parse(String(requests[0]?.init.body))).not.toHaveProperty('databaseUrl')
    expect(output.join('')).not.toContain('one-time-token')
  })

  it('setup rejects two stdin consumers before reading either input', async () => {
    const stdin = vi.mocked(readStdinRaw).mockClear()
    await runCli(['setup', 'configure', '--token-file', '-', '--file', '-', ...target])
    expect(requests).toEqual([])
    expect(stdin).not.toHaveBeenCalled()
  })
  it('database rotation accepts an ephemeral admin connection only through JSON input', async () => {
    vi.mocked(readStdinRaw).mockResolvedValue(JSON.stringify({ password: 'x'.repeat(32), databaseAdminUrl: 'postgresql://admin:secret@db.test/app' }))
    await runCli(['maintenance', 'rotate-database-credentials', '--revision', '5', '--instance-id', 'instance-a', ...target])
    expect(requests[0]?.path).toBe('/system/maintenance/rotate_database_credentials')
    expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({ expectedRevision: 5, expectedInstanceId: 'instance-a', databaseAdminUrl: 'postgresql://admin:secret@db.test/app' })
    expect(output.join('')).not.toContain('secret')
  })

  it('recovery uses its dedicated endpoint and never accepts backup on ordinary setup', async () => {
    const tokenFile = join(directory, 'token')
    writeFileSync(tokenFile, 'recovery-token')
    setFetch(vi.fn(async (input, init) => {
      requests.push({ path: new URL(String(input)).pathname, init: init ?? {} })
      return new Response(JSON.stringify({ state: 'ready', baseUrl: '' }), { headers: { 'content-type': 'application/json' } })
    }))
    vi.mocked(readStdinRaw).mockResolvedValue('{}')
    await runCli(['setup', 'recover', '--token-file', tokenFile, ...target])
    expect(requests[0]?.path).toBe('/~setup/recover')
    vi.mocked(readStdinRaw).mockResolvedValue('{"backup":{}}')
    await runCli(['setup', 'configure', '--token-file', tokenFile, ...target])
    expect(requests).toHaveLength(1)
  })

  it('key backup only writes a new 0600 file and never prints key material', async () => {
    const destination = join(directory, 'backup.json')
    const backup = { version: 1, instanceId: 'instance-a', oauthKey: 'highly-sensitive-root' }
    const fetcher = vi.fn(async () => new Response(JSON.stringify(backup), { headers: { 'content-type': 'application/json' } }))
    setFetch(fetcher)
    await runCli(['keys', 'backup', '--out', destination, ...target])
    expect(JSON.parse(readFileSync(destination, 'utf8'))).toEqual(backup)
    expect(statSync(destination).mode & 0o777).toBe(0o600)
    expect(output.join('')).not.toContain('highly-sensitive-root')
    await runCli(['keys', 'backup', '--out', destination, ...target])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
