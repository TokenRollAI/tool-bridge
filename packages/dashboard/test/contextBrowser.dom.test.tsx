import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import type { ContextEntry, ContextEntryMeta, HelpCmd } from '@/lib/types'
import { ApiError } from '@/lib/api'

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
const uploadResult = async ({ entryPath }: { entryPath: string }) => ({
  uri: `node://${NODE_PATH}/${entryPath}`,
  etag: 'photo-etag',
})
const uploadMutateAsync = vi.fn(uploadResult)

const CMDS: HelpCmd[] = [
  { method: 'POST', name: 'get', path: `${NODE_PATH}/get`, scope: 'read' },
  { method: 'POST', name: 'write', path: `${NODE_PATH}/write`, scope: 'write' },
  { method: 'POST', name: 'delete', path: `${NODE_PATH}/delete`, scope: 'write' },
  {
    method: 'POST',
    name: 'create_upload',
    path: `${NODE_PATH}/create_upload`,
    scope: 'write',
  },
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
  useCtxUpload: () => ({ isPending: false, mutateAsync: uploadMutateAsync }),
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
  uploadMutateAsync.mockReset()
  uploadMutateAsync.mockImplementation(uploadResult)
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

  it('能力存在时可选文件、调整 entry path 并发起直传', async () => {
    renderBrowser()
    fireEvent.click(screen.getByRole('button', { name: '上传文件' }))

    const dialog = await screen.findByRole('dialog', { name: '直传文件' })
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'shot.jpg', {
      type: 'image/jpeg',
    })
    fireEvent.change(within(dialog).getByLabelText('选择上传文件'), {
      target: { files: [file] },
    })
    const pathInput = within(dialog).getByLabelText('条目路径') as HTMLInputElement
    expect(pathInput.value).toBe('shot.jpg')
    fireEvent.change(pathInput, { target: { value: 'camera/2026/shot.jpg' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '开始直传' }))

    await waitFor(() => expect(uploadMutateAsync).toHaveBeenCalledWith({
      entryPath: 'camera/2026/shot.jpg',
      file,
      overwrite: false,
    }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '直传文件' })).toBeNull())
  })

  it('同名上传先原子失败，再经确认显式覆盖', async () => {
    uploadMutateAsync
      .mockRejectedValueOnce(new ApiError('conflict', 412, '目标条目已存在'))
      .mockImplementationOnce(uploadResult)
    renderBrowser()
    fireEvent.click(screen.getByRole('button', { name: '上传文件' }))
    const uploadDialog = await screen.findByRole('dialog', { name: '直传文件' })
    const file = new File([new Uint8Array([1])], 'shot.jpg', { type: 'image/jpeg' })
    fireEvent.change(within(uploadDialog).getByLabelText('选择上传文件'), {
      target: { files: [file] },
    })
    fireEvent.click(within(uploadDialog).getByRole('button', { name: '开始直传' }))

    const confirm = await screen.findByRole('alertdialog', { name: '覆盖现有条目？' })
    expect(within(confirm).getByText(/shot\.jpg/)).toBeTruthy()
    fireEvent.click(within(confirm).getByRole('button', { name: '覆盖上传' }))

    await waitFor(() => expect(uploadMutateAsync).toHaveBeenNthCalledWith(2, {
      entryPath: 'shot.jpg',
      file,
      overwrite: true,
    }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '直传文件' })).toBeNull())
  })
})
