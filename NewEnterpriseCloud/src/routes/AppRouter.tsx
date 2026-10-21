import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from '../components/layout/AppLayout'
import LoadingScreen from '../components/LoadingScreen'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import LandingPage from '../paginas/LandingPage'
import LoginPage from '../paginas/LoginPage'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'

const DashboardPage = lazy(() => import('../paginas/DashboardPage'))
const CajaPage = lazy(() => import('../paginas/CajaPage'))
const MaintenancePage = lazy(() => import('../paginas/MaintenancePage'))
const PermisosPage = lazy(() => import('../paginas/PermisosPage'))
const ModuloPage = lazy(() => import('../paginas/ModuloPage'))
const ReportsPage = lazy(() => import('../paginas/ReportsPage'))
const ProfilePage = lazy(() => import('../paginas/ProfilePage'))

// Solo deja pasar a quien tenga una sesión de Supabase activa.
// Tras iniciar sesión se muestra "Preparando tu panel" un tiempo mínimo
// mientras llegan el perfil y los registros.
const MIN_SPLASH_MS = 1500

function RequireAuth() {
  const { session, profile, loading, error, refreshProfile, signOut } = useAuth()
  const { loading: recordsLoading } = useRecords()
  const { theme } = useTheme()
  const [splashReady, setSplashReady] = useState(false)
  const splashTimer = useRef<number | undefined>(undefined)
  const userId = session?.user.id

  useEffect(() => {
    window.clearTimeout(splashTimer.current)
    if (!userId) {
      setSplashReady(false)
      return
    }
    splashTimer.current = window.setTimeout(() => setSplashReady(true), MIN_SPLASH_MS)
    return () => window.clearTimeout(splashTimer.current)
  }, [userId])

  if (loading) return <LoadingScreen />
  if (!session) return <Navigate to="/login" replace />
  if (!profile || error) return <div className="erp-shell workspace-shell" data-theme={theme}><section className="ws-empty-compact" style={{ minHeight: '100dvh' }}><AlertTriangle size={32} /><h1>No se pudo cargar tu espacio de trabajo</h1><p>{error || 'No se encontró tu perfil de usuario.'}</p><div className="ws-heading-actions"><button className="ws-button" onClick={() => void refreshProfile()}><RefreshCw size={16} />Reintentar</button><button className="ws-button ws-button-secondary" onClick={() => void signOut().catch(() => refreshProfile())}>Volver al acceso</button></div></section></div>
  if (recordsLoading || !splashReady) return <LoadingScreen />
  return <AppLayout />
}

export default function AppRouter() {
  return (
    <Suspense fallback={<LoadingScreen />}><Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/registro" element={<LoginPage mode="register" />} />
      <Route element={<RequireAuth />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/ingreso-kardex" element={<ModuloPage page="purchases" view="receipts" />} />
        <Route path="/movimiento-kardex" element={<ModuloPage page="inventory" view="kardex" />} />
        <Route path="/facturacion" element={<Navigate to="/sales" replace />} />
        <Route path="/estado-cuenta" element={<Navigate to="/finance" replace />} />
        <Route path="/mantenimientos" element={<MaintenancePage />} />
        <Route path="/permisos" element={<PermisosPage />} />
        <Route path="/caja" element={<CajaPage />} />
        <Route path="/settings" element={<Navigate to="/mantenimientos" replace />} />
        <Route path="/documents" element={<Navigate to="/dashboard" replace />} />
        <Route path="/perfil" element={<ProfilePage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/orden-compra" element={<Navigate to="/purchases" replace />} />
        <Route path="/orden-venta" element={<Navigate to="/sales" replace />} />
        <Route path="/cotizacion" element={<Navigate to="/quotes" replace />} />
        <Route path="/stock-productos" element={<Navigate to="/inventory" replace />} />
        <Route path="/reportes" element={<Navigate to="/reports" replace />} />
        <Route path="/:pageId" element={<ModuloPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes></Suspense>
  )
}
