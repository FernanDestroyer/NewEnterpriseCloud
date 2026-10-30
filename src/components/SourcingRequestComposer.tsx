import { useEffect, useRef, useState, type FormEvent } from 'react'
import { fetchMeasurementUnits, type MeasurementUnit } from '../services/records'
import { createPurchaseRequest, editPurchaseRequest, type SourcingRequest } from '../services/purchaseSourcing'
import type { RecordItem } from '../types'

type DraftLine = { producto_id: string; unidad_medida_id: string; descripcion: string; cantidad: string }
const key = () => globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
// TODO: Quitar mock de unidad simulada al integrar con Maestros.
const MOCK_MEASUREMENT_UNIT: MeasurementUnit = {
  id: '99999999-9999-9999-9999-999999999999',
  codigo: 'UND-PRUEBA',
  nombre: 'Unidad Simulada (Prueba)',
  simbolo: 'UND',
  precisionDecimales: 3,
  activo: true,
}

export default function SourcingRequestComposer({
  request, products, onClose, onSaved, notify,
}: {
  request: SourcingRequest | null
  products: RecordItem[]
  onClose: () => void
  onSaved: () => void
  notify: (message: string) => void
}) {
  const [units, setUnits] = useState<MeasurementUnit[]>([])
  const [unitError, setUnitError] = useState('')
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState(request?.detalle ?? '')
  const [date, setDate] = useState(request?.fecha_necesidad ?? '')
  const [lines, setLines] = useState<DraftLine[]>(request?.solicitud_compra_lineas.map(line => ({
    producto_id: line.producto_id ?? '',
    unidad_medida_id: line.unidad_medida_id ?? '',
    descripcion: line.descripcion,
    cantidad: String(line.cantidad),
  })) ?? [{ producto_id: '', unidad_medida_id: '', descripcion: '', cantidad: '1' }])
  const requestKey = useRef(key())
  const requestFingerprint = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    fetchMeasurementUnits().then(data => active && setUnits([...data.filter(unit => unit.activo), MOCK_MEASUREMENT_UNIT]))
      .catch(error => active && setUnitError(error instanceof Error ? error.message : 'No se pudieron cargar las unidades maestras.'))
    return () => { active = false }
  }, [])

  const updateLine = (index: number, patch: Partial<DraftLine>) => setLines(current => current.map((line, i) => i === index ? { ...line, ...patch } : line))
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const validLines = lines.filter(line => line.descripcion.trim())
    if (!validLines.length || validLines.some(line => {
      const decimalPlaces = line.cantidad.trim().split('.')[1]?.length ?? 0
      const quantity = Number(line.cantidad)
      return !line.unidad_medida_id || !Number.isFinite(quantity) || quantity <= 0 || quantity > 99999999999.999 || decimalPlaces > 3
    })) {
      notify('Cada línea requiere una unidad maestra y una cantidad válida de hasta 3 decimales.')
      return
    }
    const linkedProducts = validLines.map(line => line.producto_id).filter(Boolean)
    if (new Set(linkedProducts).size !== linkedProducts.length) {
      notify('Un producto maestro no puede repetirse en dos líneas. Usa una sola línea por producto.')
      return
    }
    setBusy(true)
    try {
      const payload = {
        detalle: detail.trim(),
        fechaNecesidad: date || null,
        lineas: validLines.map(line => ({
          producto_id: line.producto_id || null,
          unidad_medida_id: line.unidad_medida_id,
          descripcion: line.descripcion.trim(),
          cantidad: Number(line.cantidad),
        })),
      }
      const fingerprint = JSON.stringify(payload)
      if (requestFingerprint.current !== fingerprint) {
        requestKey.current = key()
        requestFingerprint.current = fingerprint
      }
      if (request) {
        await editPurchaseRequest({ solicitudId: request.id, expectedVersion: request.version, ...payload, idempotencyKey: requestKey.current })
        notify(`Borrador actualizado a versión ${request.version + 1}.`)
      } else {
        await createPurchaseRequest({ ...payload, idempotencyKey: requestKey.current })
        notify('Solicitud guardada como borrador.')
      }
      await onSaved()
    } catch (error) {
      const message = (error as { message?: string } | null)?.message ?? 'No se pudo guardar la solicitud.'
      notify(message)
    } finally { setBusy(false) }
  }

  return <section className="ws-card sourcing-form">
    <div className="ws-card-heading"><div><h2>{request ? `Editar borrador ${request.codigo} · v${request.version}` : 'Nueva solicitud interna'}</h2><p>{request ? 'Solo se puede editar la versión vigente mientras no haya ofertas.' : 'Se guardará como borrador; ábrela cuando esté lista para cotizar.'}</p></div></div>
    {unitError && <div className="ws-notice ws-notice-warning" role="alert">{unitError}</div>}
    <form onSubmit={submit} className="sourcing-form-body">
      <label>Fecha de necesidad<input name="fecha_necesidad" className="ws-control" type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
      <label className="sourcing-wide">Justificación / detalle<textarea name="detalle" className="ws-control" rows={2} maxLength={1000} value={detail} onChange={event => setDetail(event.target.value)} placeholder="Área solicitante, uso o especificaciones" /></label>
      <div className="sourcing-wide">
        <div className="ws-section-heading"><div><h2>Artículos requeridos</h2><p>Vincula bienes al producto y unidad maestra; para servicios el producto queda sin asociar.</p></div></div>
        {!units.length && !unitError && <div className="ws-notice ws-notice-warning" role="status">No hay unidades de medida activas. Configura al menos una en Maestros → Catálogo de productos → Unidades de medida. También los servicios o especificaciones libres necesitan una unidad para poder guardar la solicitud.</div>}
        {units.length > 0 && !products.some(item => item.rowId && item.unidadMedidaId) && <div className="ws-notice ws-notice-info" role="note">No hay productos de inventario vinculados a una unidad maestra; puedes describir el bien o servicio manualmente.</div>}
        {lines.map((line, index) => {
          const product = products.find(item => item.rowId === line.producto_id)
          const productUnits = line.producto_id ? units.filter(unit => unit.id === product?.unidadMedidaId) : units
          return <div className="sourcing-line" key={index}>
            <select className="ws-control" aria-label={`Producto maestro de línea ${index + 1}`} value={line.producto_id} onChange={event => {
              const selected = products.find(item => item.rowId === event.target.value)
              updateLine(index, { producto_id: event.target.value, unidad_medida_id: selected?.unidadMedidaId ?? '', descripcion: line.descripcion || selected?.name || '' })
            }}>
              <option value="">Servicio / especificación libre</option>
              {products.filter(item => item.rowId && item.unidadMedidaId).map(item => {
                const usedByOtherLine = lines.some((other, otherIndex) => otherIndex !== index && other.producto_id === item.rowId)
                return <option key={item.rowId} value={item.rowId} disabled={usedByOtherLine}>{item.id} · {item.name}{usedByOtherLine ? ' · ya agregado' : ''}</option>
              })}
            </select>
            <input className="ws-control" required maxLength={240} aria-label={`Descripción de línea ${index + 1}`} placeholder="Descripción del bien o servicio" value={line.descripcion} onChange={event => updateLine(index, { descripcion: event.target.value })} />
            <input className="ws-control" required type="number" min="0.001" step="0.001" aria-label={`Cantidad de línea ${index + 1}`} value={line.cantidad} onChange={event => updateLine(index, { cantidad: event.target.value })} />
            <select className="ws-control" required aria-label={`Unidad maestra de línea ${index + 1}`} value={line.unidad_medida_id} disabled={Boolean(line.producto_id)} onChange={event => updateLine(index, { unidad_medida_id: event.target.value })}>
              <option value="">Seleccionar unidad</option>{productUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.nombre} ({unit.simbolo})</option>)}
            </select>
            {!line.producto_id && <small className="sourcing-wide">Unidad solicitada: {units.find(unit => unit.id === line.unidad_medida_id)?.simbolo ?? 'pendiente'}</small>}
            {lines.length > 1 && <button type="button" className="ws-icon-button" aria-label="Quitar línea" onClick={() => setLines(current => current.filter((_, i) => i !== index))}>×</button>}
          </div>
        })}
        <button type="button" className="ws-text-button" onClick={() => setLines(current => [...current, { producto_id: '', unidad_medida_id: '', descripcion: '', cantidad: '1' }])}>+ Agregar línea</button>
      </div>
      <div className="sourcing-wide sourcing-form-foot"><small>El servidor valida producto/unidad, versión esperada y permisos dentro de una transacción.</small><button type="button" className="ws-button ws-button-secondary" onClick={onClose} disabled={busy}>Cerrar</button><button className="ws-button" type="submit" disabled={busy || !units.length}>{busy ? 'Guardando…' : request ? 'Guardar versión' : 'Guardar borrador'}</button></div>
    </form>
  </section>
}
