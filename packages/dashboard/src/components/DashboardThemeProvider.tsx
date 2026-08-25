import type { ReactNode } from 'react'
import { ThemeProvider } from 'next-themes'

/** Dashboard 唯一主题存储与 DOM class 写入边界。 */
export function DashboardThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      scriptProps={{ 'data-cfasync': 'false' }}
      storageKey="tb.theme"
    >
      {children}
    </ThemeProvider>
  )
}
