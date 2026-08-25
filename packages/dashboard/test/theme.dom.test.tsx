import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTheme } from 'next-themes'
import { DashboardThemeProvider } from '@/components/DashboardThemeProvider'

vi.mock('sonner', () => ({
  Toaster: ({ theme }: { theme?: string }) => <output data-testid="sonner-theme">{theme}</output>,
}))

const { Toaster } = await import('@/components/ui/sonner')

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => [...data.keys()][index] ?? null,
    removeItem: key => void data.delete(key),
    setItem: (key, value) => data.set(key, String(value)),
  }
}

function ThemeProbe() {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'
  return (
    <button onClick={() => setTheme(isDark ? 'light' : 'dark')} type="button">
      {isDark ? 'dark' : 'light'}
    </button>
  )
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addListener: () => {},
      removeListener: () => {},
    }),
  })
  localStorage.clear()
  document.documentElement.className = 'dark'
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('DashboardThemeProvider', () => {
  it('默认 dark，用 tb.theme 持久化，并同步 Sonner 主题', async () => {
    render(
      <DashboardThemeProvider>
        <ThemeProbe />
        <Toaster />
      </DashboardThemeProvider>,
    )

    expect(screen.getByRole('button', { name: 'dark' })).toBeTruthy()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(screen.getByTestId('sonner-theme').textContent).toBe('dark')

    fireEvent.click(screen.getByRole('button', { name: 'dark' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'light' })).toBeTruthy())
    expect(localStorage.getItem('tb.theme')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(screen.getByTestId('sonner-theme').textContent).toBe('light')
  })

  it('首屏注入无闪烁脚本，并恢复已持久化的 light', async () => {
    localStorage.setItem('tb.theme', 'light')
    const { container } = render(
      <DashboardThemeProvider>
        <ThemeProbe />
      </DashboardThemeProvider>,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'light' })).toBeTruthy())
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    const bootstrap = container.querySelector('script')
    expect(bootstrap?.textContent).toContain('tb.theme')
    expect(bootstrap?.getAttribute('data-cfasync')).toBe('false')
  })
})
