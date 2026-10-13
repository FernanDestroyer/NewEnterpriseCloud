import { useId, useState } from 'react'
import { ArrowUpRight, ChartNoAxesCombined, MousePointer2, Plus } from 'lucide-react'
import { buildSalesSeries, recordAmount, type ChartMode, type SalesFilter } from '../../data/dashboard'
import { money } from '../../data/helpers'
import type { RecordItem } from '../../types'

const filters: { value: SalesFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'completed', label: 'Completadas' },
  { value: 'open', label: 'Por completar' },
]

const compactNumber = (value: number) => new Intl.NumberFormat('es-PE', { notation: 'compact', maximumFractionDigits: 1 }).format(value)

export default function SalesChart({ sales, onCreate, onOpen }: { sales: RecordItem[]; onCreate: () => void; onOpen: (item: RecordItem) => void }) {
  const gradientId = useId()
  const [filter, setFilter] = useState<SalesFilter>('all')
  const [mode, setMode] = useState<ChartMode>('cumulative')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { points, ceiling, total, count, visibleCount } = buildSalesSeries(sales, filter, mode)
  const activePoint = points.find((point) => point.item.id === selectedId) ?? points[points.length - 1]
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x * 10},${point.y * 2.6}`).join(' ')
  const area = points.length ? `${path} L${points[points.length - 1].x * 10},228.8 L${points[0].x * 10},228.8 Z` : ''

  return (
    <section className="dc-sales" aria-labelledby="dc-sales-title">
      <div className="dc-section-heading">
        <div><span className="dc-eyebrow"><i /> 01 / PULSO COMERCIAL</span><h2 id="dc-sales-title">Tus ventas, en perspectiva.</h2></div>
        <span className="dc-section-icon"><ChartNoAxesCombined size={23} strokeWidth={1.5} /></span>
      </div>

      <div className="dc-chart-toolbar">
        <div className="dc-segments" role="group" aria-label="Filtrar ventas por estado">
          {filters.map((option) => <button key={option.value} type="button" aria-pressed={filter === option.value} onClick={() => { setFilter(option.value); setSelectedId(null) }}>{option.label}</button>)}
        </div>
        <label className="dc-chart-mode"><span className="dc-sr-only">Vista del gráfico</span><select value={mode} onChange={(event) => setMode(event.target.value as ChartMode)}><option value="cumulative">Acumulado</option><option value="individual">Por operación</option></select></label>
      </div>

      <div className="dc-chart-summary">
        <div><span>Valor de las ventas mostradas</span><strong key={`${filter}-${total}`}>{money(total)}</strong></div>
        <span className="dc-chart-scope">{visibleCount} de {count} registros<br /><b>{filter === 'all' ? 'Todos los estados' : filter === 'completed' ? 'Ventas completadas' : 'Pendientes y en curso'}</b></span>
      </div>

      {points.length ? (
        <>
          <div className="dc-chart" aria-label={`Gráfico de ventas ${mode === 'cumulative' ? 'acumuladas' : 'por operación'}, en soles`}>
            <div className="dc-chart-axis" aria-hidden="true">{[1, .75, .5, .25, 0].map((ratio) => <span key={ratio} style={{ top: `${8 + (1 - ratio) * 80}%` }}>{compactNumber(ceiling * ratio)}</span>)}</div>
            <div className="dc-plot">
              <svg viewBox="0 0 1000 260" preserveAspectRatio="none" aria-hidden="true">
                <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop className="dc-area-stop" stopOpacity=".25" /><stop offset="1" className="dc-area-stop" stopOpacity=".015" /></linearGradient></defs>
                {[8, 28, 48, 68, 88].map((y) => <line className="dc-grid-line" key={y} x1="0" x2="1000" y1={y * 2.6} y2={y * 2.6} />)}
                <path className="dc-chart-area" d={area} fill={`url(#${gradientId})`} />
                <path className="dc-chart-line" d={path} />
                {activePoint && <line className="dc-chart-guide" x1={activePoint.x * 10} x2={activePoint.x * 10} y1="15" y2="228.8" />}
              </svg>
              {points.map((point, index) => (
                <button key={point.item.id} className={`dc-chart-point${point.item.id === activePoint?.item.id ? ' is-active' : ''}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} type="button" aria-label={`${point.item.id}: ${money(point.value)}${mode === 'cumulative' ? ' acumulado' : ''}. ${point.item.name}`} aria-pressed={activePoint?.item.id === point.item.id} onMouseEnter={() => setSelectedId(point.item.id)} onFocus={() => setSelectedId(point.item.id)} onClick={() => setSelectedId(point.item.id)}>
                  <span />
                  {(points.length <= 6 || index % 2 === 0 || index === points.length - 1) && <small className="dc-point-label" style={{ top: `calc(${(96 - point.y) / 100} * var(--dc-chart-height) + 12px)` }}>{point.item.id}</small>}
                </button>
              ))}
            </div>
          </div>
          <div className="dc-chart-detail" aria-live="polite">
            <span className="dc-detail-marker" />
            <div><strong>{activePoint.item.name}</strong><small>{activePoint.item.id} · {activePoint.item.date}</small></div>
            <div className="dc-detail-amount"><strong>{money(recordAmount(activePoint.item))}</strong><small>{activePoint.item.status}</small></div>
            <button type="button" className="dc-icon-button" aria-label={`Abrir venta ${activePoint.item.id}`} onClick={() => onOpen(activePoint.item)}><ArrowUpRight size={18} /></button>
          </div>
          <p className="dc-chart-note"><MousePointer2 size={12} /> Explora cada punto · {count > 12 ? 'Últimas 12 ventas, en orden de registro.' : 'De la primera a la última venta registrada.'}</p>
        </>
      ) : (
        <div className="dc-empty-chart"><ChartNoAxesCombined size={38} strokeWidth={1.3} /><h3>{sales.length ? 'Todavía no hay ventas en este estado' : 'Tu próxima venta empieza aquí'}</h3><p>{sales.length ? 'Prueba otro filtro para explorar tus registros.' : 'Registra una operación para empezar a ver tu actividad.'}</p><button type="button" className="dc-text-action" onClick={sales.length ? () => setFilter('all') : onCreate}>{sales.length ? 'Ver todas las ventas' : 'Registrar venta'}<Plus size={15} /></button></div>
      )}
      <div className="dc-chart-foot"><span><i /> Ventas registradas · PEN</span><span>{mode === 'cumulative' ? 'Suma progresiva' : 'Importe individual'}</span></div>
    </section>
  )
}
