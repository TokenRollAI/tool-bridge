import { useCallback, useSyncExternalStore } from 'react'

/** 主题存取(默认 dark;html.dark 由 index.html 预置,避免闪白)。 */
const THEME_KEY = 'tb.theme'

let listeners: Array<() => void> = []

function currentTheme(): 'dark' | 'light' {
  return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
}

function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem(THEME_KEY, theme)
  for (const l of listeners) l()
}

// 首次加载即按持久化偏好校正(index.html 预置 dark)。
if (typeof document !== 'undefined' && currentTheme() === 'light') {
  document.documentElement.classList.remove('dark')
}

export function useTheme(): ['dark' | 'light', () => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.push(cb)
      return () => {
        listeners = listeners.filter((l) => l !== cb)
      }
    },
    currentTheme,
    () => 'dark' as const,
  )
  const toggle = useCallback(() => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'), [])
  return [theme, toggle]
}
