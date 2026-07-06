import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { SessionProvider } from '@/lib/session'
import './index.css'
import App from './App'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) =>
        count < 2 && typeof err === 'object' && err !== null && 'retryable' in err
          ? Boolean((err as { retryable: boolean }).retryable)
          : false,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
  },
})

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        {/* Vite base 与 gateway 静态挂载点都是 /ui,路由 basename 与之对齐 */}
        <BrowserRouter basename="/ui">
          <App />
        </BrowserRouter>
        <Toaster position="bottom-right" richColors />
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
)
