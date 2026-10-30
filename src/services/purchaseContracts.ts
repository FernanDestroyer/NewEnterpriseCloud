import { requireSupabase } from '../lib/supabase'
import type {
  CreatePurchaseContractInput, CreatePurchaseContractVersionInput, PurchaseContract,
  PurchaseContractLine, PurchaseContractVersion, PurchaseContractCurrency,
} from '../types/purchaseContracts'

export type PurchaseContractCatalogItem = {
  id: string
  nombre: string
  detalle: string
  costo: number
  producto_id: string | null
}

export type PurchaseContractSummary = PurchaseContract & {
  version: PurchaseContractVersion | null
  lineas: Array<PurchaseContractLine & { cantidad_comprometida: number }>
  monto_comprometido: number
  porcentaje_consumido: number
}

export type PurchaseContractPage = { items: PurchaseContractSummary[]; total: number; limit: number; offset: number }

export async function fetchPurchaseContractCatalog(proveedorId: string): Promise<PurchaseContractCatalogItem[]> {
  const { data, error } = await requireSupabase().from('proveedor_productos')
    .select('id,nombre,detalle,costo,producto_id').eq('proveedor_id', proveedorId).order('nombre')
  if (error) throw error
  return (data ?? []) as PurchaseContractCatalogItem[]
}

export async function fetchPurchaseContracts(input: {
  estado?: string
  search?: string
  limit?: number
  offset?: number
} = {}): Promise<PurchaseContractPage> {
  const client = requireSupabase()
  const limit = input.limit ?? 10
  const offset = input.offset ?? 0
  let query = client.from('contratos_compra').select('*', { count: 'exact' }).order('creado_en', { ascending: false })
  if (input.estado) query = query.eq('estado', input.estado)
  if (input.search?.trim()) {
    const term = input.search.trim().replace(/[,%()]/g, ' ')
    query = query.or(`codigo.ilike.%${term}%,nombre.ilike.%${term}%`)
  }
  const { data, error, count } = await query.range(offset, offset + limit - 1)
  if (error) throw error
  const contracts = (data ?? []) as PurchaseContract[]
  if (!contracts.length) return { items: [], total: count ?? 0, limit, offset }

  const contractIds = contracts.map(item => item.id)
  const [versionsResult, releasesResult] = await Promise.all([
    client.from('versiones_contrato_compra').select('*').in('contrato_id', contractIds).order('numero_version', { ascending: false }),
    client.from('liberaciones_contrato_compra').select('id,contrato_id,monto_comprometido')
      .in('contrato_id', contractIds).eq('estado', 'Comprometida'),
  ])
  if (versionsResult.error) throw versionsResult.error
  if (releasesResult.error) throw releasesResult.error
  const versions = (versionsResult.data ?? []) as PurchaseContractVersion[]
  const releases = (releasesResult.data ?? []) as Array<{ id: string; contrato_id: string; monto_comprometido: number }>
  const releaseIds = releases.map(item => item.id)
  const releaseLineResult = releaseIds.length
    ? await client.from('lineas_liberacion_contrato_compra').select('liberacion_id,linea_contrato_id,cantidad').in('liberacion_id', releaseIds)
    : { data: [], error: null }
  if (releaseLineResult.error) throw releaseLineResult.error
  const releaseLines = (releaseLineResult.data ?? []) as Array<{ liberacion_id: string; linea_contrato_id: string; cantidad: number }>
  const versionById = new Map(versions.map(version => [version.id, version]))
  const committedByLine = new Map<string, number>()
  for (const line of releaseLines) committedByLine.set(line.linea_contrato_id, (committedByLine.get(line.linea_contrato_id) ?? 0) + Number(line.cantidad))
  const committedByContract = new Map<string, number>()
  for (const release of releases) committedByContract.set(release.contrato_id, (committedByContract.get(release.contrato_id) ?? 0) + Number(release.monto_comprometido))
  const selectedVersionByContract = new Map<string, PurchaseContractVersion>()
  for (const contract of contracts) {
    const versionsForContract = versions.filter(version => version.contrato_id === contract.id)
    const candidate = versionsForContract.find(version => version.estado === 'Borrador')
      ?? versionsForContract.find(version => version.id === contract.version_actual_id)
      ?? versionsForContract.find(version => version.estado === 'Activa')
      ?? versionsForContract[0]
    if (candidate) selectedVersionByContract.set(contract.id, candidate)
  }
  const versionIds = [...selectedVersionByContract.values()].map(version => version.id)
  const lineResult = versionIds.length
    ? await client.from('lineas_contrato_compra').select('*').in('version_id', versionIds)
    : { data: [], error: null }
  if (lineResult.error) throw lineResult.error
  const lines = (lineResult.data ?? []) as PurchaseContractLine[]

  return {
    items: contracts.map(contract => {
      const version = selectedVersionByContract.get(contract.id) ?? (contract.version_actual_id ? versionById.get(contract.version_actual_id) ?? null : null)
      const committed = committedByContract.get(contract.id) ?? 0
      return {
        ...contract,
        version,
        lineas: lines.filter(line => line.version_id === version?.id).map(line => ({
          ...line,
          cantidad_comprometida: committedByLine.get(line.id) ?? 0,
        })),
        monto_comprometido: committed,
        porcentaje_consumido: version && Number(version.monto_tope) > 0 ? committed / Number(version.monto_tope) * 100 : 0,
      }
    }),
    total: count ?? 0,
    limit,
    offset,
  }
}

export async function createPurchaseContract(input: CreatePurchaseContractInput): Promise<string> {
  const { data, error } = await requireSupabase().rpc('crear_contrato_compra_v1', {
    p_proveedor_id: input.proveedor_id,
    p_responsable_id: input.responsable_id,
    p_nombre: input.nombre,
    p_detalle: input.detalle ?? '',
    p_fecha_inicio: input.fecha_inicio,
    p_fecha_fin: input.fecha_fin,
    p_moneda: input.moneda,
    p_monto_tope: input.monto_tope,
    p_condiciones: input.condiciones ?? '',
    p_lineas: input.lineas,
    p_idempotency_key: input.idempotency_key,
  })
  if (error) throw error
  return String(data)
}

export async function createPurchaseContractVersion(input: CreatePurchaseContractVersionInput): Promise<string> {
  const { data, error } = await requireSupabase().rpc('crear_version_contrato_compra_v1', {
    p_contrato_id: input.contrato_id,
    p_fecha_inicio: input.fecha_inicio,
    p_fecha_fin: input.fecha_fin,
    p_moneda: input.moneda,
    p_monto_tope: input.monto_tope,
    p_condiciones: input.condiciones ?? '',
    p_lineas: input.lineas,
    p_motivo: input.motivo,
    p_idempotency_key: input.idempotency_key,
  })
  if (error) throw error
  return String(data)
}

export async function activatePurchaseContract(contractId: string, versionId: string, idempotencyKey: string): Promise<void> {
  const { error } = await requireSupabase().rpc('activar_contrato_compra_v1', {
    p_contrato_id: contractId,
    p_version_id: versionId,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw error
}

export async function suspendPurchaseContract(contractId: string, reason: string, idempotencyKey: string): Promise<void> {
  const { error } = await requireSupabase().rpc('suspender_contrato_compra_v1', {
    p_contrato_id: contractId,
    p_motivo: reason,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw error
}

export async function closePurchaseContract(contractId: string, reason: string, idempotencyKey: string): Promise<void> {
  const { error } = await requireSupabase().rpc('cerrar_contrato_compra_v1', {
    p_contrato_id: contractId,
    p_motivo: reason,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw error
}

export async function createPurchaseOrderFromContract(input: {
  contractId: string
  versionId: string
  detail: string
  dueDate: string | null
  lines: Array<{
    proveedor_producto_id: string
    cantidad: number
    precio: number
    tratamiento_tributario: 'Gravado' | 'Exonerado' | 'Inafecto'
    tasa_tributaria: number
  }>
  idempotencyKey: string
  exchangeRate: number | null
  currency: PurchaseContractCurrency
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc('crear_orden_compra_desde_contrato_v1', {
    p_contrato_id: input.contractId,
    p_version_id: input.versionId,
    p_detalle: input.detail,
    p_fecha_limite: input.dueDate,
    p_lineas: input.lines.map(line => ({
      producto_id: line.proveedor_producto_id,
      cantidad: line.cantidad,
      precio: line.precio,
      tratamiento_tributario: line.tratamiento_tributario,
      tasa_tributaria: line.tasa_tributaria,
    })),
    p_idempotency_key: input.idempotencyKey,
    p_exchange_rate: input.currency === 'PEN' ? 1 : input.exchangeRate,
  })
  if (error) throw error
  return String(data)
}
