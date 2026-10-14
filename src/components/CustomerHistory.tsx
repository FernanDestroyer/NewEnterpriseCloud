import { money, statusTone } from '../data/helpers'
import { customerCredit, displayDate } from '../data/workspace'
import { useRecords } from '../context/RecordsContext'
import { useDialog } from './useDialog'
import type { RecordItem } from '../types'

/** Icono de Google (Material Symbols Outlined). */
function GoogleIcon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span className={`gicon${className ? ` ${className}` : ''}`} aria-hidden="true">
      {name}
    </span>
  )
}

/** Historial de compras del cliente: ventas vinculadas, descuento aplicado y deuda. */
export default function CustomerHistory({ customer, onClose }: { customer: RecordItem; onClose: () => void }) {
  const { records } = useRecords()
  const dialogRef = useDialog<HTMLDivElement>(onClose)
  const credit = customerCredit(customer, records.sales, records.finance)
  const cxcBySale = new Map(
    records.finance
      .filter((item) => item.saleId)
      .map((item) => [item.saleId as string, item]),
  )

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} className="ws-dialog" role="dialog" aria-modal="true" aria-label={`Historial de ${customer.name}`}>
        <div className="modal-heading">
          <div>
            <span className="section-kicker"><i /> CLIENTES / HISTORIAL</span>
            <h2>{customer.name}</h2>
            <p>{customer.id}{customer.documento ? ` · ${customer.tipoDoc ?? 'DOC'} ${customer.documento}` : ' · Sin documento'}</p>
          </div>
          <button className="modal-close" type="button" aria-label="Cerrar historial" onClick={onClose}><GoogleIcon name="close" /></button>
        </div>
        <div className="ws-form">
          <div className="ws-import-summary">
            <span className="ws-badge green">{credit.compras.length} {credit.compras.length === 1 ? 'compra' : 'compras'}</span>
            <span className="ws-import-products">Total {money(credit.totalComprado)}</span>
            {credit.descuentoOtorgado > 0 && <span className="ws-import-products">Descuento {money(credit.descuentoOtorgado)}</span>}
          </div>
          <div className="ws-summary-list">
            <div><small>Línea de crédito (tarjeta)</small><strong>{credit.hasLimit ? money(credit.linea) : 'Sin tope'}</strong></div>
            <div><small>Consumido con tarjeta</small><strong>{money(credit.consumidoTarjeta)}</strong></div>
            <div><small>Disponible</small><strong>{credit.hasLimit ? money(credit.disponible) : 'Sin tope'}</strong></div>
            <div><small>Deuda abierta (CxC)</small><strong>{money(credit.deuda)}</strong></div>
            <div><small>Última compra</small><strong>{credit.ultimaCompra ? displayDate(credit.ultimaCompra) : '—'}</strong></div>
          </div>
          {!credit.hasLimit && (
            <p className="relation-hint"><GoogleIcon name="info" className="small" />Sin línea de crédito registrada: sus compras con tarjeta no tienen tope.</p>
          )}
          <p className="relation-hint"><GoogleIcon name="payments" className="small" />Solo lo pagado con Tarjeta descuenta de la línea. Efectivo/Yape se registra sin descontar.</p>
          {credit.compras.length ? (
            <div className="table-scroll"><table className="record-table">
              <thead><tr><th>Referencia</th><th>Fecha</th><th>Comprobante</th><th>Medio</th><th className="ws-align-right">Desc.</th><th className="ws-align-right">Monto</th><th>Venta</th><th>CxC</th></tr></thead>
              <tbody>
                {credit.compras.map((sale) => {
                  const cxc = sale.rowId ? cxcBySale.get(sale.rowId) : undefined
                  return (
                    <tr key={sale.id}>
                      <td><span className="record-id">{sale.id}</span></td>
                      <td className="record-date">{displayDate(sale.createdAt)}</td>
                      <td><small>{sale.detail || '—'}</small></td>
                      <td>{sale.medio ? <span className="linked-badge">{sale.medio}</span> : '—'}</td>
                      <td className="ws-align-right">{sale.descuento ? `${sale.descuento}%` : '—'}</td>
                      <td className="ws-align-right">{money(sale.amount ?? 0)}</td>
                      <td><span className={`status-pill ${statusTone(sale.status)}`}>{sale.status}</span></td>
                      <td>{cxc ? <span className={`status-pill ${statusTone(cxc.status)}`}>{cxc.status}</span> : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table></div>
          ) : (
            <p className="relation-hint"><GoogleIcon name="search_off" className="small" />Aún no tiene compras vinculadas. Vincúlalo al crear la venta para verlas aquí.</p>
          )}
          <div className="ws-heading-actions">
            <button className="ws-button ws-button-secondary" type="button" onClick={onClose}>Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
