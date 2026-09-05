import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { MountCompletionSummary } from '@/components/add-tool/MountCompletion'
import { useMountRunner } from '@/components/add-tool/useMountRunner'

const oauth = vi.hoisted(() => vi.fn())
const invoke = vi.hoisted(() => vi.fn(async () => ({ json: {} })))
vi.mock('@/lib/queries', () => ({
  useInvoke: () => ({ mutateAsync: invoke }),
  useSecretList: () => ({ data: { items: [] }, hasNextPage: false }),
  useInvalidate: () => async () => {},
  useOAuthAuthorize: () => ({ mutateAsync: oauth }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('添加后的授权状态', () => {
  it.each([
    ['authorized', { status: 'authorized' }, '工具已添加'],
    ['pending', { status: 'pending', authorizationUrl: 'https://auth.example.test/consent' }, '已添加，等待授权'],
    ['pending', { status: 'pending' }, '已添加，等待授权'],
    ['failed', new Error('OAuth unavailable'), '已添加，授权未完成'],
  ] as const)('%s 不把 registry 成功冒充全部就绪', async (authorization, response, title) => {
    if (response instanceof Error) oauth.mockRejectedValueOnce(response)
    else oauth.mockResolvedValueOnce(response)
    const { result } = renderHook(() => useMountRunner())
    await act(async () => {
      await result.current.run({
        mount: { path: 'tools/oauth', kind: 'tool', description: 'OAuth tool', config: { provider: 'test' } },
        needsAuthorize: true,
      })
    })
    expect(result.current.state.succeeded).toBe(true)
    expect(result.current.state.authorization).toBe(authorization)
    expect(invoke.mock.calls).toHaveLength(1)
    render(
      <MemoryRouter>
        <MountCompletionSummary result={{
          path: 'tools/oauth',
          authorization: result.current.state.authorization,
          authorizationUrl: result.current.state.authorizationUrl,
        }}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText(title)).toBeTruthy()
    if (authorization === 'pending' && !(response instanceof Error) && 'authorizationUrl' in response) {
      expect(screen.getByRole('link', { name: '打开授权页完成授权' }).getAttribute('href')).toBe(response.authorizationUrl)
    }
  })
})
