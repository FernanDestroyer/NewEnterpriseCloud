import { requireSupabase } from '../lib/supabase'

export type Branch = {
  id: string
  empresa_id: string
  codigo: string
  nombre: string
  proposito: string | null
  direccion: string | null
  telefono: string | null
  hora_apertura: string | null
  hora_cierre: string | null
  zona_horaria: string
  estado: string
}

export type Warehouse = {
  id: string
  sucursal_id: string
  nombre: string
  ubicacion: string | null
  responsable: string | null
  proposito: string | null
  hora_apertura: string | null
  hora_cierre: string | null
  zona_horaria: string
  activo: boolean
}

export type Zone = {
  id: string
  codigo: string
  nombre: string
  tipo: 'comercial' | 'reparto'
  proposito: string | null
  descripcion: string | null
  estado: string
}

export type LegacyStockProduct = { id: string; codigo: string; nombre: string; stock: number }
export type InventoryOpening = {
  id: string
  cantidad_productos: number
  cantidad_unidades: number
  cantidad_asignaciones: number
  created_at: string
}

export type ZoneAssignmentData = {
  clientes: Array<{ id: string; codigo: string; razon_social: string; detalle: string; estado: string }>
  sucursales: Array<{ id: string; codigo: string; nombre: string; direccion: string | null; estado: string }>
  clienteIds: string[]
  sucursalIds: string[]
}

export type OrganizationSetup = {
  empresa: { id: string; razon_social: string } | null
  sucursales: Branch[]
  almacenes: Warehouse[]
  zonas: Zone[]
}

export async function fetchOrganizationSetup(): Promise<OrganizationSetup> {
  const client = requireSupabase()
  const [companyResult, branchResult, warehouseResult, zoneResult] = await Promise.all([
    client.from('empresas').select('id,razon_social').eq('es_principal', true).maybeSingle(),
    client.from('sucursales').select('*').order('nombre'),
    client.from('almacenes').select('id,sucursal_id,nombre,ubicacion,responsable,proposito,hora_apertura,hora_cierre,zona_horaria,activo').order('nombre'),
    client.from('zonas').select('id,codigo,nombre,tipo,proposito,descripcion,estado').order('nombre'),
  ])
  const failed = [companyResult, branchResult, warehouseResult, zoneResult].find(result => result.error)
  if (failed?.error) throw failed.error
  return {
    empresa: companyResult.data as OrganizationSetup['empresa'],
    sucursales: (branchResult.data ?? []) as Branch[],
    almacenes: (warehouseResult.data ?? []) as Warehouse[],
    zonas: (zoneResult.data ?? []) as Zone[],
  }
}

export type BranchInput = Omit<Branch, 'id' | 'estado'> & { estado?: string }
export async function saveBranch(input: BranchInput, id?: string): Promise<void> {
  const client = requireSupabase()
  const payload = {
    empresa_id: input.empresa_id,
    codigo: input.codigo.trim().toUpperCase(),
    nombre: input.nombre.trim(),
    proposito: input.proposito?.trim() || null,
    direccion: input.direccion?.trim() || null,
    telefono: input.telefono?.trim() || null,
    hora_apertura: input.hora_apertura || null,
    hora_cierre: input.hora_cierre || null,
    zona_horaria: input.zona_horaria || 'America/Lima',
    ...(input.estado ? { estado: input.estado } : {}),
  }
  const result = id
    ? await client.from('sucursales').update(payload).eq('id', id).select('id').single()
    : await client.from('sucursales').insert(payload).select('id').single()
  if (result.error) throw result.error
}

export type WarehouseInput = Omit<Warehouse, 'id'>
export async function saveWarehouse(input: WarehouseInput, id?: string): Promise<void> {
  const client = requireSupabase()
  const nombre = input.nombre.trim()
  if (!input.sucursal_id) throw new Error('Selecciona la sucursal a la que pertenece el almacén.')
  if (nombre.length < 2 || nombre.length > 120) throw new Error('El nombre del almacén debe tener entre 2 y 120 caracteres.')
  const payload = {
    sucursal_id: input.sucursal_id,
    nombre,
    ubicacion: input.ubicacion?.trim() || null,
    responsable: input.responsable?.trim() || null,
    proposito: input.proposito?.trim() || null,
    hora_apertura: input.hora_apertura || null,
    hora_cierre: input.hora_cierre || null,
    zona_horaria: input.zona_horaria || 'America/Lima',
    activo: input.activo,
  }
  const result = id
    ? await client.from('almacenes').update(payload).eq('id', id).select('id').single()
    : await client.from('almacenes').insert(payload).select('id').single()
  if (result.error?.code === '23505') throw new Error('Ya existe un almacén con ese nombre en esta sucursal.')
  if (result.error) throw result.error
}

export type ZoneInput = Omit<Zone, 'id'>
export async function saveZone(input: ZoneInput, id?: string): Promise<void> {
  const client = requireSupabase()
  const payload = {
    codigo: input.codigo.trim().toUpperCase(),
    nombre: input.nombre.trim(),
    tipo: input.tipo,
    proposito: input.proposito?.trim() || null,
    descripcion: input.descripcion?.trim() || null,
    estado: input.estado,
  }
  const result = id
    ? await client.from('zonas').update(payload).eq('id', id).select('id').single()
    : await client.from('zonas').insert(payload).select('id').single()
  if (result.error) throw result.error
}

export async function fetchZoneAssignmentData(zonaId: string, canViewCustomers: boolean): Promise<ZoneAssignmentData> {
  const client = requireSupabase()
  const [branchResult, branchLinks] = await Promise.all([
    client.from('sucursales').select('id,codigo,nombre,direccion,estado').order('nombre'),
    client.from('zonas_sucursales').select('sucursal_id').eq('zona_id', zonaId),
  ])
  if (branchResult.error) throw branchResult.error
  if (branchLinks.error) throw branchLinks.error
  if (!canViewCustomers) {
    return {
      clientes: [],
      sucursales: (branchResult.data ?? []) as ZoneAssignmentData['sucursales'],
      clienteIds: [],
      sucursalIds: (branchLinks.data ?? []).map(row => String(row.sucursal_id)),
    }
  }
  const [customerResult, customerLinks] = await Promise.all([
    client.from('clientes').select('id,codigo,razon_social,detalle,estado').order('razon_social'),
    client.from('zonas_clientes').select('cliente_id').eq('zona_id', zonaId),
  ])
  if (customerResult.error) throw customerResult.error
  if (customerLinks.error) throw customerLinks.error
  return {
    clientes: (customerResult.data ?? []) as ZoneAssignmentData['clientes'],
    sucursales: (branchResult.data ?? []) as ZoneAssignmentData['sucursales'],
    clienteIds: (customerLinks.data ?? []).map(row => String(row.cliente_id)),
    sucursalIds: (branchLinks.data ?? []).map(row => String(row.sucursal_id)),
  }
}

export async function setZoneCustomerAssignment(zonaId: string, clienteId: string, assigned: boolean): Promise<void> {
  const relation = requireSupabase().from('zonas_clientes')
  const result = assigned
    ? await relation.upsert({ zona_id: zonaId, cliente_id: clienteId }, { onConflict: 'zona_id,cliente_id', ignoreDuplicates: true })
    : await relation.delete().eq('zona_id', zonaId).eq('cliente_id', clienteId)
  if (result.error) throw result.error
}

export async function setZoneBranchAssignment(zonaId: string, sucursalId: string, assigned: boolean): Promise<void> {
  const relation = requireSupabase().from('zonas_sucursales')
  const result = assigned
    ? await relation.upsert({ zona_id: zonaId, sucursal_id: sucursalId }, { onConflict: 'zona_id,sucursal_id', ignoreDuplicates: true })
    : await relation.delete().eq('zona_id', zonaId).eq('sucursal_id', sucursalId)
  if (result.error) throw result.error
}

export async function fetchLegacyStockProducts(): Promise<LegacyStockProduct[]> {
  const { data, error } = await requireSupabase()
    .from('productos')
    .select('id,codigo,nombre,stock')
    .order('codigo')
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: String(row.id),
    codigo: String(row.codigo),
    nombre: String(row.nombre),
    stock: Number(row.stock ?? 0),
  }))
}

export async function fetchInventoryOpening(): Promise<InventoryOpening | null> {
  const { data, error } = await requireSupabase()
    .from('aperturas_inventario')
    .select('id,cantidad_productos,cantidad_unidades,cantidad_asignaciones,created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    id: String(data.id),
    cantidad_productos: Number(data.cantidad_productos ?? 0),
    cantidad_unidades: Number(data.cantidad_unidades ?? 0),
    cantidad_asignaciones: Number(data.cantidad_asignaciones ?? 0),
    created_at: String(data.created_at),
  }
}

export async function registerInventoryOpening(
  allocations: Array<{ producto_id: string; almacen_id: string; cantidad: number }>,
  idempotencyKey: string,
): Promise<string> {
  const { data, error } = await requireSupabase().rpc('registrar_apertura_inventario', {
    p_asignaciones: allocations,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw error
  return String(data)
}
