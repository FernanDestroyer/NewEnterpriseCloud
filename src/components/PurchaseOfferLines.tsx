import { useState } from 'react'
import { History } from 'lucide-react'
import { SegmentedControl } from './ui/SegmentedControl'
import { moneyCurrency } from '../data/helpers'
import type { SourcingRequest } from '../services/purchaseSourcing'

/** Preview uses the same rounded quantities, bases and tax amounts as the comparison. */
export default function PurchaseOfferLines({ request, currency, supplierId }: { request: SourcingRequest; currency: 'PEN' | 'USD'; supplierId: string }) {
  const [draft, setDraft] = useState<Record<string, { price: string; treatment: string }>>({})
  const [history, setHistory] = useState<string | null>(null)
  const [terms, setTerms] = useState('')
  const penny = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
  let total = 0
  return <div className="sourcing-wide ec-offer-lines">
    {request.solicitud_compra_lineas.map(line => {
      const value = draft[line.id] ?? { price: '0', treatment: 'Gravado' }
      const base = penny(Math.ceil(Number(line.cantidad)) * penny(Number(value.price)))
      const tax = penny(base * (value.treatment === 'Gravado' ? 18 : 0) / 100)
      total += base + tax
      const previous = request.ofertas_compra.filter(offer => offer.proveedor_id === supplierId).sort((a, b) => b.version - a.version)
      return <div className="ec-offer-line" key={line.id}>
        <div><strong>{line.descripcion}</strong><small>{line.cantidad} {line.unidad} · Orden: {Math.ceil(Number(line.cantidad))}</small></div>
        <label>Costo unitario · {currency}<input className="ws-control" name={`precio_${line.id}`} required type="number" min="0" step="0.0001" value={value.price} onChange={event => setDraft(current => ({ ...current, [line.id]: { ...value, price: event.target.value } }))} /></label>
        <div><small>Tributación</small><SegmentedControl name={`tratamiento_${line.id}`} ariaLabel={`Tributación de ${line.descripcion}`} value={value.treatment} onChange={treatment => setDraft(current => ({ ...current, [line.id]: { ...value, treatment } }))} options={[{ value: 'Gravado', label: 'IGV 18%' }, { value: 'Exonerado', label: 'Exonerado 0%' }, { value: 'Inafecto', label: 'Inafecto 0%' }]} /></div>
        <div className="ec-purchase-number"><small>Base {moneyCurrency(base, currency)} · IGV {moneyCurrency(tax, currency)}</small><strong>{moneyCurrency(base + tax, currency)}</strong></div>
        <button className="ws-icon-button" type="button" aria-label={`Consultar costos anteriores de ${line.descripcion}`} aria-expanded={history === line.id} onClick={() => setHistory(history === line.id ? null : line.id)}><History size={16} /></button>
        {history === line.id && <div className="sourcing-wide ec-cost-history">{previous.length ? previous.map(offer => { const price = offer.detalle_ofertas_compra.find(item => item.solicitud_linea_id === line.id); return <small key={offer.id}>Versión {offer.version} · {price ? moneyCurrency(Number(price.precio_unitario), offer.moneda) : 'Sin precio'} · {offer.estado}</small> }) : <small>No hay costos anteriores de este proveedor en esta solicitud.</small>}</div>}
      </div>
    })}
    <div className="ec-offer-total" aria-live="polite"><span>Total de oferta con impuestos</span><strong>{moneyCurrency(total, currency)}</strong></div>
    <div><small>Condición de pago</small><SegmentedControl ariaLabel="Condición de pago de la oferta" value={terms} onChange={setTerms} options={['Contado', 'Crédito 15 días', 'Crédito 30 días', 'Crédito 60 días'].map(value => ({ value, label: value }))} /></div>
    <label>Condiciones informadas por el proveedor<textarea className="ws-control" name="condiciones" rows={2} maxLength={1000} value={terms} onChange={event => setTerms(event.target.value)} placeholder="Condiciones de pago y otras observaciones" /></label>
  </div>
}
