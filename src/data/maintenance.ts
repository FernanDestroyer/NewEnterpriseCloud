import type { DataPage, RecordItem } from '../types'

export type CheckResult = {
  label: string
  detail: string
  tone: 'green' | 'amber' | 'red'
  count: number
  fix?: { label: string; path: string }
}

/** Revisa la coherencia de los datos cargados (sin tocar la base de datos). */
export function runChecks(records: Record<DataPage, RecordItem[]>, catalog: RecordItem[]): CheckResult[] {
  const results: CheckResult[] = []
  const fail = (label: string, items: string[], tone: 'amber' | 'red', fix?: CheckResult['fix']) => results.push({
    label,
    detail: items.slice(0, 5).join(' · ') + (items.length > 5 ? ` · +${items.length - 5} más` : ''),
    tone,
    count: items.length,
    fix,
  })
  const ok = (label: string, detail: string) => results.push({ label, detail, tone: 'green', count: 0 })

  const negative = records.inventory.filter(item => (item.quantity ?? 0) < 0)
  if (negative.length) fail('Stock negativo', negative.map(item => `${item.id} (${item.quantity})`), 'red', { label: 'Revisar en Productos', path: `/inventory?q=${encodeURIComponent(negative[0].id)}` })
  else ok('Stock sin negativos', `${records.inventory.length} productos revisados.`)

  const noPrice = records.inventory.filter(item => item.precio === undefined)
  if (noPrice.length) fail('Productos sin precio', noPrice.map(item => item.id), 'amber', { label: 'Revisar en Productos', path: '/inventory' })
  else ok('Precios definidos', `${records.inventory.length} productos revisados.`)

  const agotados = records.inventory.filter(item => (item.quantity ?? 0) <= 0)
  if (agotados.length) fail('Productos agotados', agotados.map(item => item.id), 'amber', { label: 'Reponer en Productos', path: `/inventory?q=${encodeURIComponent(agotados[0].id)}` })
  else ok('Sin agotados', `${records.inventory.length} productos con existencias.`)

  const noRuc = records.suppliers.filter(item => !item.ruc)
  if (noRuc.length) fail('Proveedores sin RUC', noRuc.map(item => item.id), 'amber', { label: 'Revisar en Proveedores', path: `/suppliers?q=${encodeURIComponent(noRuc[0].id)}` })
  else ok('Proveedores con RUC', `${records.suppliers.length} proveedores revisados.`)

  const byRuc = new Map<string, string[]>()
  for (const item of records.suppliers) {
    if (!item.ruc) continue
    byRuc.set(item.ruc, [...(byRuc.get(item.ruc) ?? []), item.id])
  }
  const dupRuc = [...byRuc.entries()].filter(([, codes]) => codes.length > 1)
  if (dupRuc.length) fail('RUC duplicados', dupRuc.map(([ruc, codes]) => `${ruc} (${codes.join(', ')})`), 'red', { label: 'Revisar en Proveedores', path: `/suppliers?q=${encodeURIComponent(dupRuc[0][0])}` })
  else ok('RUC únicos', `${byRuc.size} RUC revisados.`)

  const byDoc = new Map<string, string[]>()
  for (const item of records.customers) {
    if (!item.documento) continue
    byDoc.set(item.documento, [...(byDoc.get(item.documento) ?? []), item.id])
  }
  const dupDoc = [...byDoc.entries()].filter(([, codes]) => codes.length > 1)
  if (dupDoc.length) fail('Documentos duplicados', dupDoc.map(([doc, codes]) => `${doc} (${codes.join(', ')})`), 'red', { label: 'Revisar en Clientes', path: `/customers?q=${encodeURIComponent(dupDoc[0][0])}` })
  else ok('Documentos únicos', `${byDoc.size} documentos revisados.`)

  const supplierIds = new Set(records.suppliers.map(item => item.rowId))
  const orphan = catalog.filter(item => item.proveedor_id && !supplierIds.has(item.proveedor_id))
  if (orphan.length) fail('Catálogo huérfano', orphan.map(item => item.id), 'red', { label: 'Revisar en Proveedores', path: '/suppliers' })
  else ok('Catálogo vinculado', `${catalog.length} productos de proveedor revisados.`)

  const saleIds = new Set(records.sales.map(item => item.rowId))
  const purchaseIds = new Set(records.purchases.map(item => item.rowId))
  const orphanPay = records.finance.filter(item =>
    (item.saleId && !saleIds.has(item.saleId)) || (item.purchaseId && !purchaseIds.has(item.purchaseId)))
  if (orphanPay.length) fail('Cuentas sin documento', orphanPay.map(item => item.id), 'red', { label: 'Revisar en Tesorería', path: '/finance' })
  else ok('Cuentas vinculadas', `${records.finance.length} cuentas revisadas.`)

  const salesById = new Map(records.sales.map(item => [item.rowId, item]))
  const purchasesById = new Map(records.purchases.map(item => [item.rowId, item]))
  const desync = records.finance.filter(item => {
    if (item.status === 'Completada') return false
    const sale = item.saleId ? salesById.get(item.saleId) : undefined
    if (sale && sale.status === 'Completada') return true
    const purchase = item.purchaseId ? purchasesById.get(item.purchaseId) : undefined
    return Boolean(purchase && purchase.status === 'Pagada')
  })
  if (desync.length) fail('Cobranza desalineada', desync.map(item => `${item.id} pendiente con documento completado`), 'amber', { label: 'Revisar en Tesorería', path: `/finance?q=${encodeURIComponent(desync[0].id)}` })
  else ok('Cobranza alineada', `${records.finance.length} cuentas revisadas.`)

  return results
}

/** Cantidad de hallazgos pendientes (para el aviso del menú). */
export function countMaintenanceIssues(records: Record<DataPage, RecordItem[]>, catalog: RecordItem[]): number {
  return runChecks(records, catalog).filter(item => item.tone !== 'green').length
}
