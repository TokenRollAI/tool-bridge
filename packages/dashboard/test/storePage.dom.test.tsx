import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreObjectDescriptor } from '@/lib/types'

const OBJECT: StoreObjectDescriptor = {
  uri: 'store://default/obj_01k4photo',
  contentType: 'image/jpeg',
  filename: 'capture.jpg',
  size: 4096,
  owner: 'user:alice',
  producer: 'device:camera-01',
  status: 'ready',
  createdAt: '2026-08-24T11:59:00.000Z',
  updatedAt: '2026-08-24T12:00:00.000Z',
  readyAt: '2026-08-24T12:00:00.000Z',
}
const secretRef = 'https://gw.example/~store/shares/bearer-secret'
const uploadMutate = vi.fn(async () => OBJECT)
const readMutate = vi.fn(async () => ({
  $ref: 'https://gw.example/~store/refs/read-secret',
  contentType: OBJECT.contentType,
  size: OBJECT.size,
  expiresAt: '2099-08-24T12:10:00.000Z',
}))
const shareMutate = vi.fn(async () => ({
  $ref: secretRef,
  shareId: 'share-01',
  uri: OBJECT.uri,
  expiresAt: '2099-08-24T12:10:00.000Z',
}))
const revokeMutate = vi.fn(async () => {})
const deleteMutate = vi.fn(async () => {})
const invalidate = vi.fn(async () => {})
const readReset = vi.fn()

vi.mock('@/lib/queries', () => ({
  useInvalidate: () => invalidate,
  useStoreDelete: () => ({ isPending: false, mutateAsync: deleteMutate }),
  useStoreObjects: () => ({
    data: { pages: [{ items: [OBJECT] }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isError: false,
    isFetchingNextPage: false,
    isPending: false,
    isRefetching: false,
    refetch: vi.fn(async () => ({})),
  }),
  useStoreRead: () => ({ isPending: false, mutateAsync: readMutate, reset: readReset }),
  useStoreRevokeShare: () => ({ isPending: false, mutateAsync: revokeMutate }),
  useStoreShare: () => ({ isPending: false, mutateAsync: shareMutate }),
  useStoreStat: (uri: string | null) => ({
    data: uri ? OBJECT : undefined,
    isError: false,
    isPending: false,
  }),
  useStoreUpload: () => ({ isPending: false, mutateAsync: uploadMutate }),
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const { StorePage } = await import('@/pages/system/StorePage')

beforeEach(() => {
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StorePage', () => {
  it('独立展示 Store 对象、owner/producer，并通过 stat dialog 查看元数据', async () => {
    render(<StorePage />)
    expect(screen.getByRole('heading', { name: 'Default Store' })).toBeTruthy()
    expect(screen.getByText('capture.jpg')).toBeTruthy()
    expect(screen.getByText('user:alice')).toBeTruthy()
    expect(screen.getByText('device:camera-01')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '查看对象详情' }))
    const dialog = await screen.findByRole('dialog', { name: 'Store 对象详情' })
    expect(within(dialog).getByText(OBJECT.uri)).toBeTruthy()
    expect(within(dialog).queryByText(/driverKey|uploadToken|bearer-secret/)).toBeNull()
  })

  it('选择本地文件后用 Store upload mutation，不要求 Context path', async () => {
    const { container } = render(<StorePage />)
    const file = new File([new Uint8Array([1, 2, 3])], 'new-photo.jpg', { type: 'image/jpeg' })
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(uploadMutate).toHaveBeenCalledWith({ file }))
    expect(invalidate).toHaveBeenCalledWith('store-list')
  })

  it('下载 ref 仅进入瞬时 anchor，完成后 reset；分享 bearer 不渲染为文本或 href', async () => {
    const { container } = render(<StorePage />)
    fireEvent.click(screen.getByRole('button', { name: '下载对象' }))
    await waitFor(() => expect(readMutate).toHaveBeenCalledWith(OBJECT.uri))
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled()
    expect(readReset).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '创建分享' }))
    await waitFor(() => expect(shareMutate).toHaveBeenCalledWith({ uri: OBJECT.uri, ttlSec: 3600 }))
    expect(screen.getByText('短期分享已创建')).toBeTruthy()
    expect(screen.getByRole('button', { name: '复制一次性分享链接' })).toBeTruthy()
    expect(container.textContent).not.toContain(secretRef)
    expect(container.querySelector(`[href="${secretRef}"]`)).toBeNull()
  })

  it('支持撤销刚创建的分享和确认删除对象', async () => {
    render(<StorePage />)
    fireEvent.click(screen.getByRole('button', { name: '创建分享' }))
    await screen.findByText('短期分享已创建')
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    await waitFor(() => expect(revokeMutate).toHaveBeenCalledWith('share-01'))

    fireEvent.click(screen.getByRole('button', { name: '删除对象' }))
    const dialog = await screen.findByRole('alertdialog', { name: '删除 Store 对象？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '确认执行' }))
    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith(OBJECT.uri))
    expect(invalidate).toHaveBeenCalledWith('store-list', 'store-stat')
  })
})
