import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, BrainCircuit, Building2, CheckCircle2, Coins, Download, Landmark, PlugZap, QrCode, RefreshCw, Wallet, Wrench } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import {
  fetchAllCurrencies, fetchAllPaymentMethods, fetchRecordsSnapshot, friendlyError,
  saveCurrency, savePaymentMethod, setCurrencyActive, setPaymentMethodActive,
  type Currency, type PaymentMethod,
} from '../services/records'

import YapeSettingsForm from './YapeSettingsForm'
import PlinSettingsForm from './PlinSettingsForm'
import BankTransferSettingsForm from './BankTransferSettingsForm'
import CompanyProfileForm from './CompanyProfileForm'
import OrganizationSetup from './OrganizationSetup'
import ProductCatalogSetup from './ProductCatalogSetup'
import { fetchCompanyProfile } from '../services/company'
import { readYapeSettings, parsePlinSettings, parseBankTransferSettings, PLIN_CONFIG_CODE, BANK_TRANSFER_CONFIG_CODE } from '../data/payments'
import { integrationStatusDetail, integrationStatusLabel, type PeruIntegrationStatus } from '../data/integrationStatus'
import { checkPeruLookupIntegration, fetchPeruIntegrationStatus } from '../services/integrations'
import { PageHeader } from './ui/PageHeader'
type MaintenanceSection = 'empresa' | 'organizacion' | 'catalogos' | 'cobros' | 'integraciones' | 'exportacion'
type MaintenanceTab = { id: MaintenanceSection; label: string; anchor: string }
type PanelId = 'empresa' | 'metodos' | 'moneda' | 'productos' | 'yape' | 'plin' | 'transferencia' | null
const MAINTENANCE_TABS: MaintenanceTab[] = [
  { id: 'empresa', label: 'Empresa', anchor: 'empresa' },
  { id: 'organizacion', label: 'Sucursales y zonas', anchor: 'organizacion' },
  { id: 'catalogos', label: 'Catálogos', anchor: 'catalogos' },
  { id: 'cobros', label: 'Datos de cobro', anchor: 'integraciones' },
  { id: 'integraciones', label: 'API y webhooks', anchor: 'api-webhooks' },
  { id: 'exportacion', label: 'Exportar datos', anchor: 'respaldos' },
]

function CatalogModal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="confirm-modal ws-catalog-modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <p>{description}</p>
        {children}
        <div className="modal-actions">
          <button className="cancel-button" type="button" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

export default function MaintenancePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { can } = useAuth()
  const { records, company, catalog, loading, reload, notify } = useRecords()
  const [exportBusy, setExportBusy] = useState(false)
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [methodsLoading, setMethodsLoading] = useState(true)
  const [methodMsg, setMethodMsg] = useState('')
  const [methodBusy, setMethodBusy] = useState(false)
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [currenciesLoading, setCurrenciesLoading] = useState(true)
  const [currencyMsg, setCurrencyMsg] = useState('')
  const [currencyBusy, setCurrencyBusy] = useState(false)
  const [section, setSection] = useState<MaintenanceSection>('empresa')
  const [expanded, setExpanded] = useState<PanelId>(null)
  const [peruStatus, setPeruStatus] = useState<PeruIntegrationStatus | null>(null)
  const [peruStatusLoading, setPeruStatusLoading] = useState(false)
  const [peruStatusBusy, setPeruStatusBusy] = useState(false)
  const [peruStatusMessage, setPeruStatusMessage] = useState('')
  const [neuralTriggering, setNeuralTriggering] = useState(false)
  const [neuralMessage, setNeuralMessage] = useState('')
  useEffect(() => {
    const anchor = location.hash.slice(1)
    if (!anchor) return
    const target = anchor === 'integraciones' ? 'cobros'
      : anchor === 'api-webhooks' ? 'integraciones'
      : anchor === 'respaldos' ? 'exportacion'
        : anchor === 'zonas-comerciales' || anchor === 'zonas-reparto' ? 'organizacion'
          : MAINTENANCE_TABS.find(item => item.anchor === anchor)?.id
    if (!target) return
    setSection(target)
    let timer = 0
    let attempts = 0
    const scrollWhenReady = () => {
      const element = document.getElementById(anchor)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else if (attempts++ < 40) {
        timer = window.setTimeout(scrollWhenReady, 100)
      }
    }
    timer = window.setTimeout(scrollWhenReady, 40)
    return () => window.clearTimeout(timer)
  }, [location.hash])
  const loadMethods = useCallback(async () => {
    setMethodsLoading(true); setMethodMsg('')
    try { setMethods(await fetchAllPaymentMethods()) }
    catch (error) { setMethods([]); setMethodMsg(friendlyError(error)) }
    finally { setMethodsLoading(false) }
  }, [])
  const loadCurrencies = useCallback(async () => {
    setCurrenciesLoading(true); setCurrencyMsg('')
    try { setCurrencies(await fetchAllCurrencies()) }
    catch (error) { setCurrencies([]); setCurrencyMsg(friendlyError(error)) }
    finally { setCurrenciesLoading(false) }
  }, [])
  useEffect(() => { if (can('settings')) void loadMethods() }, [loadMethods, can])
  useEffect(() => { if (can('settings')) void loadCurrencies() }, [loadCurrencies, can])
  const loadPeruStatus = useCallback(async () => {
    setPeruStatusLoading(true)
    setPeruStatusMessage('')
    try { setPeruStatus(await fetchPeruIntegrationStatus()) }
    catch { setPeruStatusMessage('No se pudo cargar el último estado guardado.') }
    finally { setPeruStatusLoading(false) }
  }, [])
  useEffect(() => { if (section === 'integraciones') void loadPeruStatus() }, [section, loadPeruStatus])
  if (!can('settings')) {
    return <section className="ws-card ws-empty-compact"><Wrench size={28} /><strong>Acceso restringido al mantenimiento</strong><span>Tu rol no tiene permiso de configuración del sistema.</span></section>
  }
  const modules: Array<[string, number]> = [
    ['Ventas', records.sales.length],
    ['Compras', records.purchases.length],
    ['Cotizaciones', records.quotes.length],
    ['Productos', records.inventory.length],
    ['Clientes', records.customers.length],
    ['Proveedores', records.suppliers.length],
    ['Cuentas', records.finance.length],
    ['Catálogo', catalog.length],
  ]
  const yapeConfigured = (() => {
    try { const settings = readYapeSettings(records.settings); return Boolean(settings?.enabled && settings.qrImage) }
    catch { return false }
  })()
  const plinConfigured = (() => { try { const row = records.settings.find(item => item.id === PLIN_CONFIG_CODE); const settings = row ? parsePlinSettings(row.detail) : null; return Boolean(settings?.enabled && settings.qrImage) } catch { return false } })()
  const bankConfigured = (() => { try { const row = records.settings.find(item => item.id === BANK_TRANSFER_CONFIG_CODE); const settings = row ? parseBankTransferSettings(row.detail) : null; return Boolean(settings?.enabled && settings.numeroCuenta) } catch { return false } })()


  const addMethod = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (methodBusy) return
    const form = event.currentTarget
    const values = new FormData(form)
    setMethodBusy(true); setMethodMsg('')
    try {
      await savePaymentMethod(String(values.get('nombre') ?? ''))
      await loadMethods()
      form.reset()
      notify('Método de pago agregado.')
    } catch (error) { setMethodMsg(friendlyError(error)) }
    finally { setMethodBusy(false) }
  }

  const toggleMethod = async (method: PaymentMethod) => {
    if (methodBusy) return
    setMethodBusy(true); setMethodMsg('')
    try {
      await setPaymentMethodActive(method.id, !method.activo)
      await loadMethods()
      notify(`Método ${method.nombre} ${method.activo ? 'desactivado' : 'activado'}.`)
    } catch (error) { setMethodMsg(friendlyError(error)) }
    finally { setMethodBusy(false) }
  }

  const addCurrency = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (currencyBusy) return
    const form = event.currentTarget
    const values = new FormData(form)
    setCurrencyBusy(true); setCurrencyMsg('')
    try {
      await saveCurrency({ nombre: String(values.get('nombre') ?? ''), codigo: String(values.get('codigo') ?? ''), simbolo: String(values.get('simbolo') ?? '') })
      await loadCurrencies()
      form.reset()
      notify('Tipo de moneda agregado.')
    } catch (error) { setCurrencyMsg(friendlyError(error)) }
    finally { setCurrencyBusy(false) }
  }

  const toggleCurrency = async (currency: Currency) => {
    if (currencyBusy) return
    setCurrencyBusy(true); setCurrencyMsg('')
    try {
      await setCurrencyActive(currency.id, !currency.activo)
      await loadCurrencies()
      notify(`Moneda ${currency.nombre} ${currency.activo ? 'desactivada' : 'activada'}.`)
    } catch (error) { setCurrencyMsg(friendlyError(error)) }
    finally { setCurrencyBusy(false) }
  }


  const exportOperationalData = async () => {
    if (exportBusy) return
    setExportBusy(true)
    try {
      const [snapshot, companySnapshot] = await Promise.all([fetchRecordsSnapshot(), fetchCompanyProfile()])
      const failed = Object.values(snapshot.errors)[0]
      if (failed) throw new Error(failed)
      const stamp = new Date().toISOString().slice(0, 10)
      const payload = {
        app: 'EnterpriseCloud',
        tipo: 'exportacion_operativa',
        fecha: new Date().toISOString(),
        advertencia: 'Esta exportación no es una copia restaurable de la plataforma. No incluye cuentas Auth, esquema, migraciones, funciones ni archivos de Storage.',
        modulos: Object.fromEntries(modules),
        empresa: companySnapshot,
        registros: snapshot.records,
        catalogo: catalog,
      }
      const href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = href
      link.download = `exportacion-operativa-enterprisecloud-${stamp}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(href), 0)
      notify('Exportación de datos operativos descargada en JSON. Protégela: puede contener información comercial y bancaria.')
    } catch (error) { notify(friendlyError(error)) }
    finally { setExportBusy(false) }
  }

  const verifyPeruIntegration = async () => {
    if (peruStatusBusy) return
    setPeruStatusBusy(true)
    setPeruStatusMessage('')
    try {
      const result = await checkPeruLookupIntegration()
      setPeruStatus(result)
      setPeruStatusMessage('Resultado guardado. La credencial no se presenta ni se almacena en esta pantalla.')
    } catch (error) {
      setPeruStatusMessage(friendlyError(error))
    } finally {
      setPeruStatusBusy(false)
    }
  }

  const triggerNeuralTraining = () => {
    if (neuralTriggering) return
    setNeuralTriggering(true)
    setNeuralMessage('Entrenamiento solicitado. Abriendo el monitor neuronal…')
    window.setTimeout(() => {
      setNeuralTriggering(false)
      navigate('/inteligencia/red-neuronal')
    }, 850)
  }

  return <>
    <PageHeader
      icon={Wrench}
      section="Configuración e integraciones"
      title="Configuración del sistema"
      description="Administra la ficha de empresa, ubicaciones, catálogos, datos de cobro y el estado de integraciones de servidor."
      actions={<button className="ws-button ws-button-secondary" disabled={loading} onClick={() => void reload()}><RefreshCw size={16} />Actualizar datos</button>}
    />
    <div className="ws-maintenance-tabs"><div className="ws-tabs" role="tablist" aria-label="Secciones de configuración" aria-orientation="horizontal">{MAINTENANCE_TABS.map((item, index) => <button key={item.id} id={`ws-maintenance-tab-${item.id}`} type="button" role="tab" aria-selected={section === item.id} aria-controls={item.anchor} tabIndex={section === item.id ? 0 : -1} onClick={() => { setSection(item.id); setExpanded(null) }} onKeyDown={event => { if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return; event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? MAINTENANCE_TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + MAINTENANCE_TABS.length) % MAINTENANCE_TABS.length; const tab = MAINTENANCE_TABS[next]; setSection(tab.id); setExpanded(null); document.getElementById(`ws-maintenance-tab-${tab.id}`)?.focus() }}>{item.label}</button>)}</div></div>
    <section id="empresa" className="ws-catalog-more ws-maintenance-anchor" role="tabpanel" aria-labelledby="ws-maintenance-tab-empresa" aria-hidden={section !== 'empresa'} hidden={section !== 'empresa'}><div className="ws-section-heading"><div><h2>Datos de empresa</h2><p>Identidad fiscal y datos de contacto usados en comprobantes, reportes y guías.</p></div></div><div className="ws-report-grid">
      <article className="ws-card ws-report-card"><span className="ws-soft-icon green"><Building2 size={21} /></span><h2>Empresa principal</h2><p>{company?.razonSocial ? `${company.razonSocial}${company.ruc ? ` · RUC ${company.ruc}` : ''}` : 'Completa los datos que identifican a tu empresa.'}</p><span><button className="ws-text-button" aria-expanded={expanded === 'empresa'} onClick={() => setExpanded(current => current === 'empresa' ? null : 'empresa')}>{expanded === 'empresa' ? 'Ocultar' : 'Configurar empresa'}</button></span></article>
    </div></section>
    <section id="organizacion" className="ws-catalog-more ws-maintenance-anchor" role="tabpanel" aria-labelledby="ws-maintenance-tab-organizacion" aria-hidden={section !== 'organizacion'} hidden={section !== 'organizacion'}><div className="ws-section-heading"><div><h2>Sucursales, almacenes y zonas</h2><p>Organización física y territorio comercial/de reparto. Los horarios y propósitos quedan asociados al registro correspondiente.</p></div></div><OrganizationSetup canManageOrganization={can('settings', 'editar')} canViewCustomers={can('customers', 'ver')} canInitializeStock={can('inventory', 'editar')} onChanged={async () => { await reload(); notify('Apertura de inventario guardada en Supabase.') }} /></section>
    <section id="catalogos" className="ws-catalog-more ws-maintenance-anchor" role="tabpanel" aria-labelledby="ws-maintenance-tab-catalogos" aria-hidden={section !== 'catalogos'} hidden={section !== 'catalogos'}><div className="ws-section-heading"><div><h2>Catálogos compartidos</h2><p>Clasificación de productos, unidades, medios de pago y monedas usadas en las operaciones.</p></div></div><div className="ws-report-grid">
      <article className="ws-card ws-report-card"><span className="ws-soft-icon violet"><Wrench size={21} /></span><h2>Productos y unidades</h2><p>Administra categorías y unidades enteras para productos del inventario.</p><span><button className="ws-text-button" aria-expanded={expanded === 'productos'} onClick={() => setExpanded(current => current === 'productos' ? null : 'productos')}>{expanded === 'productos' ? 'Ocultar' : 'Administrar'}</button></span></article>
      <article className="ws-card ws-report-card"><span className="ws-soft-icon green"><Wallet size={21} /></span><h2>Métodos de pago</h2><p>{methods.filter(item => item.activo).length} aceptados en cobranza y pagos.</p><span><button className="ws-text-button" aria-expanded={expanded === 'metodos'} onClick={() => setExpanded(current => (current === 'metodos' ? null : 'metodos'))}>{expanded === 'metodos' ? 'Ocultar' : 'Administrar'}</button></span></article>
      <article className="ws-card ws-report-card"><span className="ws-soft-icon amber"><Coins size={21} /></span><h2>Tipos de moneda</h2><p>{currencies.filter(item => item.activo).length} monedas configuradas.</p><span><button className="ws-text-button" aria-expanded={expanded === 'moneda'} onClick={() => setExpanded(current => (current === 'moneda' ? null : 'moneda'))}>{expanded === 'moneda' ? 'Ocultar' : 'Administrar'}</button></span></article>
    </div></section>
    <section id="integraciones" className="ws-catalog-more ws-maintenance-anchor" role="tabpanel" aria-labelledby="ws-maintenance-tab-cobros" aria-hidden={section !== 'cobros'} hidden={section !== 'cobros'}><div className="ws-section-heading"><div><h2>Datos informativos de cobro</h2><p>Configura la información que se muestra al vender. Estos datos no procesan ni verifican pagos.</p></div></div><div className="ws-report-grid">
      <article className="ws-card ws-report-card"><span className="ws-soft-icon violet"><QrCode size={21} /></span><h2>QR de Yape</h2><p>{yapeConfigured ? 'Tu QR se muestra junto al total al seleccionar Yape en ventas.' : 'Carga tu QR de Yape y los datos del titular para cobrar.'}</p><span><button className="ws-text-button" aria-expanded={expanded === 'yape'} onClick={() => setExpanded(current => current === 'yape' ? null : 'yape')}>{expanded === 'yape' ? 'Ocultar' : 'Configurar QR'}</button></span></article>
      <article className="ws-card ws-report-card"><span className="ws-soft-icon violet"><QrCode size={21} /></span><h2>QR de Plin</h2><p>{plinConfigured ? 'Tu QR se muestra al seleccionar Plin en ventas.' : 'Configura el QR y titular de Plin.'}</p><span><button className="ws-text-button" aria-expanded={expanded === 'plin'} onClick={() => setExpanded(current => current === 'plin' ? null : 'plin')}>{expanded === 'plin' ? 'Ocultar' : 'Configurar QR'}</button></span></article>
      <article className="ws-card ws-report-card"><span className="ws-soft-icon green"><Landmark size={21} /></span><h2>Transferencia bancaria</h2><p>{bankConfigured ? 'La cuenta configurada se muestra al registrar ventas.' : 'Agrega los datos de la cuenta que recibirá los pagos.'}</p><span><button className="ws-text-button" aria-expanded={expanded === 'transferencia'} onClick={() => setExpanded(current => current === 'transferencia' ? null : 'transferencia')}>{expanded === 'transferencia' ? 'Ocultar' : 'Configurar cuenta'}</button></span></article>
    </div></section>
    <section id="api-webhooks" className="ws-catalog-more ws-maintenance-anchor" role="tabpanel" aria-labelledby="ws-maintenance-tab-integraciones" aria-hidden={section !== 'integraciones'} hidden={section !== 'integraciones'}>
      <div className="ws-section-heading"><div><h2>Integraciones de servidor</h2><p>Estado no secreto de las funciones externas conectadas a EnterpriseCloud.</p></div></div>
      <div className="ws-report-grid">
          <article className="ws-card ws-report-card">
          <span className={`ws-soft-icon ${peruStatus?.state === 'configured' ? 'green' : 'amber'}`}>{peruStatus?.state === 'configured' ? <CheckCircle2 size={21} /> : <PlugZap size={21} />}</span>
          <h2>RENIEC / SUNAT</h2>
          <p>Consulta documental protegida por una Edge Function autenticada. No se envía ninguna clave desde el navegador.</p>
          <strong>{peruStatusLoading ? 'Cargando estado…' : peruStatus ? integrationStatusLabel(peruStatus.state) : 'Sin comprobación guardada'}</strong>
          <small>{peruStatus ? integrationStatusDetail(peruStatus.state) : 'La comprobación solo informa si el secreto existe y si el destino está permitido; no valida la credencial contra el proveedor.'}</small>
          {peruStatus?.provider && <small>Proveedor configurado: apis.net.pe</small>}
          {peruStatus?.checked_at && <small>Última comprobación: {new Date(peruStatus.checked_at).toLocaleString('es-PE')}</small>}
          {can('settings', 'editar') && <span><button className="ws-button ws-button-secondary" type="button" disabled={peruStatusBusy || peruStatusLoading} onClick={() => void verifyPeruIntegration()}><RefreshCw size={15} className={peruStatusBusy ? 'ws-spin' : ''} />{peruStatusBusy ? 'Comprobando…' : 'Comprobar configuración'}</button></span>}
          </article>
          <article className="ws-card ws-report-card">
            <span className="ws-soft-icon violet"><BrainCircuit size={21} /></span>
            <h2>Motor neuronal multitarea</h2>
            <p>Estado DEMO · modelo v0.8.4 · 4 cabezas de salida listas para inferencia.</p>
            <strong className="ws-neural-status"><i /> Inferencia activa</strong>
            <small>Entrena con señales de Ventas, Inventario, Tesorería, Compras, Logística y Metas.</small>
            <span><button className="ws-button ws-button-secondary" type="button" disabled={neuralTriggering} onClick={triggerNeuralTraining}><BrainCircuit size={15} />{neuralTriggering ? 'Solicitando…' : 'Disparar entrenamiento'}</button></span>
            {neuralMessage && <small role="status">{neuralMessage}</small>}
          </article>
      </div>
      <div className="ws-notice ws-notice-warning" role="note"><AlertTriangle size={17} /><div><strong>La credencial se administra en Supabase</strong><span>Usa el secreto PERU_API_TOKEN en el entorno de Edge Functions. El estado guardado aquí nunca incluye el token ni la URL completa.</span></div></div>
      {peruStatusMessage && <div className="ws-notice" role="status">{peruStatusMessage}</div>}
    </section>
    <section id="respaldos" className="ws-catalog-more ws-maintenance-anchor" role="tabpanel" aria-labelledby="ws-maintenance-tab-exportacion" aria-hidden={section !== 'exportacion'} hidden={section !== 'exportacion'}><div className="ws-section-heading"><div><h2>Exportación operativa</h2><p>Descarga registros operativos y catálogos consultados por la aplicación.</p></div></div><div className="ws-notice ws-notice-warning" role="note"><strong>No es un respaldo restaurable:</strong> no incluye cuentas Auth, esquema, migraciones, funciones ni archivos de Storage. El archivo puede contener información comercial y bancaria; guárdalo en un lugar protegido.</div><div className="ws-report-grid"><article className="ws-card ws-report-card"><span className="ws-soft-icon green"><Download size={21} /></span><h2>Exportar datos</h2><p>Incluye registros, catálogos y ficha de empresa disponibles para tu usuario.</p><span><button className="ws-button" disabled={exportBusy || loading} onClick={() => void exportOperationalData()}><Download size={16} />{exportBusy ? 'Preparando…' : 'Descargar JSON'}</button></span></article></div></section>
    {expanded === 'empresa' && <CatalogModal title="Empresa principal" description="Estos datos aparecen como emisor en los comprobantes y reportes." onClose={() => setExpanded(null)}><CompanyProfileForm canCreate={can('settings', 'crear')} canEdit={can('settings', 'editar')} onSaved={async () => { await reload(); notify('Ficha de empresa guardada en Supabase.') }} /></CatalogModal>}
    {expanded === 'productos' && <CatalogModal title="Catálogos de productos" description="Clasificación y unidades permitidas para inventario." onClose={() => setExpanded(null)}><ProductCatalogSetup canCreate={can('settings', 'crear')} canEdit={can('settings', 'editar')} /></CatalogModal>}
    {expanded === 'metodos' && <CatalogModal title="Métodos de pago" description="Medios aceptados al cobrar y pagar. Desactiva el que falle." onClose={() => setExpanded(null)}><div className="supplier-product-list">{methods.map(method => <div className="supplier-product-row" key={method.id}><span className="supplier-product-copy"><strong>{method.nombre}</strong><small>{method.activo ? 'Aceptado en cobranza y pagos' : 'Desactivado: no se ofrece'}</small></span><span className="supplier-product-actions">{method.activo ? (can('finance', 'editar') && <button className="export-button" type="button" disabled={methodBusy} onClick={() => void toggleMethod(method)}>Desactivar</button>) : (can('finance', 'editar') && <button className="export-button" type="button" disabled={methodBusy} onClick={() => void toggleMethod(method)}>Activar</button>)}</span></div>)}</div>{can('finance', 'crear') && <form className="supplier-link-bar" onSubmit={addMethod}><input aria-label="Nombre del método de pago" name="nombre" required minLength={2} placeholder="Nuevo método (ej. Billetera X)" /><button className="primary-button" type="submit" disabled={methodBusy}>{methodBusy ? 'Guardando…' : 'Agregar'}</button></form>}{methodMsg && <div className="ws-notice ws-notice-warning" role="alert">{methodMsg}</div>}</CatalogModal>}
    {expanded === 'moneda' && <CatalogModal title="Tipos de moneda" description="La base es el sol peruano (PEN). El tipo de cambio se define en Maestros → Catálogos; aquí solo se agregan o desactivan monedas." onClose={() => setExpanded(null)}>{currenciesLoading ? <div className="ws-empty-compact"><RefreshCw size={26} className="ws-spin" /><strong>Cargando monedas…</strong></div> : <><div className="supplier-product-list">{currencies.map(currency => <div className="supplier-product-row" key={currency.id}><span className="supplier-product-copy"><strong>{currency.nombre}</strong><small>{currency.codigo} · {currency.simbolo} · TC S/ {currency.tipo_cambio.toFixed(4)} · {currency.activo ? 'Activa' : 'Desactivada'}</small></span><span className="supplier-product-actions">{can('finance', 'editar') && <button className="export-button" type="button" disabled={currencyBusy} onClick={() => void toggleCurrency(currency)}>{currency.activo ? 'Desactivar' : 'Activar'}</button>}</span></div>)}</div>{can('finance', 'crear') && <form className="ws-currency-add-form" onSubmit={addCurrency}><div className="ws-currency-add-inputs"><input aria-label="Nombre de la moneda" name="nombre" required minLength={2} placeholder="Ej. Dólar" /><input aria-label="Código de la moneda" name="codigo" required minLength={3} maxLength={3} placeholder="USD" /><input aria-label="Símbolo de la moneda" name="simbolo" required placeholder="$" /></div><button className="primary-button" type="submit" disabled={currencyBusy}>{currencyBusy ? 'Guardando…' : 'Agregar moneda'}</button></form>}{currencyMsg && <div className="ws-notice ws-notice-warning" role="alert">{currencyMsg}</div>}</>}</CatalogModal>}
    {expanded === 'yape' && <CatalogModal title="QR de Yape" description="Guarda tu QR original y el nombre de quien recibe el yapeo." onClose={() => setExpanded(null)}><YapeSettingsForm canCreate={can('settings', 'crear')} canEdit={can('settings', 'editar')} onSaved={async () => { await reload(); notify('Configuración de Yape guardada en Supabase.') }} /></CatalogModal>}
    {expanded === 'plin' && <CatalogModal title="QR de Plin" description="Guarda el QR original y los datos del titular que recibe el pago." onClose={() => setExpanded(null)}><PlinSettingsForm canCreate={can('settings', 'crear')} canEdit={can('settings', 'editar')} onSaved={async () => { await reload(); notify('Configuración de Plin guardada en Supabase.') }} /></CatalogModal>}
    {expanded === 'transferencia' && <CatalogModal title="Transferencia bancaria" description="Configura la cuenta a la que tus clientes enviarán sus pagos." onClose={() => setExpanded(null)}><BankTransferSettingsForm canCreate={can('settings', 'crear')} canEdit={can('settings', 'editar')} onSaved={async () => { await reload(); notify('Cuenta bancaria guardada en Supabase.') }} /></CatalogModal>}
  </>
}
