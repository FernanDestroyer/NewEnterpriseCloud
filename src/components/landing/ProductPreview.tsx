import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUpRight, Box, Check, FileText, LayoutDashboard, Search, ShoppingCart, Wallet } from 'lucide-react'

export type PreviewRecord = {
  id: string
  name: string
  status: string
  amount?: number
  quantity?: number
}

export type PreviewData = Record<'sales' | 'inventory' | 'finance', PreviewRecord[]>

const views = [
  { key: 'sales', label: 'Ventas', icon: ShoppingCart, heading: 'Cada venta, en su lugar.', metric: 'Valor registrado', empty: 'Todavía no hay ventas registradas.' },
  { key: 'inventory', label: 'Inventario', icon: Box, heading: 'Tu stock, a la vista.', metric: 'Unidades registradas', empty: 'Todavía no hay productos registrados.' },
  { key: 'finance', label: 'Finanzas', icon: Wallet, heading: 'Los pendientes, bajo control.', metric: 'Valor registrado', empty: 'Todavía no hay movimientos registrados.' },
] as const

const currency = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', maximumFractionDigits: 0 })

export default function ProductPreview({ data }: { data: PreviewData }) {
  const [active, setActive] = useState(0)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()
  const view = views[active]
  const records = data[view.key]
  const isStock = view.key === 'inventory'
  const total = records.reduce((sum, item) => sum + (isStock ? item.quantity ?? 0 : item.amount ?? 0), 0)

  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % views.length
    else if (event.key === 'ArrowLeft') next = (index + views.length - 1) % views.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = views.length - 1
    else return
    event.preventDefault()
    setActive(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <section className="home-preview-section home-container home-reveal" id="vista-previa" aria-labelledby="home-preview-title">
      <div className="home-preview-copy">
        <span className="home-eyebrow">02 / EL PANEL, DE CERCA</span>
        <h2 id="home-preview-title">Menos buscar.<br /><span>Más resolver.</span></h2>
        <p>Una vista para encontrar lo que necesitas y seguir trabajando. Prueba los módulos y mira cómo se organiza tu información.</p>
        <ul className="home-check-list">
          <li><Check size={16} /> Consulta por nombre, referencia o estado.</li>
          <li><Check size={16} /> Actualiza cada registro desde su tabla.</li>
          <li><Check size={16} /> Lleva tus datos a PDF, CSV o Excel.</li>
        </ul>
        <span className="home-preview-note"><span /> Vista previa con los registros de tu panel.</span>
      </div>
      <div className="home-preview-window">
        <div className="home-preview-topline"><span><LayoutDashboard size={16} /> Tu espacio de trabajo</span><span className="home-preview-readonly">VISTA PREVIA</span></div>
        <div className="home-preview-tabs" role="tablist" aria-label="Explorar módulos del panel">
          {views.map(({ key, label, icon: Icon }, index) => (
            <button key={key} ref={(element) => { tabRefs.current[index] = element }} type="button" role="tab" id={`${id}-tab-${key}`} aria-controls={`${id}-panel`} aria-selected={active === index} tabIndex={active === index ? 0 : -1} onClick={() => setActive(index)} onKeyDown={(event) => navigateTabs(event, index)}>
              <Icon size={16} />{label}
            </button>
          ))}
        </div>
        <div key={view.key} className="home-preview-content" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${view.key}`} tabIndex={0}>
          <div className="home-preview-heading"><div><span>RESUMEN DEL MÓDULO</span><h3>{view.heading}</h3></div><ArrowUpRight size={22} aria-hidden="true" /></div>
          <div className="home-preview-summary">
            <div><small>{view.metric}</small><strong>{isStock ? `${total.toLocaleString('es-PE')} und.` : currency.format(total)}</strong></div>
            <div><small>Registros</small><strong>{String(records.length).padStart(2, '0')}</strong></div>
          </div>
          <div className="home-preview-list-title"><span>Últimos registros</span><Search size={15} aria-hidden="true" /></div>
          <ul className="home-preview-list">
            {records.slice(0, 3).map((record) => {
              const warning = ['Pendiente', 'Bajo stock', 'Crítico'].includes(record.status)
              return (
                <li key={record.id}>
                  <span className="home-preview-record-icon"><FileText size={16} /></span>
                  <div><strong>{record.name}</strong><small>{record.id}</small></div>
                  <span className={`home-preview-status${warning ? ' is-warning' : ''}`}>{record.status}</span>
                </li>
              )
            })}
            {!records.length && <li className="home-preview-empty">{view.empty}</li>}
          </ul>
        </div>
        <div className="home-preview-bottom"><span><span /> Datos de tu sesión de Supabase</span><span>{String(active + 1).padStart(2, '0')} / 03</span></div>
      </div>
    </section>
  )
}
