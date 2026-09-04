import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { parseRuntimeConfig } from '@tool-bridge/sdk/client'
import { MemoryRouter } from 'react-router'
import { SessionContext, type SessionState } from '@/lib/session-context'
import { StorageBackendsPage } from '@/pages/system/StorageBackendsPage'
import { MaintenancePage } from '@/pages/system/MaintenancePage'
import { ConfigPage } from '@/pages/system/ConfigPage'
import { KeysPage } from '@/pages/system/KeysPage'
import { SetupPage } from '@/pages/SetupPage'

await import('@/components/SchemaFormRenderer')

let calls: Array<{ body: Record<string, unknown>, headers: Headers, path: string }> = []
const login = vi.fn()
const profile = { id: 'p1', name: 'test', baseUrl: '', sk: 'tbk_admin' }
const session: SessionState = { active: profile, conn: profile, profiles: [profile], revision: 0, login, logout: vi.fn(), switchTo: vi.fn(), removeProfile: vi.fn() }
function renderPage(page: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><SessionContext.Provider value={session}><MemoryRouter>{page}</MemoryRouter></SessionContext.Provider></QueryClientProvider>)
}
function mockServer(route: (path: string, body: Record<string, unknown>) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const path = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    calls.push({ path, body, headers: new Headers(init?.headers) })
    return new Response(JSON.stringify(route(path, body)), { headers: { 'content-type': 'application/json' } })
  }))
}
beforeEach(() => {
  calls = []
  login.mockReset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('self-hosted setup and management', () => {
  it('pairs and installs with bundled services without exposing infrastructure secrets', async () => {
    mockServer((path) => {
      if (path.endsWith('/status')) return { state: 'setup', instanceId: 'instance-1', pairingRequired: true }
      if (path.endsWith('/defaults')) return { databaseConfigured: true, storageConfigured: true, redisConfigured: false, databaseHost: 'postgres', storage: { endpoint: 'http://s3:8333', bucket: 'objects', region: 'us-east-1' } }
      return { state: 'ready', adminSk: 'tbk_new_admin', baseUrl: '' }
    })
    renderPage(<SetupPage />)
    fireEvent.change(await screen.findByLabelText('一次性配对凭证'), { target: { value: 'pair-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '配对并读取服务' }))
    fireEvent.click(await screen.findByRole('button', { name: '验证连接并完成安装' }))
    await screen.findByText('安装完成')
    const configured = calls.find(call => call.path.endsWith('/configure'))!
    expect(configured.body).not.toHaveProperty('databaseUrl')
    expect(configured.body).not.toHaveProperty('storage')
    expect(configured.headers.get('x-tb-setup-token')).toBe('pair-secret')
    expect(configured.headers.has('authorization')).toBe(false)
    expect(screen.queryByDisplayValue('pair-secret')).toBeNull()
    expect(screen.getByLabelText('管理员 Secret Key').getAttribute('type')).toBe('password')
    expect((screen.getByRole('button', { name: '进入管理界面' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('我已将管理员密钥保存到密码管理器'))
    fireEvent.click(screen.getByRole('button', { name: '进入管理界面' }))
    expect(login).toHaveBeenCalledWith({ name: 'default', baseUrl: '', sk: 'tbk_new_admin' })
  })

  it('recovery state never offers anonymous installation', async () => {
    mockServer(() => ({ state: 'recovery', instanceId: 'instance-1', pairingRequired: true }))
    renderPage(<SetupPage />)
    await screen.findByText('实例需要恢复')
    expect(screen.getByLabelText('一次性配对凭证').getAttribute('type')).toBe('password')
    expect(screen.queryByRole('button', { name: '验证连接并完成安装' })).toBeNull()
  })

  it('backend activation sends the global revision and leaves old-object routing explicit', async () => {
    mockServer(path => path.endsWith('/list') ? { items: [{ id: 'backend-b', name: 'Archive', active: false, activeRevision: 8, revision: 2, validated: true, endpoint: 'https://s3.test', bucket: 'archive', region: 'us-east-1', credentialGeneration: 1, credentialConfigured: true }] } : { ok: true })
    renderPage(<StorageBackendsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '用于新上传' }))
    await waitFor(() => expect(calls.some(call => call.path.endsWith('/activate'))).toBe(true))
    expect(calls.find(call => call.path.endsWith('/activate'))?.body).toEqual({ id: 'backend-b', expectedRevision: 2, expectedActiveRevision: 8 })
    await screen.findByText('默认后端已切换。旧对象继续从原后端读取。')
  })

  it('config form uses schema fields and sends a validated revision update', async () => {
    const settings = parseRuntimeConfig({ maxHops: 4 })
    mockServer((path) => {
      if (path.endsWith('/schema')) return { type: 'object', properties: { maxHops: { type: 'integer', description: '联邦最大跳数', minimum: 1, maximum: 16 } } }
      return { appliedRevision: 6, revision: 6, desired: settings, effective: settings, state: 'applied' }
    })
    renderPage(<ConfigPage />)
    fireEvent.change(await screen.findByLabelText('联邦最大跳数'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(calls.some(call => call.path.endsWith('/update'))).toBe(true))
    const update = calls.find(call => call.path.endsWith('/update'))!
    expect(update.body.expectedRevision).toBe(6)
    expect(update.body.settings).toMatchObject({ maxHops: 7 })
    expect(calls.some(call => call.path.endsWith('/validate'))).toBe(true)
    expect(calls.some(call => call.path.endsWith('/apply'))).toBe(false)
  })
  it('paired recovery invokes the recovery endpoint and preserves the existing administrator', async () => {
    mockServer((path) => {
      if (path.endsWith('/status')) return { state: 'recovery', instanceId: 'instance-1', pairingRequired: true }
      if (path.endsWith('/defaults')) return { databaseConfigured: true, storageConfigured: true, redisConfigured: false }
      return { state: 'ready', baseUrl: '' }
    })
    renderPage(<SetupPage />)
    fireEvent.change(await screen.findByLabelText('一次性配对凭证'), { target: { value: 'recovery-token' } })
    fireEvent.click(screen.getByRole('button', { name: '配对并读取服务' }))
    fireEvent.click(await screen.findByRole('button', { name: '验证连接并恢复实例' }))
    await screen.findByText('恢复完成')
    expect(calls.some(call => call.path.endsWith('/recover'))).toBe(true)
    expect(calls.some(call => call.path.endsWith('/configure'))).toBe(false)
    expect(screen.queryByLabelText('管理员 Secret Key')).toBeNull()
  })

  it('Redis configuration is sent only in the mutation, then cleared from the form', async () => {
    mockServer(path => path.endsWith('/~setup/status') ? { state: 'ready', instanceId: 'instance-1', pairingRequired: false } : { revision: 2, redisConfigured: false, database: { host: 'db', port: 5432, name: 'app', user: 'app' } })
    renderPage(<MaintenancePage />)
    await screen.findByText(/配置版本\s*2/)
    fireEvent.change(screen.getByLabelText('Redis 连接地址'), { target: { value: 'redis://user:secret@redis.test' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并保存 Redis 配置' }))
    await waitFor(() => expect(calls.some(call => call.path.endsWith('/system/maintenance/redis'))).toBe(true))
    expect(calls.find(call => call.path.endsWith('/system/maintenance/redis'))?.body).toEqual({ expectedRevision: 2, redisUrl: 'redis://user:secret@redis.test' })
    await waitFor(() => expect((screen.getByLabelText('Redis 连接地址') as HTMLInputElement).value).toBe(''))
    expect(document.body.textContent).not.toContain('redis://user:secret')
  })

  it('key backup downloads a file without rendering secret material', async () => {
    const createObjectURL = vi.fn(() => 'blob:backup')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    mockServer(path => path.endsWith('/backup') ? { instanceId: 'instance-1', oauthKey: 'never-render-this-root' } : { revision: 1, instanceId: 'instance-1', encryption: { activeKeyId: 'k1', keys: [] }, signing: { activeKeyId: 's1', keys: [] }, jobs: [] })
    renderPage(<KeysPage />)
    await screen.findByText('加密根')
    fireEvent.click(screen.getByRole('button', { name: '下载密钥备份' }))
    await waitFor(() => expect(clicked).toHaveBeenCalledTimes(1))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:backup')
    expect(document.body.textContent).not.toContain('never-render-this-root')
    clicked.mockRestore()
  })
})
