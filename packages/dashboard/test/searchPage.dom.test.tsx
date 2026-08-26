import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

const mocks = vi.hoisted(() => ({
  useToolSearch: vi.fn(),
}))

vi.mock('@/lib/queries', () => ({
  useToolSearch: mocks.useToolSearch,
}))

import { SearchPage } from '../src/pages/SearchPage'

describe('SearchPage relevance', () => {
  afterEach(cleanup)

  beforeEach(() => {
    mocks.useToolSearch.mockReturnValue({
      data: {
        pages: [{
          items: [{
            path: 'home/home-assistant',
            relevance: {
              coverage: 0.75,
              matchedTermCount: 3,
              rankingVersion: 'keyword-v2',
              totalTermCount: 4,
            },
            source: { path: 'regional/eu' },
            tool: {
              description: 'Read current entity state',
              effect: 'read',
              name: 'get_live_context',
            },
          }],
          partial: true,
          sources: [
            { path: '', status: 'ok' },
            { error: 'upstream stack trace must stay hidden', path: 'regional/eu', status: 'timed_out' },
          ],
        }],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isError: false,
      isFetching: false,
      isFetchingNextPage: false,
      isPending: false,
      refetch: vi.fn(),
    })
  })

  it('renders matched/total coverage for a compact result with no schema', () => {
    render(
      <MemoryRouter initialEntries={['/search?q=current']}>
        <SearchPage />
      </MemoryRouter>,
    )

    expect(mocks.useToolSearch).toHaveBeenCalledWith('current', {})
    expect(screen.getByLabelText('关键词覆盖 3/4').textContent).toContain('覆盖 3/4')
    expect(screen.getByText('get_live_context')).toBeTruthy()
    expect(screen.getByLabelText('来源 regional/eu').textContent).toContain('regional/eu')
    expect(screen.getByRole('status').textContent).toContain('部分联邦来源未完成')
    expect(screen.getByRole('status').textContent).toContain('regional/eu（超时）')
    expect(screen.queryByText(/upstream stack trace/)).toBeNull()

    fireEvent.change(screen.getByLabelText('搜索范围'), { target: { value: 'local' } })
    expect(mocks.useToolSearch).toHaveBeenLastCalledWith('current', { federation: 'local' })

    fireEvent.change(screen.getByLabelText('搜索范围'), { target: { value: 'recursive' } })
    expect(mocks.useToolSearch).toHaveBeenLastCalledWith('current', { federation: 'recursive' })
  })

  it('shows a controlled partial summary even when no source returned a tool', () => {
    mocks.useToolSearch.mockReturnValue({
      data: {
        pages: [{
          items: [],
          partial: true,
          sources: [{
            error: 'private upstream URL',
            path: 'regional/us',
            status: 'unavailable',
          }],
        }],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isError: false,
      isFetching: false,
      isFetchingNextPage: false,
      isPending: false,
      refetch: vi.fn(),
    })

    render(
      <MemoryRouter initialEntries={['/search?q=current']}>
        <SearchPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('status').textContent).toContain('regional/us（暂不可用）')
    expect(screen.getByText('没有可见的匹配工具')).toBeTruthy()
    expect(screen.queryByText(/private upstream URL/)).toBeNull()
  })
})
