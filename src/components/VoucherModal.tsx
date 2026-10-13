import { useEffect, useState } from 'react'
import { escapeCell, money, statusTone, totalWithIgv, brandLogoUrl } from '../data/helpers'
import { readCompanyProfile } from '../services/company'
import logoNegro from '../assets/enterprisecloud-logo-negro.png'
import { useDialog } from './useDialog'
import { useRecords } from '../context/RecordsContext'
import { fetchDocumentLines } from '../services/records'
import type { DocumentLine, RecordItem } from '../types'

/** Icono de Google (Material Symbols Outlined). */
function GoogleIcon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span className={`gicon${className ? ` ${className}` : ''}`} aria-hidden="true">
      {name}
    </span>
  )
}

/** Comprobante singular: 1 por cada venta o compra, con sus líneas e IGV, imprimible. */
export default function VoucherModal({ page, record, onClose }: { page: 'sales' | 'purchases'; record: RecordItem; onClose: () => void }) {
  const { records } = useRecords()
  const dialogRef = useDialog<HTMLDivElement>(onClose)
  const [lines, setLines] = useState<DocumentLine[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  useEffect(() => {
    let active = true
    setLoading(true)
    if (!record.rowId) {
      setLines([])
      setLoading(false)
      return
    }
    fetchDocumentLines(page, record.rowId)
      .then((rows) => active && setLines(rows))
      .catch(() => active && setLines([]))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [page, record.rowId])

  const isSale = page === 'sales'
  const supplier = !isSale && record.proveedor_id
    ? records.suppliers.find((item) => item.rowId === record.proveedor_id)
    : undefined
  const docMatch = isSale ? record.detail.match(/^(Factura|Boleta|Cotización|Nota de venta)\b/) : null
  const docTitle = isSale ? (docMatch ? docMatch[1].toUpperCase() : 'COMPROBANTE') : 'ORDEN DE COMPRA'
  const docNumber = isSale ? record.detail : `N.° ${record.id}`
  const counterLabel = isSale ? 'Cliente' : 'Proveedor'
  const counterName = isSale ? record.name : (supplier?.name ?? record.name)
  const counterCode = isSale
    ? record.relatedCode ?? ''
    : `${supplier?.id ?? ''}${supplier?.ruc ? ` · RUC ${supplier.ruc}` : ''}`.trim()

  const subtotal = lines.length
    ? lines.reduce((sum, line) => sum + line.cantidad * line.precio, 0)
    : (record.amount ?? 0)
  const discount = record.descuento ?? 0
  const netSubtotal = discount > 0 ? Math.round(subtotal * (1 - discount / 100) * 100) / 100 : subtotal
  const total = isSale ? netSubtotal : totalWithIgv(subtotal)
  const base = isSale ? Math.round(total / 1.18 * 100) / 100 : subtotal
  const igv = Math.round((total - base) * 100) / 100
  const company = readCompanyProfile(records.settings)
  const emitterName = company?.razonSocial || 'EnterpriseCloud'
  const emitterDetail = company?.ruc ? `RUC ${company.ruc}${company.direccion ? ` · ${company.direccion}` : ''}` : 'Sistema ERP · Comprobantes'

  const print = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return
    // Logo incrustado (data URI) para que salga sí o sí en la impresión.
    void brandLogoUrl().then((logoUrl) => {
    const rows = lines.length
      ? lines.map((line) => `<tr><td>${line.cantidad}</td><td>${escapeCell(line.nombre ?? line.producto_id)}<br><small>${escapeCell(line.codigo ?? '')}</small></td><td>${money(line.precio)}</td><td>${money(line.cantidad * line.precio)}</td></tr>`).join('')
      : `<tr><td>1</td><td>${escapeCell(record.name)}<br><small>${escapeCell(record.detail)}</small></td><td>${money(record.amount ?? 0)}</td><td>${money(record.amount ?? 0)}</td></tr>`
    printWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeCell(docTitle)} ${escapeCell(docNumber)} · EnterpriseCloud</title>`
      + `<style>body{font-family:Arial,sans-serif;color:#111;margin:0;padding:24px}h1{font-size:22px;margin:0}p{margin:4px 0;font-size:12px}.head{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid #111;padding-bottom:12px;margin-bottom:14px}.brand{display:flex;align-items:center;gap:12px}.logo{height:100px;width:auto}.doc{border:2px solid #111;padding:10px 14px;text-align:center}.doc strong{font-size:18px}.meta{display:grid;gap:2px;margin-bottom:14px}.meta small{color:#555}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:8px;border:1px solid #999;text-align:left}th{background:#eee}td:nth-child(1),td:nth-child(3),td:nth-child(4){text-align:right}.totals{margin-left:auto;width:240px;margin-top:12px}.totals div{display:flex;justify-content:space-between;padding:4px 0;font-size:12px}.totals .grand{font-size:15px;font-weight:bold;border-top:2px solid #111;margin-top:4px;padding-top:8px}.foot{margin-top:18px;color:#555;font-size:10px}</style></head><body>`
      + `<div class="head"><div class="brand"><img class="logo" src="${logoUrl}" alt="Logotipo de EnterpriseCloud"><div><h1>${escapeCell(emitterName)}</h1><p>${escapeCell(emitterDetail)}</p></div></div><div class="doc"><strong>${escapeCell(docTitle)}</strong><p>${escapeCell(docNumber)}</p><p>${escapeCell(record.date)} · ${escapeCell(record.status)}</p></div></div>`
      + `<div class="meta"><p><strong>${counterLabel}:</strong> ${escapeCell(counterName)}${counterCode ? ` · ${escapeCell(counterCode)}` : ''}</p>`
      + (!isSale ? `<p><strong>Fase:</strong> ${escapeCell(record.status)}${record.fechaLimite ? ` · <strong>Límite:</strong> ${escapeCell(record.fechaLimite)}` : ''}${record.comprobanteTipo ? ` · <strong>Recepción:</strong> ${escapeCell(record.comprobanteTipo)}${record.comprobanteNumero ? ` ${escapeCell(record.comprobanteNumero)}` : ''}` : ''}</p>` : '')
      + `</div>`
      + `<table><thead><tr><th>Cant.</th><th>Descripción</th><th>P. unit.</th><th>Importe</th></tr></thead><tbody>${rows}</tbody></table>`
      + `<div class="totals"><div><span>Base imponible</span><span>${money(base)}</span></div>${discount > 0 ? `<div><span>Descuento ${discount}%</span><span>-${money(subtotal - netSubtotal)}</span></div>` : ''}<div><span>IGV 18%</span><span>${money(igv)}</span></div><div class="grand"><span>Total</span><span>${money(total)}</span></div></div>`
      + `<p class="foot">Documento generado desde EnterpriseCloud · ${lines.length} ${lines.length === 1 ? 'línea' : 'líneas'}.</p>`
      + `<script>window.onload=function(){var logo=document.querySelector('img.logo');var done=false;function print(){if(done)return;done=true;window.print()}if(logo&&!logo.complete){logo.onload=print;logo.onerror=print;setTimeout(print,2000)}else{print()}}<\/script></body></html>`)
    printWindow.document.close()
    })
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} className="voucher-modal" role="dialog" aria-modal="true" aria-label={`${docTitle} ${docNumber}`}>
        <div className="modal-heading">
          <div><span className="section-kicker"><i /> COMPROBANTE SINGULAR</span><h2>{docTitle}</h2><p>{docNumber}</p></div>
          <button className="modal-close" type="button" aria-label="Cerrar" onClick={onClose}><GoogleIcon name="close" /></button>
        </div>
        <div className="voucher-paper">
          <div className="voucher-head">
            <div className="voucher-brand">
              <img className="voucher-logo" src={logoNegro} alt="Logotipo de EnterpriseCloud" />
              <div><strong>{emitterName}</strong><small>{emitterDetail}</small></div>
            </div>
            <div className="voucher-doc"><strong>{docTitle}</strong><span>{docNumber}</span><small>{record.date} · {record.status}</small></div>
          </div>
          <div className="voucher-meta">
            <p><strong>{counterLabel}:</strong> {counterName}{counterCode ? ` · ${counterCode}` : ''}</p>
            {!isSale && <p><strong>Fase:</strong> {record.status}{record.fechaLimite ? ` · Límite: ${record.fechaLimite}` : ''}{record.comprobanteTipo ? ` · Recepción: ${record.comprobanteTipo}${record.comprobanteNumero ? ` ${record.comprobanteNumero}` : ''}` : ''}</p>}
          </div>
          {loading ? (
            <p className="relation-hint"><GoogleIcon name="progress_activity" className="small login-spin" /> Cargando líneas…</p>
          ) : lines.length ? (
            <table className="voucher-table">
              <thead><tr><th>Cant.</th><th>Descripción</th><th>P. unit.</th><th>Importe</th></tr></thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.producto_id}>
                    <td>{line.cantidad}</td>
                    <td><strong>{line.nombre ?? line.producto_id}</strong><small>{line.codigo ?? ''}</small></td>
                    <td>{money(line.precio)}</td>
                    <td>{money(line.cantidad * line.precio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="voucher-table">
              <thead><tr><th>Cant.</th><th>Descripción</th><th>P. unit.</th><th>Importe</th></tr></thead>
              <tbody><tr><td>1</td><td><strong>{record.name}</strong><small>{record.detail}</small></td><td>{money(record.amount ?? 0)}</td><td>{money(record.amount ?? 0)}</td></tr></tbody>
            </table>
          )}
          <div className="voucher-totals">
            <div><span>Base imponible</span><span>{money(base)}</span></div>
            {discount > 0 && <div><span>Descuento {discount}%</span><span>−{money(subtotal - netSubtotal)}</span></div>}
            <div><span>IGV 18%</span><span>{money(igv)}</span></div>
            <div className="grand"><span>Total</span><span>{money(total)}</span></div>
          </div>
          <p className="voucher-foot">Documento generado desde EnterpriseCloud · <span className={`status-pill ${statusTone(record.status)}`}>{record.status}</span></p>
        </div>
        <div className="modal-actions">
          <button className="cancel-button" type="button" onClick={onClose}>Cerrar</button>
          <button className="primary-button" type="button" disabled={loading} onClick={print}><GoogleIcon name="print" /> Imprimir / PDF</button>
        </div>
      </div>
    </div>
  )
}
