import { Navigate, Route, Routes } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { useSession } from '@/lib/session'
import { LoginPage } from '@/pages/LoginPage'
import { NodePage } from '@/pages/NodePage'
import { OverviewPage } from '@/pages/OverviewPage'
import { DevicesPage } from '@/pages/system/DevicesPage'
import { RegistryPage } from '@/pages/system/RegistryPage'
import { SecretsPage } from '@/pages/system/SecretsPage'
import { SkPage } from '@/pages/system/SkPage'

export default function App() {
  const { conn } = useSession()
  if (!conn) return <LoginPage />
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="nodes/*" element={<NodePage />} />
        <Route path="manage/sk" element={<SkPage />} />
        <Route path="manage/secrets" element={<SecretsPage />} />
        <Route path="manage/registry" element={<RegistryPage />} />
        <Route path="manage/devices" element={<DevicesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
