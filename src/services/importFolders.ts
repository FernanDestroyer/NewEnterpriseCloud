import { requireSupabase } from '../lib/supabase'
import type {
  ImportExpense, ImportFolder, ImportFolderHistoryEvent, ImportLandedCostPreviewLine,
  ImportOrderLink, RegisterImportExpenseInput,
} from '../types/imports'

const PAGE_SIZE = 10
const LINK_SCAN_SIZE = 1000

export type ImportFolderSummary = ImportFolder & {
  order_count: number
  proveedor_ids: string[]
  expense_total_usd: number
}

export type ImportFolderPage = { items: ImportFolderSummary[]; total: number; limit: number; offset: number }

export type AvailableImportOrder = {
  id: string
  codigo: string
  proveedor_id: string
  proveedor_nombre: string
  moneda: 'USD'
  exchange_rate: number
  monto: number
  created_at: string
}

export type ImportFolderDetail = {
  folder: ImportFolder
  orders: ImportOrderLink[]
  expenses: ImportExpense[]
  history: ImportFolderHistoryEvent[]
  preview: ImportLandedCostPreviewLine[]
  previewError?: string
}

export async function fetchImportFolders(input: {
  estado?: string
  proveedorId?: string
  limit?: number
  offset?: number
} = {}): Promise<ImportFolderPage> {
  const client = requireSupabase()
  const limit = input.limit ?? PAGE_SIZE
  const offset = input.offset ?? 0
  let supplierFolderIds: string[] | null = null
  if (input.proveedorId) {
    const ids = new Set<string>()
    let start = 0
    while (true) {
      const { data, error } = await client.from('ordenes_importacion').select('carpeta_id')
        .eq('proveedor_id', input.proveedorId).range(start, start + LINK_SCAN_SIZE - 1)
      if (error) throw error
      const batch = (data ?? []) as Array<{ carpeta_id: string }>
      batch.forEach(row => ids.add(row.carpeta_id))
      if (batch.length < LINK_SCAN_SIZE) break
      start += LINK_SCAN_SIZE
    }
    supplierFolderIds = [...ids]
    if (!supplierFolderIds.length) return { items: [], total: 0, limit, offset }
  }

  let query = client.from('carpetas_importacion').select('*', { count: 'exact' }).order('creado_en', { ascending: false })
  if (input.estado) query = query.eq('estado', input.estado)
  if (supplierFolderIds) query = query.in('id', supplierFolderIds)
  const { data, error, count } = await query.range(offset, offset + limit - 1)
  if (error) throw error
  const folders = (data ?? []) as ImportFolder[]
  if (!folders.length) return { items: [], total: count ?? 0, limit, offset }

  const folderIds = folders.map(folder => folder.id)
  const [linksResult, expensesResult] = await Promise.all([
    client.from('ordenes_importacion').select('carpeta_id,proveedor_id').in('carpeta_id', folderIds),
    client.from('gastos_importacion').select('carpeta_id,monto,moneda,tipo_cambio').in('carpeta_id', folderIds),
  ])
  if (linksResult.error) throw linksResult.error
  if (expensesResult.error) throw expensesResult.error
  const links = (linksResult.data ?? []) as Array<{ carpeta_id: string; proveedor_id: string }>
  const expenses = (expensesResult.data ?? []) as Array<{ carpeta_id: string; monto: number; moneda: string; tipo_cambio: number | null }>
  return {
    items: folders.map(folder => {
      const folderLinks = links.filter(link => link.carpeta_id === folder.id)
      const expenseTotal = expenses.filter(expense => expense.carpeta_id === folder.id)
        .reduce((sum, expense) => sum + (expense.moneda === 'USD' ? Number(expense.monto) : Number(expense.monto) / Number(expense.tipo_cambio)), 0)
      return {
        ...folder,
        order_count: folderLinks.length,
        proveedor_ids: [...new Set(folderLinks.map(link => link.proveedor_id))],
        expense_total_usd: Math.round(expenseTotal * 100) / 100,
      }
    }),
    total: count ?? 0,
    limit,
    offset,
  }
}

export async function fetchImportFolderDetail(folderId: string): Promise<ImportFolderDetail> {
  const client = requireSupabase()
  const [folderResult, linksResult, expensesResult, historyResult, previewResult] = await Promise.all([
    client.from('carpetas_importacion').select('*').eq('id', folderId).single(),
    client.from('ordenes_importacion').select('*').eq('carpeta_id', folderId).order('vinculada_en'),
    client.from('gastos_importacion').select('*').eq('carpeta_id', folderId).order('creado_en', { ascending: false }),
    client.from('carpetas_importacion_historial').select('*').eq('carpeta_id', folderId).order('created_at', { ascending: false }).limit(50),
    client.rpc('calcular_prorrateo_importacion_v1', { p_carpeta_id: folderId }),
  ])
  if (folderResult.error) throw folderResult.error
  if (linksResult.error) throw linksResult.error
  if (expensesResult.error) throw expensesResult.error
  if (historyResult.error) throw historyResult.error
  // La carpeta sin líneas todavía puede no tener una base de prorrateo válida.
  const previewError = previewResult.error?.message ?? ''
  const preview = previewResult.error ? [] : (previewResult.data ?? []) as ImportLandedCostPreviewLine[]
  // The dossier itself remains useful even when the optional landed-cost
  // preview RPC is unavailable (for example, while PostgREST refreshes schema).
  // Keep the exact RPC error on the detail so the UI can explain why
  // nationalization is unavailable without hiding orders/expenses/history.
  const previewUnavailable = Boolean(previewResult.error)
    && !/valor positivo|No hay valor|líneas de producto/i.test(previewError)
  return {
    folder: folderResult.data as ImportFolder,
    orders: (linksResult.data ?? []) as ImportOrderLink[],
    expenses: (expensesResult.data ?? []) as ImportExpense[],
    history: (historyResult.data ?? []) as ImportFolderHistoryEvent[],
    preview,
    previewError: previewUnavailable ? previewError : undefined,
  }
}

export async function fetchAvailableImportOrders(): Promise<AvailableImportOrder[]> {
  const client = requireSupabase()
  const { data, error } = await client.from('compras')
    .select('id,codigo,proveedor_id,proveedor_nombre,moneda,exchange_rate,monto,created_at')
    .in('estado', ['Confirmada', 'Confirmado']).eq('moneda', 'USD').not('exchange_rate', 'is', null)
    .eq('estado_recepcion', 'pendiente').eq('requiere_recepcion', true)
    .order('created_at', { ascending: false }).limit(1000)
  if (error) throw error
  const candidates = (data ?? []) as AvailableImportOrder[]
  if (!candidates.length) return []
  const ids = candidates.map(order => order.id)
  const [receiptResult, linkResult] = await Promise.all([
    client.from('recepciones_compra').select('compra_id').in('compra_id', ids),
    client.from('ordenes_importacion').select('compra_id').in('compra_id', ids),
  ])
  if (receiptResult.error) throw receiptResult.error
  if (linkResult.error) throw linkResult.error
  const hasReceipt = new Set(((receiptResult.data ?? []) as Array<{ compra_id: string }>).map(row => row.compra_id))
  const linked = new Set(((linkResult.data ?? []) as Array<{ compra_id: string }>).map(row => row.compra_id))
  return candidates.filter(order => Number(order.exchange_rate) > 0 && !hasReceipt.has(order.id) && !linked.has(order.id))
}

export async function createImportFolder(input: { nombre: string; referencia: string; idempotencyKey: string }): Promise<string> {
  const { data, error } = await requireSupabase().rpc('crear_carpeta_importacion_v1', {
    p_nombre: input.nombre,
    p_referencia: input.referencia,
    p_idempotency_key: input.idempotencyKey,
  })
  if (error) throw error
  return String(data)
}

export async function linkImportOrder(folderId: string, purchaseId: string, idempotencyKey: string): Promise<void> {
  const { error } = await requireSupabase().rpc('vincular_orden_importacion_v1', {
    p_carpeta_id: folderId,
    p_compra_id: purchaseId,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw error
}

export async function unlinkImportOrder(folderId: string, purchaseId: string, idempotencyKey: string): Promise<void> {
  const { error } = await requireSupabase().rpc('desvincular_orden_importacion_v1', {
    p_carpeta_id: folderId,
    p_compra_id: purchaseId,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw error
}

export async function registerImportExpense(input: RegisterImportExpenseInput): Promise<string> {
  const { error, data } = await requireSupabase().rpc('registrar_gasto_importacion_v1', {
    p_carpeta_id: input.carpeta_id,
    p_tipo: input.tipo,
    p_descripcion: input.descripcion,
    p_monto: input.monto,
    p_moneda: input.moneda,
    p_tipo_cambio: input.moneda === 'USD' ? 1 : input.tipo_cambio,
    p_referencia: input.referencia ?? '',
    p_idempotency_key: input.idempotency_key,
  })
  if (error) throw error
  return String(data)
}

export async function updateImportFolderState(folderId: string, state: 'En Tránsito' | 'En Aduanas', reason: string, idempotencyKey: string): Promise<void> {
  const { error } = await requireSupabase().rpc('actualizar_estado_carpeta_importacion_v1', {
    p_carpeta_id: folderId,
    p_estado: state,
    p_motivo: reason,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw error
}

export async function nationalizeImportFolder(folderId: string, warehouseId: string, reason: string, idempotencyKey: string): Promise<void> {
  const { error } = await requireSupabase().rpc('nacionalizar_carpeta_importacion_v1', {
    p_carpeta_id: folderId,
    p_almacen_id: warehouseId,
    p_motivo: reason,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw error
}
