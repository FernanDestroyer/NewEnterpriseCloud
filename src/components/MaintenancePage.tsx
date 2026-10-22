import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Download, RefreshCw, Wallet, Wrench, Coins, QrCode } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import {
  fetchAllCurrencies, fetchAllPaymentMethods, fetchRecordsSnapshot, friendlyError,
  saveCurrency, savePaymentMethod, setCurrencyActive, setPaymentMethodActive,
  type Currency, type PaymentMethod,
} from '../services/records'

import ModuloPage from './ModuloPage'
import YapeSettingsForm from './YapeSettingsForm'
import { readPlinSettings, readYapeSettings } from '../data/payments'
import type { DataPage } from '../types'

type CatalogTab = { page: 'customers' | 'inventory' | 'suppliers'; label: string }
type PanelId = 'metodos' | 'moneda' | 'yape' | 'plin' | null

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
      <div className="confirm-modal" role="dialog" aria-modal="true" aria-label={title}>
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
  const { can } = useAuth()
  const { records, catalog, loading, errors, lastSyncedAt, reload, notify } = useRecords()
  const [backupBusy, setBackupBusy] = useState(false)
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [methodsLoading, setMethodsLoading] = useState(true)
  const [methodMsg, setMethodMsg] = useState('')
  const [methodBusy, setMethodBusy] = useState(false)
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [currenciesLoading, setCurrenciesLoading] = useState(true)
  const [currencyMsg, setCurrencyMsg] = useState('')
  const [currencyBusy, setCurrencyBusy] = useState(false)
  const [tab, setTab] = useState<DataPage | null>(null)
  const [expanded, setExpanded] = useState<PanelId>(null)
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
  if (!can('settings')) {
    return <section className="ws-card ws-empty-compact"><Wrench size={28} /><strong>Acceso restringido al mantenimiento</strong><span>Tu rol no tiene permiso de configuración del sistema.</span></section>
  }
  const tabs: CatalogTab[] = ([
    { page: 'customers', label: 'Clientes' },
    { page: 'inventory', label: 'Productos' },
    { page: 'suppliers', label: 'Proveedores' },
  ] as CatalogTab[]).filter(option => can(option.page))
  const activeTab = tabs.find(option => option.page === tab) ?? tabs[0]
  const tabCount = (page: DataPage) => page === 'customers' ? records.customers.length : page === 'inventory' ? records.inventory.length : records.suppliers.length
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
  const plinConfigured = (() => {
    try { const settings = readPlinSettings(records.settings); return Boolean(settings?.enabled && settings.qrImage) }
    catch { return false }
  })()


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


  const backup = async () => {
    if (backupBusy) return
    setBackupBusy(true)
    try {
      const snapshot = await fetchRecordsSnapshot()
      const failed = Object.values(snapshot.errors)[0]
      if (failed) throw new Error(failed)
      const stamp = new Date().toISOString().slice(0, 10)
      const payload = { app: 'EnterpriseCloud', tipo: 'respaldo', fecha: new Date().toISOString(), modulos: Object.fromEntries(modules), registros: snapshot.records, catalogo: catalog }
      const href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = href
      link.download = `respaldo-enterprisecloud-${stamp}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(href), 0)
      notify('Respaldo descargado en JSON.')
    } catch (error) { notify(friendlyError(error)) }
    finally { setBackupBusy(false) }
  }

  return <>
    <section className="ws-page-heading"><div><span className="ws-eyebrow">MANTENIMIENTO DEL SISTEMA</span><h1>Mantenimiento</h1><p>Administra los catálogos de tu operación: clientes, productos y proveedores, más empresa, pagos y precios.</p></div><div className="ws-heading-actions"><button className="ws-button ws-button-secondary" disabled={loading} onClick={() => void reload()}><RefreshCw size={16} />Actualizar datos</button><button className="ws-button" disabled={backupBusy || loading} onClick={() => void backup()}><Download size={16} />{backupBusy ? 'Generando…' : 'Descargar respaldo'}</button></div></section>
    {activeTab ? <>
      <div className="ws-maintenance-tabs"><div className="ws-tabs" role="tablist" aria-label="Catálogos">{tabs.map(option => <button key={option.page} role="tab" aria-selected={activeTab.page === option.page} onClick={() => setTab(option.page)}>{option.label} · {tabCount(option.page)}</button>)}</div></div>
      <ModuloPage key={activeTab.page} page={activeTab.page} embedded allowCreate={false} />
    </> : <div className="ws-empty-compact">Tu rol no tiene permisos de consulta de catálogos.</div>}
    <section className="ws-catalog-more"><div className="ws-section-heading"><div><h2>Otros catálogos</h2><p>Medios de pago, tipos de moneda y QR de cobro.</p></div></div><div className="ws-report-grid">
      <article className="ws-card ws-report-card"><span className="ws-soft-icon green"><Wallet size={21} /></span><h2>Métodos de pago</h2><p>{methods.filter(item => item.activo).length} aceptados en cobranza y pagos.</p><span><button className="ws-text-button" aria-expanded={expanded === 'metodos'} onClick={() => setExpanded(current => (current === 'metodos' ? null : 'metodos'))}>{expanded === 'metodos' ? 'Ocultar' : 'Administrar'}</button></span></article>
      <article className="ws-card ws-report-card"><span className="ws-soft-icon amber"><Coins size={21} /></span><h2>Tipos de moneda</h2><p>{currencies.filter(item => item.activo).length} monedas configuradas.</p><span><button className="ws-text-button" aria-expanded={expanded === 'moneda'} onClick={() => setExpanded(current => (current === 'moneda' ? null : 'moneda'))}>{expanded === 'moneda' ? 'Ocultar' : 'Administrar'}</button></span></article>
      <article className="ws-card ws-report-card"><span className="ws-soft-icon violet"><QrCode size={21} /></span><h2>QR de Yape</h2><p>{yapeConfigured ? 'Tu QR se muestra junto al total al seleccionar Yape en ventas.' : 'Carga tu QR de Yape y los datos del titular para cobrar.'}</p><span><button className="ws-text-button" aria-expanded={expanded === 'yape'} onClick={() => setExpanded(current => current === 'yape' ? null : 'yape')}>{expanded === 'yape' ? 'Ocultar' : 'Configurar QR'}</button></span></article>
      <article className="ws-card ws-report-card"><span className="ws-soft-icon violet"><QrCode size={21} /></span><h2>QR de Plin</h2><p>{plinConfigured ? 'Tu QR se muestra junto al total al seleccionar Plin en ventas.' : 'Carga tu QR de Plin y los datos del titular para cobrar.'}</p><span><button className="ws-text-button" aria-expanded={expanded === 'plin'} onClick={() => setExpanded(current => current === 'plin' ? null : 'plin')}>{expanded === 'plin' ? 'Ocultar' : 'Configurar QR'}</button></span></article>
    </div></section>
    {expanded === 'metodos' && <CatalogModal title="Métodos de pago" description="Medios aceptados al cobrar y pagar. Desactiva el que falle." onClose={() => setExpanded(null)}><div className="supplier-product-list">{methods.map(method => <div className="supplier-product-row" key={method.id}><span className="supplier-product-copy"><strong>{method.nombre}</strong><small>{method.activo ? 'Aceptado en cobranza y pagos' : 'Desactivado: no se ofrece'}</small></span><span className="supplier-product-actions">{method.activo ? (can('finance', 'editar') && <button className="export-button" type="button" disabled={methodBusy} onClick={() => void toggleMethod(method)}>Desactivar</button>) : (can('finance', 'editar') && <button className="export-button" type="button" disabled={methodBusy} onClick={() => void toggleMethod(method)}>Activar</button>)}</span></div>)}</div>{can('finance', 'crear') && <form className="supplier-link-bar" onSubmit={addMethod}><input aria-label="Nombre del método de pago" name="nombre" required minLength={2} placeholder="Nuevo método (ej. Billetera X)" /><button className="primary-button" type="submit" disabled={methodBusy}>{methodBusy ? 'Guardando…' : 'Agregar'}</button></form>}{methodMsg && <div className="ws-notice ws-notice-warning" role="alert">{methodMsg}</div>}</CatalogModal>}
    {expanded === 'moneda' && <CatalogModal title="Tipos de moneda" description="La base es el sol peruano (PEN). Activa o desactiva las demás." onClose={() => setExpanded(null)}>{currenciesLoading ? <div className="ws-empty-compact"><RefreshCw size={26} className="ws-spin" /><strong>Cargando monedas…</strong></div> : <><div className="supplier-product-list">{currencies.map(currency => <div className="supplier-product-row" key={currency.id}><span className="supplier-product-copy"><strong>{currency.nombre}</strong><small>{currency.codigo} · {currency.simbolo} · {currency.activo ? 'Activa' : 'Desactivada'}</small></span><span className="supplier-product-actions">{can('finance', 'editar') && <button className="export-button" type="button" disabled={currencyBusy} onClick={() => void toggleCurrency(currency)}>{currency.activo ? 'Desactivar' : 'Activar'}</button>}</span></div>)}</div>{can('finance', 'crear') && <form className="supplier-link-bar" onSubmit={addCurrency}><input aria-label="Nombre de la moneda" name="nombre" required minLength={2} placeholder="Ej. Dólar" /><input aria-label="Código de la moneda" name="codigo" required minLength={3} maxLength={3} placeholder="USD" /><input aria-label="Símbolo de la moneda" name="simbolo" required placeholder="$" /><button className="primary-button" type="submit" disabled={currencyBusy}>{currencyBusy ? 'Guardando…' : 'Agregar'}</button></form>}{currencyMsg && <div className="ws-notice ws-notice-warning" role="alert">{currencyMsg}</div>}</>}</CatalogModal>}
    {expanded === 'yape' && <CatalogModal title="QR de Yape" description="Guarda tu QR original y el nombre de quien recibe el yapeo." onClose={() => setExpanded(null)}><YapeSettingsForm canCreate={can('settings', 'crear')} canEdit={can('settings', 'editar')} onSaved={async () => { await reload(); notify('Configuración de Yape guardada en Supabase.') }} /></CatalogModal>}
    {expanded === 'plin' && <CatalogModal title="QR de Plin" description="Guarda tu QR original y el nombre de quien recibe los pagos con Plin." onClose={() => setExpanded(null)}><YapeSettingsForm wallet="plin" canCreate={can('settings', 'crear')} canEdit={can('settings', 'editar')} onSaved={async () => { await reload(); notify('Configuración de Plin guardada en Supabase.') }} /></CatalogModal>}
  </>
}
