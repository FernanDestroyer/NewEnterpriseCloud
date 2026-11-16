export type CurrentStockLocation = {
  producto_id: string
  almacen_id: string
  stock_fisico: number
  almacen_nombre?: string
}

export type PepsLedgerSnapshot = {
  producto_id: string
  almacen_id: string
  saldo_unidades: number | null
  saldo_peps: number | null
  problema: 'sin-kardex' | 'fechas-empatadas' | 'stock-no-coincide' | 'sin-costo' | null
}

export type PepsValuationLocation = {
  producto_id: string
  almacen_id: string
  almacen_nombre: string
  stock: number
  valor_peps: number | null
  problema: 'sin-kardex' | 'fechas-empatadas' | 'stock-no-coincide' | 'sin-costo' | null
}

export type PepsValuationProduct = {
  producto_id: string
  stock: number
  valor_peps: number | null
  ubicaciones: number
  problemas: number
}

export type PepsValuationSnapshot = {
  completo: boolean
  valor_total: number | null
  ubicaciones_totales: number
  ubicaciones_valorizadas: number
  ubicaciones: PepsValuationLocation[]
  productos: PepsValuationProduct[]
}

const key = (productoId: string, almacenId: string) => `${productoId}:${almacenId}`
const amount = (value: number | null) => value !== null && Number.isFinite(Number(value)) ? Number(value) : null

/**
 * Conciles the server-calculated latest PEPS balance per warehouse against current physical stock.
 * A report total is returned only when every positive-stock location has an
 * unambiguous, matching, costed Kardex snapshot. The server sends one snapshot
 * row per location, avoiding a full Kardex-history download to the browser.
 */
export function buildPepsValuationSnapshot(
  currentStock: CurrentStockLocation[],
  ledgerSnapshots: PepsLedgerSnapshot[],
): PepsValuationSnapshot {
  const ledgerByLocation = new Map<string, PepsLedgerSnapshot[]>()
  for (const snapshot of ledgerSnapshots) {
    const locationKey = key(snapshot.producto_id, snapshot.almacen_id)
    const snapshots = ledgerByLocation.get(locationKey) ?? []
    snapshots.push(snapshot)
    ledgerByLocation.set(locationKey, snapshots)
  }

  const locations: PepsValuationLocation[] = currentStock
    .filter(location => Number.isFinite(Number(location.stock_fisico)) && Number(location.stock_fisico) > 0)
    .map(location => {
      const stock = Number(location.stock_fisico)
      const snapshots = ledgerByLocation.get(key(location.producto_id, location.almacen_id)) ?? []
      const latest = snapshots[0]
      let problema: PepsValuationLocation['problema'] = null
      let value: number | null = null
      if (snapshots.length > 1) problema = 'fechas-empatadas'
      else if (!latest) problema = 'sin-kardex'
      else if (latest.problema) problema = latest.problema
      else if (Number(latest.saldo_unidades) !== stock) problema = 'stock-no-coincide'
      else {
        value = amount(latest.saldo_peps)
        if (value === null) problema = 'sin-costo'
      }
      return {
        producto_id: location.producto_id,
        almacen_id: location.almacen_id,
        almacen_nombre: location.almacen_nombre?.trim() || 'Almacén sin nombre',
        stock,
        valor_peps: value,
        problema,
      }
    })
    .sort((a, b) => a.almacen_nombre.localeCompare(b.almacen_nombre, 'es') || a.producto_id.localeCompare(b.producto_id))

  const productsById = new Map<string, PepsValuationProduct>()
  for (const location of locations) {
    const product = productsById.get(location.producto_id) ?? {
      producto_id: location.producto_id,
      stock: 0,
      valor_peps: 0,
      ubicaciones: 0,
      problemas: 0,
    }
    product.stock += location.stock
    product.ubicaciones += 1
    if (location.problema) {
      product.problemas += 1
      product.valor_peps = null
    } else if (product.valor_peps !== null) {
      product.valor_peps += location.valor_peps ?? 0
    }
    productsById.set(location.producto_id, product)
  }

  const ubicacionesValorizadas = locations.filter(location => location.problema === null).length
  const completo = ubicacionesValorizadas === locations.length
  const products = [...productsById.values()].map(product => ({
    ...product,
    valor_peps: product.valor_peps === null ? null : Math.round(product.valor_peps * 100) / 100,
  })).sort((a, b) => (b.valor_peps ?? -1) - (a.valor_peps ?? -1) || a.producto_id.localeCompare(b.producto_id))

  return {
    completo,
    valor_total: completo ? Math.round(locations.reduce((sum, location) => sum + (location.valor_peps ?? 0), 0) * 100) / 100 : null,
    ubicaciones_totales: locations.length,
    ubicaciones_valorizadas: ubicacionesValorizadas,
    ubicaciones: locations,
    productos: products,
  }
}
