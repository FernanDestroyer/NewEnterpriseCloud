import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from '../components/layout/AppLayout'
import LoadingScreen from '../components/LoadingScreen'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import LandingPage from '../components/LandingPage'
import LoginPage from '../components/LoginPage'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'

const DashboardPage = lazy(() => import('../components/DashboardPage'))
const CajaPage = lazy(() => import('../components/CajaPage'))
const MaintenancePage = lazy(() => import('../components/MaintenancePage'))
const PermisosPage = lazy(() => import('../components/PermisosPage'))
const AuditPage = lazy(() => import('../components/AuditPage'))
const ModuloPage = lazy(() => import('../pages/ModuloPage'))
const ReportsPage = lazy(() => import('../components/ReportsPage'))
const ProfilePage = lazy(() => import('../components/ProfilePage'))
const AnalyzerPage = lazy(() => import('../components/AnalyzerPage'))
const PurchaseSourcingPage = lazy(() => import('../components/PurchaseSourcingPage'))
const PurchaseReturnsPage = lazy(() => import('../components/PurchaseReturnsPage'))
const PurchaseContractsPage = lazy(() => import('../components/PurchaseContractsPage'))
const ImportFoldersPage = lazy(() => import('../components/ImportFoldersPage'))
const SupplierEvaluationsPage = lazy(() => import('../components/SupplierEvaluationsPage'))
const InventoryOperationsPage = lazy(() => import('../components/InventoryOperationsPage'))
const InventoryQueriesPage = lazy(() => import('../components/InventoryQueriesPage'))
const PhysicalInventoryPage = lazy(() => import('../components/PhysicalInventoryPage'))
const InventoryTracePage = lazy(() => import('../components/InventoryTracePage'))
const SalesOperationsPage = lazy(() => import('../components/SalesOperationsPage'))

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
        <Route path="/sales" element={<SalesOperationsPage key="orders" initialTab="orders" />} />
        <Route path="/quotes" element={<SalesOperationsPage key="quotes" initialTab="quotes" />} />
        <Route path="/sales/receipts" element={<SalesOperationsPage key="receipts" initialTab="receipts" />} />
        <Route path="/sales/guides" element={<SalesOperationsPage key="guides" initialTab="guides" />} />
        <Route path="/sales/credits" element={<SalesOperationsPage key="credits" initialTab="credits" />} />
        <Route path="/sales/sunat" element={<SalesOperationsPage key="sunat" initialTab="sunat" />} />
        <Route path="/solicitudes-compra" element={<PurchaseSourcingPage />} />
        <Route path="/devoluciones-proveedor" element={<PurchaseReturnsPage />} />
        <Route path="/contratos-compra" element={<PurchaseContractsPage />} />
        <Route path="/importaciones" element={<ImportFoldersPage />} />
        <Route path="/evaluaciones-proveedores" element={<SupplierEvaluationsPage />} />
        <Route path="/operaciones-inventario" element={<Navigate to="/inventario/transferencias" replace />} />
        <Route path="/inventario/existencias" element={<InventoryQueriesPage view="stocks" />} />
        <Route path="/inventario/kardex" element={<InventoryQueriesPage view="kardex" />} />
        <Route path="/inventario/transferencias" element={<InventoryOperationsPage key="transfer" initialTab="transfer" />} />
        <Route path="/inventario/ajustes" element={<InventoryOperationsPage key="adjustment" initialTab="adjustment" />} />
        <Route path="/inventario/fisico" element={<PhysicalInventoryPage />} />
        <Route path="/inventario/lotes-series" element={<InventoryTracePage />} />
        <Route path="/ingreso-kardex" element={<ModuloPage page="purchases" view="receipts" />} />
        <Route path="/movimiento-kardex" element={<Navigate to="/inventario/kardex" replace />} />
        <Route path="/facturacion" element={<Navigate to="/sales" replace />} />
        <Route path="/estado-cuenta" element={<Navigate to="/finance" replace />} />
        <Route path="/mantenimientos" element={<MaintenancePage />} />
        <Route path="/permisos" element={<PermisosPage />} />
        <Route path="/auditoria" element={<AuditPage />} />
        <Route path="/caja" element={<CajaPage />} />
        <Route path="/analizador" element={<AnalyzerPage />} />
        <Route path="/settings" element={<Navigate to="/mantenimientos" replace />} />
        <Route path="/documents" element={<Navigate to="/dashboard" replace />} />
        <Route path="/perfil" element={<ProfilePage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/orden-compra" element={<Navigate to="/purchases" replace />} />
        <Route path="/orden-venta" element={<Navigate to="/sales" replace />} />
        <Route path="/cotizacion" element={<Navigate to="/quotes" replace />} />
        <Route path="/stock-productos" element={<Navigate to="/inventario/existencias" replace />} />
        <Route path="/reportes" element={<Navigate to="/reports" replace />} />
        <Route path="/:pageId" element={<ModuloPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes></Suspense>
  )
}
