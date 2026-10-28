import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { Building2, Clock3, MapPinned, PackageCheck, Plus, RefreshCw, Save, Search, Users } from 'lucide-react'
import { fetchInventoryOpening, fetchLegacyStockProducts, fetchOrganizationSetup, fetchZoneAssignmentData, registerInventoryOpening, saveBranch, saveWarehouse, saveZone, setZoneBranchAssignment, setZoneCustomerAssignment, type Branch, type InventoryOpening, type LegacyStockProduct, type OrganizationSetup, type Warehouse, type Zone, type ZoneAssignmentData } from '../services/organization'
import { friendlyError } from '../services/records'

type Tab = 'estructura' | 'comercial' | 'reparto'

export default function OrganizationSetup({ canInitializeStock, canManageOrganization, canViewCustomers, onChanged }: { canInitializeStock: boolean; canManageOrganization: boolean; canViewCustomers: boolean; onChanged: () => Promise<void> }) {
  const location = useLocation()
  const [data, setData] = useState<OrganizationSetup | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState(false)
  const [openingLoading, setOpeningLoading] = useState(false)
  const [openingProducts, setOpeningProducts] = useState<LegacyStockProduct[]>([])
  const [inventoryOpening, setInventoryOpening] = useState<InventoryOpening | null>(null)
  const [allocations, setAllocations] = useState<Record<string, Record<string, string>>>({})
  const [openingKey, setOpeningKey] = useState(() => `apertura:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`}`)
  const [message, setMessage] = useState('')
  const [tab, setTab] = useState<Tab>('estructura')
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null)
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null)
  const [editingZone, setEditingZone] = useState<Zone | null>(null)
  const [selectedZoneId, setSelectedZoneId] = useState('')
  const [assignmentData, setAssignmentData] = useState<ZoneAssignmentData | null>(null)
  const [assignmentLoading, setAssignmentLoading] = useState(false)
  const [assignmentBusy, setAssignmentBusy] = useState(false)
  const [assignmentMessage, setAssignmentMessage] = useState('')
  const [assignmentQuery, setAssignmentQuery] = useState('')

  const load = async () => {
    setLoading(true)
    setMessage('')
    try {
      const setup = await fetchOrganizationSetup()
      setData(setup)
      if (canInitializeStock) {
        setOpeningLoading(true)
        const [products, openingState] = await Promise.all([fetchLegacyStockProducts(), fetchInventoryOpening()])
        setOpeningProducts(products)
        setInventoryOpening(openingState)
        setAllocations(Object.fromEntries(products.map(product => [
          product.id,
          Object.fromEntries(setup.almacenes.filter(item => item.activo).map(warehouse => [warehouse.id, ''])),
        ])))
        setOpeningKey(`apertura:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`}`)
        setOpeningLoading(false)
      }
    } catch (error) {
      setMessage(friendlyError(error))
    } finally {
      setOpeningLoading(false)
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  useEffect(() => {
    if (location.hash === '#zonas-comerciales') setTab('comercial')
    if (location.hash === '#zonas-reparto') setTab('reparto')
    if (location.hash === '#organizacion') setTab('estructura')
  }, [location.hash])

  const activeWarehouses = useMemo(() => data?.almacenes.filter(item => item.activo) ?? [], [data])
  const zones = useMemo(() => (data?.zonas ?? []).filter(zone => zone.tipo === (tab === 'comercial' ? 'comercial' : 'reparto')), [data, tab])
  const selectedZone = zones.find(zone => zone.id === selectedZoneId) ?? null
  const assignedByProduct = useMemo(() => Object.fromEntries(openingProducts.map(product => [
    product.id,
    activeWarehouses.reduce((sum, warehouse) => sum + (Number(allocations[product.id]?.[warehouse.id] ?? '') || 0), 0),
  ])), [openingProducts, activeWarehouses, allocations])

  useEffect(() => {
    if (selectedZoneId && zones.some(zone => zone.id === selectedZoneId)) return
    setSelectedZoneId(zones[0]?.id ?? '')
  }, [selectedZoneId, zones])

  useEffect(() => {
    if (!selectedZoneId) {
      setAssignmentData(null)
      setAssignmentLoading(false)
      return
    }
    let current = true
    setAssignmentLoading(true)
    setAssignmentMessage('')
    void fetchZoneAssignmentData(selectedZoneId, canViewCustomers)
      .then(result => { if (current) setAssignmentData(result) })
      .catch(error => { if (current) { setAssignmentData(null); setAssignmentMessage(friendlyError(error)) } })
      .finally(() => { if (current) setAssignmentLoading(false) })
    return () => { current = false }
  }, [selectedZoneId, canViewCustomers])

  const updateAssignment = async (kind: 'cliente' | 'sucursal', entityId: string, assigned: boolean) => {
    if (!canManageOrganization || assignmentBusy || !selectedZoneId) return
    if (kind === 'cliente' && !canViewCustomers) return
    setAssignmentBusy(true)
    setAssignmentMessage('')
    try {
      if (kind === 'cliente') await setZoneCustomerAssignment(selectedZoneId, entityId, assigned)
      else await setZoneBranchAssignment(selectedZoneId, entityId, assigned)
      setAssignmentData(await fetchZoneAssignmentData(selectedZoneId, canViewCustomers))
      setAssignmentMessage('Asignación guardada.')
    } catch (error) {
      setAssignmentMessage(friendlyError(error))
    } finally {
      setAssignmentBusy(false)
    }
  }

  const filteredCustomers = useMemo(() => assignmentData?.clientes.filter(customer =>
    `${customer.codigo} ${customer.razon_social} ${customer.detalle}`.toLocaleLowerCase('es').includes(assignmentQuery.toLocaleLowerCase('es')),
  ) ?? [], [assignmentData, assignmentQuery])
  const filteredBranches = useMemo(() => assignmentData?.sucursales.filter(branch =>
    `${branch.codigo} ${branch.nombre} ${branch.direccion ?? ''}`.toLocaleLowerCase('es').includes(assignmentQuery.toLocaleLowerCase('es')),
  ) ?? [], [assignmentData, assignmentQuery])

  const submit = async (event: FormEvent<HTMLFormElement>, kind: 'branch' | 'warehouse' | 'zone') => {
    event.preventDefault()
    if (!canManageOrganization) {
      setMessage('No tienes permiso para modificar la estructura organizacional.')
      return
    }
    if (!data || busy) return
    const values = new FormData(event.currentTarget)
    setBusy(true)
    setMessage('')
    try {
      if (kind === 'branch') {
        if (!data.empresa) throw new Error('Primero completa la ficha de la empresa principal.')
        await saveBranch({
          empresa_id: data.empresa.id,
          codigo: String(values.get('codigo') ?? ''),
          nombre: String(values.get('nombre') ?? ''),
          proposito: String(values.get('proposito') ?? ''),
          direccion: String(values.get('direccion') ?? ''),
          telefono: String(values.get('telefono') ?? ''),
          hora_apertura: String(values.get('hora_apertura') ?? ''),
          hora_cierre: String(values.get('hora_cierre') ?? ''),
          zona_horaria: String(values.get('zona_horaria') ?? 'America/Lima'),
          estado: String(values.get('estado') ?? 'Activo'),
        }, editingBranch?.id)
        setEditingBranch(null)
      } else if (kind === 'warehouse') {
        await saveWarehouse({
          sucursal_id: String(values.get('sucursal_id') ?? ''),
          nombre: String(values.get('nombre') ?? ''),
          ubicacion: String(values.get('ubicacion') ?? ''),
          responsable: String(values.get('responsable') ?? ''),
          proposito: String(values.get('proposito') ?? ''),
          hora_apertura: String(values.get('hora_apertura') ?? ''),
          hora_cierre: String(values.get('hora_cierre') ?? ''),
          zona_horaria: String(values.get('zona_horaria') ?? 'America/Lima'),
          activo: String(values.get('activo') ?? 'true') === 'true',
        }, editingWarehouse?.id)
        setEditingWarehouse(null)
      } else {
        await saveZone({
          codigo: String(values.get('codigo') ?? ''),
          nombre: String(values.get('nombre') ?? ''),
          tipo: tab === 'comercial' ? 'comercial' : 'reparto',
          proposito: String(values.get('proposito') ?? ''),
          descripcion: String(values.get('descripcion') ?? ''),
          estado: String(values.get('estado') ?? 'Activo'),
        }, editingZone?.id)
        setEditingZone(null)
      }
      await load()
    } catch (error) {
      setMessage(friendlyError(error))
    } finally {
      setBusy(false)
    }
  }

  const registerOpening = async () => {
    if (opening || inventoryOpening || openingLoading) return
    if (!activeWarehouses.length || !openingProducts.length) {
      setMessage(!activeWarehouses.length ? 'Crea y activa un almacén antes de abrir existencias.' : 'Registra productos antes de abrir existencias.')
      return
    }
    const allocationLines: Array<{ producto_id: string; almacen_id: string; cantidad: number }> = []
    for (const product of openingProducts) {
      let assigned = 0
      for (const warehouse of activeWarehouses) {
        const raw = allocations[product.id]?.[warehouse.id] ?? ''
        const quantity = raw === '' ? 0 : Number(raw)
        if (!Number.isInteger(quantity) || quantity < 0) {
          setMessage(`La cantidad asignada a ${product.codigo} debe ser un entero igual o mayor que cero.`)
          return
        }
        assigned += quantity
        if (quantity > 0) allocationLines.push({ producto_id: product.id, almacen_id: warehouse.id, cantidad: quantity })
      }
      if (assigned !== product.stock) {
        setMessage(`${product.codigo}: asignaste ${assigned}; el stock legado es ${product.stock}. La suma por almacenes debe coincidir exactamente.`)
        return
      }
    }
    const totalUnits = openingProducts.reduce((sum, product) => sum + product.stock, 0)
    const confirmed = window.confirm(`Se registrarán ${allocationLines.length} asignaciones para distribuir ${totalUnits} unidades de stock legado entre ${activeWarehouses.length} almacenes. Verifica que la distribución coincida con las existencias físicas. La apertura es única; los 16 movimientos históricos se conservarán.`)
    if (!confirmed) return
    setOpening(true)
    setMessage('')
    try {
      await registerInventoryOpening(allocationLines, openingKey)
      await onChanged()
      await load()
      setMessage('Apertura registrada. Las existencias quedaron distribuidas en el Kardex por almacén y los movimientos históricos se conservaron.')
    } catch (error) {
      setMessage(friendlyError(error))
    } finally {
      setOpening(false)
    }
  }

  if (loading) return <div className="ws-empty-compact"><RefreshCw size={18} className="ws-spin" /> Cargando estructura organizacional…</div>

  return <div className="ws-organization-setup">
    {message && <div className="ws-notice ws-notice-warning" role="status">{message}</div>}
    {!canManageOrganization && <div className="ws-notice" role="status">Vista de solo lectura. Se requiere permiso de configuración para crear, editar o asignar zonas.</div>}
    {!data?.empresa && <div className="ws-notice ws-notice-warning" role="status">Configura primero la ficha de empresa principal para poder crear sucursales.</div>}
    <div className="ws-tabs" role="tablist" aria-label="Organización y zonas">
      <button type="button" role="tab" aria-selected={tab === 'estructura'} onClick={() => setTab('estructura')}>Sucursales y almacenes</button>
      <button id="zonas-comerciales" type="button" role="tab" aria-selected={tab === 'comercial'} onClick={() => { setTab('comercial'); setEditingZone(null) }}>Zonas comerciales</button>
      <button id="zonas-reparto" type="button" role="tab" aria-selected={tab === 'reparto'} onClick={() => { setTab('reparto'); setEditingZone(null) }}>Zonas de reparto</button>
    </div>

    {tab === 'estructura' ? <>
      <div className="ws-form-grid ws-organization-grid">
        <form key={editingBranch?.id ?? 'branch-new'} className="ws-card ws-organization-form" onSubmit={event => void submit(event, 'branch')}>
          <div className="ws-section-heading"><div><h3><Building2 size={16} /> {editingBranch ? 'Editar sucursal' : 'Nueva sucursal'}</h3><p>La empresa principal agrupa las sucursales operativas.</p></div></div>
          <fieldset className="ws-organization-fields" disabled={!canManageOrganization || busy}><div className="ws-form-grid">
            <label>Código<input name="codigo" required maxLength={24} defaultValue={editingBranch?.codigo ?? ''} placeholder="LIMA-CENTRO" /></label>
            <label>Nombre<input name="nombre" required maxLength={120} defaultValue={editingBranch?.nombre ?? ''} placeholder="Nombre de sucursal" /></label>
            <label>Propósito<input name="proposito" maxLength={240} defaultValue={editingBranch?.proposito ?? ''} placeholder="Venta, administración…" /></label>
            <label>Dirección<input name="direccion" maxLength={240} defaultValue={editingBranch?.direccion ?? ''} /></label>
            <label>Teléfono<input name="telefono" maxLength={40} defaultValue={editingBranch?.telefono ?? ''} /></label>
            <label>Zona horaria<input name="zona_horaria" defaultValue={editingBranch?.zona_horaria ?? 'America/Lima'} /></label>
            <label><Clock3 size={14} /> Apertura<input type="time" name="hora_apertura" defaultValue={editingBranch?.hora_apertura ?? ''} /></label>
            <label><Clock3 size={14} /> Cierre<input type="time" name="hora_cierre" defaultValue={editingBranch?.hora_cierre ?? ''} /></label>
            {editingBranch && <label>Estado<select name="estado" defaultValue={editingBranch.estado}><option>Activo</option><option>Inactivo</option></select></label>}
          </div></fieldset>
          <div className="ws-heading-actions">
            {editingBranch && canManageOrganization && <button className="ws-button ws-button-secondary" type="button" onClick={() => setEditingBranch(null)}>Cancelar edición</button>}
            {canManageOrganization && <button className="primary-button" type="submit" disabled={busy || !data?.empresa}><Save size={14} />{busy ? 'Guardando…' : editingBranch ? 'Guardar sucursal' : 'Crear sucursal'}</button>}
          </div>
        </form>

        <form key={editingWarehouse?.id ?? 'warehouse-new'} className="ws-card ws-organization-form" onSubmit={event => void submit(event, 'warehouse')}>
          <div className="ws-section-heading"><div><h3><PackageCheck size={16} /> {editingWarehouse ? 'Editar almacén' : 'Nuevo almacén'}</h3><p>Define ubicación, uso y horario de atención.</p></div></div>
          <fieldset className="ws-organization-fields" disabled={!canManageOrganization || busy}><div className="ws-form-grid">
            <label>Sucursal<select name="sucursal_id" required defaultValue={editingWarehouse?.sucursal_id ?? ''}><option value="">Selecciona una sucursal</option>{data?.sucursales.filter(item => item.estado === 'Activo').map(item => <option key={item.id} value={item.id}>{item.nombre} · {item.codigo}</option>)}</select></label>
            <label>Nombre<input name="nombre" required maxLength={120} defaultValue={editingWarehouse?.nombre ?? ''} placeholder="Almacén principal" /></label>
            <label>Ubicación<input name="ubicacion" maxLength={240} defaultValue={editingWarehouse?.ubicacion ?? ''} /></label>
            <label>Responsable<input name="responsable" maxLength={120} defaultValue={editingWarehouse?.responsable ?? ''} /></label>
            <label>Propósito<input name="proposito" maxLength={240} defaultValue={editingWarehouse?.proposito ?? ''} placeholder="Materia prima, despacho…" /></label>
            <label>Zona horaria<input name="zona_horaria" defaultValue={editingWarehouse?.zona_horaria ?? 'America/Lima'} /></label>
            <label><Clock3 size={14} /> Apertura<input type="time" name="hora_apertura" defaultValue={editingWarehouse?.hora_apertura ?? ''} /></label>
            <label><Clock3 size={14} /> Cierre<input type="time" name="hora_cierre" defaultValue={editingWarehouse?.hora_cierre ?? ''} /></label>
            {editingWarehouse && <label>Estado<select name="activo" defaultValue={String(editingWarehouse.activo)}><option value="true">Activo</option><option value="false">Inactivo</option></select></label>}
          </div></fieldset>
          <div className="ws-heading-actions">
            {editingWarehouse && canManageOrganization && <button className="ws-button ws-button-secondary" type="button" onClick={() => setEditingWarehouse(null)}>Cancelar edición</button>}
            {canManageOrganization && <button className="primary-button" type="submit" disabled={busy || !data?.sucursales.some(item => item.estado === 'Activo')}><Save size={14} />{busy ? 'Guardando…' : editingWarehouse ? 'Guardar almacén' : 'Crear almacén'}</button>}
          </div>
        </form>
      </div>

      <div className="ws-report-grid ws-organization-lists">
        <article className="ws-card ws-report-card"><h3>Sucursales registradas</h3>{data?.sucursales.length ? data.sucursales.map(item => <div className="supplier-product-row" key={item.id}><span className="supplier-product-copy"><strong>{item.nombre}</strong><small>{item.codigo} · {item.estado} · {item.proposito || 'Sin propósito'}</small></span>{canManageOrganization && <button className="ws-text-button" type="button" onClick={() => setEditingBranch(item)}>Editar</button>}</div>) : <p>Aún no hay sucursales.</p>}</article>
        <article className="ws-card ws-report-card"><h3>Almacenes registrados</h3>{data?.almacenes.length ? data.almacenes.map(item => <div className="supplier-product-row" key={item.id}><span className="supplier-product-copy"><strong>{item.nombre}</strong><small>{data.sucursales.find(branch => branch.id === item.sucursal_id)?.nombre ?? 'Sucursal no disponible'} · {item.activo ? 'Activo' : 'Inactivo'} · {item.ubicacion || 'Sin ubicación'}</small></span>{canManageOrganization && <button className="ws-text-button" type="button" onClick={() => setEditingWarehouse(item)}>Editar</button>}</div>) : <p>Aún no hay almacenes.</p>}</article>
      </div>

      {canInitializeStock && <article className="ws-card ws-organization-opening">
        <div><h3>Apertura inicial distribuida</h3><p>Asigna el stock legado real por producto y almacén. La suma de cada fila debe coincidir con el stock actual del producto; no se supone que todo esté en un solo almacén.</p></div>
        {openingLoading ? <div className="ws-empty-compact"><RefreshCw size={16} className="ws-spin" /> Consultando existencias de apertura…</div>
          : inventoryOpening ? <div className="ws-notice" role="status">Apertura registrada el {new Date(inventoryOpening.created_at).toLocaleString('es-PE')}: {inventoryOpening.cantidad_productos} productos y {inventoryOpening.cantidad_unidades} unidades, en {inventoryOpening.cantidad_asignaciones} asignaciones. No se puede repetir.</div>
          : !activeWarehouses.length ? <div className="ws-notice ws-notice-warning">Crea al menos un almacén activo antes de distribuir las existencias.</div>
            : !openingProducts.length ? <div className="ws-empty-compact">No hay productos para abrir. Registra los productos antes de inicializar el inventario.</div>
              : <>
                <div className="ws-opening-grid-wrap">
                  <table className="ws-opening-grid">
                    <thead><tr><th>Producto</th><th>Stock legado</th>{activeWarehouses.map(warehouse => <th key={warehouse.id}>{warehouse.nombre}</th>)}<th>Asignado / total</th></tr></thead>
                    <tbody>{openingProducts.map(product => {
                      const assigned = assignedByProduct[product.id] ?? 0
                      const balanced = assigned === product.stock
                      return <tr key={product.id}>
                        <td><strong>{product.nombre}</strong><small>{product.codigo}</small></td>
                        <td>{product.stock}</td>
                        {activeWarehouses.map(warehouse => <td key={warehouse.id}><input
                          aria-label={`${product.codigo} en ${warehouse.nombre}`}
                          type="number" min="0" max={product.stock} step="1"
                          value={allocations[product.id]?.[warehouse.id] ?? ''}
                          onChange={event => {
                            const value = event.target.value
                            setAllocations(current => ({ ...current, [product.id]: { ...current[product.id], [warehouse.id]: value } }))
                            setOpeningKey(`apertura:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`}`)
                          }}
                          disabled={opening}
                        /></td>)}
                        <td><span className={`status-pill ${balanced ? 'green' : 'amber'}`}>{assigned} / {product.stock}</span></td>
                      </tr>
                    })}</tbody>
                  </table>
                </div>
                <div className="ws-heading-actions"><p className="relation-hint">Verifica los conteos físicos antes de confirmar. La operación crea saldos y movimientos iniciales una sola vez, conserva los 16 movimientos históricos y acepta reintentos con la misma clave.</p><button className="primary-button" type="button" disabled={opening || !activeWarehouses.length || !openingProducts.length} onClick={() => void registerOpening()}><PackageCheck size={14} />{opening ? 'Registrando apertura…' : 'Validar y registrar apertura'}</button></div>
              </>}
      </article>}
    </> : <>
      <form key={editingZone?.id ?? `zone-${tab}`} className="ws-card ws-organization-form" onSubmit={event => void submit(event, 'zone')}>
        <div className="ws-section-heading"><div><h3><MapPinned size={16} /> {editingZone ? 'Editar zona' : tab === 'comercial' ? 'Nueva zona comercial' : 'Nueva zona de reparto'}</h3><p>{tab === 'comercial' ? 'Organiza asignaciones y cobertura para la gestión de ventas.' : 'Define áreas de despacho para conectarlas con sucursales y entregas.'}</p></div></div>
        <fieldset className="ws-organization-fields" disabled={!canManageOrganization || busy}><div className="ws-form-grid">
          <label>Código<input name="codigo" required maxLength={24} defaultValue={editingZone?.codigo ?? ''} placeholder={tab === 'comercial' ? 'COM-01' : 'REP-01'} /></label>
          <label>Nombre<input name="nombre" required maxLength={120} defaultValue={editingZone?.nombre ?? ''} placeholder="Nombre de zona" /></label>
          <label>Propósito<input name="proposito" maxLength={240} defaultValue={editingZone?.proposito ?? ''} placeholder="Cobertura, responsable…" /></label>
          <label>Descripción<input name="descripcion" maxLength={500} defaultValue={editingZone?.descripcion ?? ''} /></label>
          {editingZone && <label>Estado<select name="estado" defaultValue={editingZone.estado}><option>Activo</option><option>Inactivo</option></select></label>}
        </div></fieldset>
        <div className="ws-heading-actions">
          {editingZone && canManageOrganization && <button className="ws-button ws-button-secondary" type="button" onClick={() => setEditingZone(null)}>Cancelar edición</button>}
          {canManageOrganization && <button className="primary-button" type="submit" disabled={busy}><Plus size={14} />{busy ? 'Guardando…' : editingZone ? 'Guardar zona' : 'Crear zona'}</button>}
        </div>
      </form>
      <article className="ws-card ws-organization-lists"><h3>{tab === 'comercial' ? 'Zonas comerciales' : 'Zonas de reparto'}</h3>{zones.length ? zones.map(zone => <div className="supplier-product-row" key={zone.id}><span className="supplier-product-copy"><strong>{zone.nombre}</strong><small>{zone.codigo} · {zone.estado} · {zone.proposito || zone.descripcion || 'Sin propósito definido'}</small></span>{canManageOrganization && <button className="ws-text-button" type="button" onClick={() => setEditingZone(zone)}>Editar</button>}</div>) : <p>Aún no hay zonas de este tipo.</p>}</article>

      <section className="ws-card ws-zone-assignment">
        <div className="ws-section-heading"><div><h3><Users size={16} /> Asignar clientes y sucursales</h3><p>{selectedZone ? `Define qué clientes y sucursales pertenecen a ${selectedZone.nombre}.` : 'Crea una zona para gestionar sus clientes y sucursales.'}</p></div></div>
        {!zones.length ? <div className="ws-empty-compact">Primero crea una zona {tab === 'comercial' ? 'comercial' : 'de reparto'}.</div> : <>
          <div className="ws-zone-assignment-toolbar">
            <label>Zona<select value={selectedZoneId} onChange={event => { setSelectedZoneId(event.target.value); setAssignmentQuery('') }} aria-label="Zona para asignar clientes y sucursales">{zones.map(zone => <option key={zone.id} value={zone.id}>{zone.nombre} · {zone.codigo}</option>)}</select></label>
            <label className="ws-table-search"><Search size={16} /><input value={assignmentQuery} onChange={event => setAssignmentQuery(event.target.value)} placeholder="Filtrar clientes o sucursales…" aria-label="Filtrar asignaciones de zona" /></label>
          </div>
          {assignmentMessage && <div className="ws-notice" role="status">{assignmentMessage}</div>}
          {assignmentLoading ? <div className="ws-empty-compact"><RefreshCw size={16} className="ws-spin" /> Cargando asociaciones de la zona…</div> : assignmentData && <div className="ws-zone-assignment-grid">
            <article className="ws-zone-assignment-list"><div><h4>Clientes asignados</h4><p>Un cliente puede asociarse a varias zonas.</p></div><div className="ws-zone-assignment-items">{!canViewCustomers ? <p className="ws-zone-assignment-empty">Se requiere permiso de lectura de Clientes para ver y asignar clientes a la zona.</p> : filteredCustomers.map(customer => {
              const checked = assignmentData.clienteIds.includes(customer.id)
              return <label className="ws-zone-assignment-item" key={customer.id}><input type="checkbox" checked={checked} disabled={assignmentLoading || assignmentBusy || !canManageOrganization || (!checked && customer.estado !== 'Activo')} onChange={event => void updateAssignment('cliente', customer.id, event.target.checked)} /><span><strong>{customer.razon_social}</strong><small>{customer.codigo} · {customer.estado}{customer.detalle ? ` · ${customer.detalle}` : ''}</small></span></label>
            })}{!filteredCustomers.length && <p className="ws-zone-assignment-empty">{assignmentData.clientes.length ? 'No hay clientes que coincidan con el filtro.' : 'No hay clientes registrados.'}</p>}</div></article>
            <article className="ws-zone-assignment-list"><div><h4>Sucursales cubiertas</h4><p>Asocia una sucursal cuando opere en esta zona.</p></div><div className="ws-zone-assignment-items">{filteredBranches.map(branch => {
              const checked = assignmentData.sucursalIds.includes(branch.id)
              return <label className="ws-zone-assignment-item" key={branch.id}><input type="checkbox" checked={checked} disabled={assignmentLoading || assignmentBusy || !canManageOrganization || (!checked && branch.estado !== 'Activo')} onChange={event => void updateAssignment('sucursal', branch.id, event.target.checked)} /><span><strong>{branch.nombre}</strong><small>{branch.codigo} · {branch.estado}{branch.direccion ? ` · ${branch.direccion}` : ''}</small></span></label>
            })}{!filteredBranches.length && <p className="ws-zone-assignment-empty">{assignmentData.sucursales.length ? 'No hay sucursales que coincidan con el filtro.' : 'Crea sucursales para asociarlas a esta zona.'}</p>}</div></article>
          </div>}
          <p className="relation-hint">Las asignaciones se guardan al marcar cada casilla. La ficha actual del cliente no tiene una dirección estructurada; para planificar rutas se debe completar ese dato como parte de Logística.</p>
        </>}
      </section>
    </>}
  </div>
}
