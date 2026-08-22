import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import type { ContextEntry, ContextEntryMeta, HelpCmd } from '@/lib/types'

const NODE_PATH = 'tools/team docs'
const ENTRY_PATH = 'handbook/usage.md'

const ENTRY_META: ContextEntryMeta = {
  contentType: 'text/markdown',
  metadata: { owner: 'platform' },
  size: 45,
  updatedAt: '2026-08-23T08:00:00.000Z',
  uri: `node://${NODE_PATH}/${ENTRY_PATH}`,
  version: 'version-1234567890',
}

const ENTRY: ContextEntry = {
  ...ENTRY_META,
  content: '# 使用说明\n\n第一行\n第二行',
}
let currentEntry = ENTRY

const CMDS: HelpCmd[] = [
  { method: 'POST', name: 'get', path: `${NODE_PATH}/get`, scope: 'read' },
  { method: 'POST', name: 'write', path: `${NODE_PATH}/write`, scope: 'write' },
  { method: 'POST', name: 'delete', path: `${NODE_PATH}/delete`, scope: 'write' },
]

vi.mock('@/lib/queries', () => ({
  useCtxEntries: () => ({
    data: { pages: [{ items: [ENTRY_META] }] },
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isError: false,
    isFetching: false,
    isFetchingNextPage: false,
    isPending: false,
    refetch: vi.fn(),
  }),
  useCtxEntry: (_nodePath: string, entryPath: string | null) => ({
    data: entryPath === null ? undefined : currentEntry,
    error: null,
    isError: false,
    isFetching: false,
    isPending: false,
    isSuccess: entryPath !== null,
    refetch: vi.fn(),
  }),
  useInvalidate: () => vi.fn(),
  useInvoke: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const { ContextBrowser } = await import('@/components/node/ContextBrowser')

function renderBrowser() {
  return render(
    <MemoryRouter>
      <ContextBrowser cmds={CMDS} path={NODE_PATH} />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  currentEntry = ENTRY
})

describe('ContextBrowser 条目详情', () => {
  it('所有屏幕点击条目都打开宽且内部可滚动的 Dialog，并提供所属工具链接', async () => {
    renderBrowser()

    fireEvent.click(screen.getByRole('button', { name: `预览条目 ${ENTRY_PATH}` }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog.className).toContain('sm:max-w-5xl')
    expect(dialog.querySelector('.overflow-y-auto')).not.toBeNull()
    expect(within(dialog).getByRole('heading', { name: ENTRY_PATH })).toBeTruthy()
    expect(within(dialog).getByText(/第一行/).textContent).toContain('第二行')

    const toolLink = within(dialog).getByRole('link', {
      name: `查看所属工具 ${NODE_PATH} 的详情（新窗口打开）`,
    })
    expect(toolLink.getAttribute('href')).toBe('/nodes/tools/team%20docs')
    expect(toolLink.getAttribute('target')).toBe('_blank')
    expect(toolLink.getAttribute('rel')).toContain('noreferrer')

    expect(within(dialog).getByRole('button', { name: '复制内容' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '编辑' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '删除条目' })).toBeTruthy()
  })

  it('Escape 关闭详情后恢复列表状态', async () => {
    renderBrowser()
    const entryButton = screen.getByRole('button', { name: `预览条目 ${ENTRY_PATH}` })

    fireEvent.click(entryButton)
    await screen.findByRole('dialog')
    expect(entryButton.getAttribute('aria-pressed')).toBe('true')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(entryButton.getAttribute('aria-pressed')).toBe('false')
  })

  it('大对象继续显示可新窗口打开的 $ref，不提供无效的正文复制', async () => {
    currentEntry = {
      ...ENTRY,
      content: { $ref: 'https://objects.example.test/usage?token=temporary' },
      contentType: 'application/octet-stream',
    }
    renderBrowser()

    fireEvent.click(screen.getByRole('button', { name: `预览条目 ${ENTRY_PATH}` }))
    const dialog = await screen.findByRole('dialog')
    const refLink = within(dialog).getByRole('link', { name: '打开 $ref' })

    expect(refLink.getAttribute('href')).toBe(
      'https://objects.example.test/usage?token=temporary',
    )
    expect(refLink.getAttribute('target')).toBe('_blank')
    expect(within(dialog).queryByRole('button', { name: '复制内容' })).toBeNull()
  })
})
