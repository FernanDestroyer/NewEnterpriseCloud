import { useState } from 'react'
import type { CompanyProfile } from '../services/company'
import type { SalesReceipt } from '../services/salesOperations'
import { useDialog } from './useDialog'
import '../sales-print.css'

const money = (value: number, currency: string) => new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(value)
const taxName = (code: string) => code === '10' ? 'Gravado' : code === '20' ? 'Exonerado' : 'Inafecto'

export function SalesReceiptPrint({ receipt, company, products, onClose }: {
  receipt: SalesReceipt
  company: CompanyProfile | null
  products: Array<{ id: string; nombre: string }>
  onClose: () => void
}) {
  const [format, setFormat] = useState<'a4' | 'ticket'>('a4')
  const dialog = useDialog<HTMLDivElement>(onClose)
  const lines = receipt.snapshot?.lineas ?? []
  const docName = receipt.tipo === '01' ? 'FACTURA' : 'BOLETA DE VENTA'
  const date = new Date(receipt.created_at).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' })
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div ref={dialog} className="voucher-modal sales-print-dialog" role="dialog" aria-modal="true" aria-label={`Vista previa de ${docName} ${receipt.serie}-${receipt.numero}`}>
      <div className="modal-heading sales-print-controls"><div><span className="ws-eyebrow">VENTAS · DOCUMENTO INTERNO</span><h2>{docName} {receipt.serie}-{receipt.numero}</h2><p>Vista previa de la operación registrada.</p></div></div>
      <div className="ws-heading-actions sales-print-controls"><label>Formato de papel<select value={format} onChange={event => setFormat(event.target.value as 'a4' | 'ticket')}><option value="a4">A4</option><option value="ticket">Ticket 80 mm</option></select></label><button type="button" className="ws-button" onClick={() => window.print()}>Imprimir / PDF</button><button type="button" className="ws-button ws-button-secondary" onClick={onClose}>Cerrar</button></div>
      <article className={`voucher-paper sales-print-paper sales-print-${format}`}>
        <header className="sales-print-header"><div><strong>{company?.razonSocial || 'EnterpriseCloud'}</strong><small>{company?.ruc ? `RUC ${company.ruc}` : 'RUC no configurado'}</small><small>{company?.direccion || 'Dirección fiscal no configurada'}</small></div><div className="sales-print-id"><strong>{docName}</strong><span>{receipt.serie}-{receipt.numero}</span><small>Fecha: {date}</small></div></header>
        <div className="sales-print-meta"><span><strong>Cliente:</strong> {receipt.snapshot?.cliente || 'Sin nombre registrado'}</span><span><strong>Moneda:</strong> {receipt.moneda}{receipt.moneda === 'USD' ? ` · TC ${receipt.tipo_cambio}` : ''}</span></div>
        <div className="table-scroll"><table className="voucher-table"><thead><tr><th>Cant.</th><th>Producto / afectación</th><th>Unitario</th><th>Importe</th></tr></thead><tbody>{lines.map((line, index) => <tr key={`${line.producto_id}-${index}`}><td>{line.cantidad}</td><td><strong>{products.find(item => item.id === line.producto_id)?.nombre || `Producto ${line.producto_id.slice(0, 8)}`}</strong><small>{taxName(line.afectacion)} · cód. {line.afectacion}</small></td><td>{money(Number(line.precio), receipt.moneda)}</td><td>{money(Number(line.total ?? line.precio * line.cantidad), receipt.moneda)}</td></tr>)}</tbody></table></div>
        <div className="voucher-totals"><div><span>Base / operaciones exoneradas e inafectas</span><span>{money(Number(receipt.base), receipt.moneda)}</span></div><div><span>IGV</span><span>{money(Number(receipt.igv), receipt.moneda)}</span></div><div className="grand"><span>Total</span><span>{money(Number(receipt.total), receipt.moneda)}</span></div></div>
        <p className="sales-print-disclaimer">Representación interna · Estado SUNAT: {receipt.estado_sunat}. Imprimir no constituye envío ni aceptación por SUNAT. El nombre del producto mostrado procede del catálogo actual; los importes y códigos tributarios proceden del snapshot del comprobante.</p>
      </article>
    </div>
  </div>
}
