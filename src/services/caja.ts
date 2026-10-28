import { requireSupabase } from '../lib/supabase'

export type CashBranch = { id: string; nombre: string; codigo: string }
export type CashBox = {
  id: string
  sucursalId: string
  codigo: string
  nombre: string
  ubicacion: string | null
  activo: boolean
}
export type CashSetup = { branches: CashBranch[]; boxes: CashBox[] }
export type CashShift = {
  id: string
  cajaId: string | null
  abiertoPor: string | null
  abiertoEn: string
  montoInicial: number
  estado: 'Abierto' | 'Cerrado'
  cerradoEn: string | null
  conteo: Record<string, number>
  notas: string
}
export type CashMovement = {
  id: string
  cajaTurnoId: string
  tipo: 'cobro' | 'pago'
  monto: number
  medioPago: string
  referencia: string | null
  createdAt: string
  anuladoEn: string | null
}

type CashRow = {
  id: string
  caja_id: string | null
  abierto_por_email: string | null
  abierto_en: string
  monto_inicial: number
  estado: string
  cerrado_en: string | null
  conteo: Record<string, number> | null
  notas: string | null
}

function toShift(row: CashRow): CashShift {
  return {
    id: String(row.id),
    cajaId: row.caja_id ? String(row.caja_id) : null,
    abiertoPor: row.abierto_por_email,
    abiertoEn: String(row.abierto_en),
    montoInicial: Number(row.monto_inicial ?? 0),
    estado: row.estado === 'Cerrado' ? 'Cerrado' : 'Abierto',
    cerradoEn: row.cerrado_en ? String(row.cerrado_en) : null,
    conteo: row.conteo && typeof row.conteo === 'object' ? row.conteo as Record<string, number> : {},
    notas: row.notas ?? '',
  }
}

const SHIFT_COLUMNS = 'id, caja_id, abierto_por_email, abierto_en, monto_inicial, estado, cerrado_en, conteo, notas'

export async function fetchCashSetup(): Promise<CashSetup> {
  const client = requireSupabase()
  const [branchResult, boxResult] = await Promise.all([
    client.from('sucursales').select('id,nombre,codigo').eq('estado', 'Activo').order('nombre'),
    client.from('cajas').select('id,sucursal_id,codigo,nombre,ubicacion,activo').order('nombre'),
  ])
  if (branchResult.error) throw branchResult.error
  if (boxResult.error) throw boxResult.error
  return {
    branches: ((branchResult.data ?? []) as Array<{ id: string; nombre: string; codigo: string }>).map(row => ({ id: String(row.id), nombre: row.nombre, codigo: row.codigo })),
    boxes: ((boxResult.data ?? []) as Array<{ id: string; sucursal_id: string; codigo: string; nombre: string; ubicacion: string | null; activo: boolean }>).map(row => ({
      id: String(row.id), sucursalId: String(row.sucursal_id), codigo: row.codigo, nombre: row.nombre,
      ubicacion: row.ubicacion, activo: Boolean(row.activo),
    })),
  }
}

export async function createCashBox(input: { sucursalId: string; codigo: string; nombre: string; ubicacion?: string }): Promise<CashBox> {
  const codigo = input.codigo.trim().toLocaleUpperCase('es')
  const nombre = input.nombre.trim()
  if (!input.sucursalId) throw new Error('Selecciona la sucursal de esta caja.')
  if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(codigo)) throw new Error('El código debe tener de 2 a 20 caracteres: letras, números, guion o guion bajo.')
  if (nombre.length < 2 || nombre.length > 120) throw new Error('El nombre de caja debe tener entre 2 y 120 caracteres.')
  const { data, error } = await requireSupabase().from('cajas')
    .insert({ sucursal_id: input.sucursalId, codigo, nombre, ubicacion: input.ubicacion?.trim() || null })
    .select('id,sucursal_id,codigo,nombre,ubicacion,activo').single()
  if (error?.code === '23505') throw new Error('Ya existe una caja con ese código en la sucursal.')
  if (error) throw error
  const row = data as { id: string; sucursal_id: string; codigo: string; nombre: string; ubicacion: string | null; activo: boolean }
  return { id: String(row.id), sucursalId: String(row.sucursal_id), codigo: row.codigo, nombre: row.nombre, ubicacion: row.ubicacion, activo: row.activo }
}

export async function getOpenCashShifts(cajaId?: string | null): Promise<CashShift[]> {
  let query = requireSupabase().from('caja_turnos').select(SHIFT_COLUMNS).eq('estado', 'Abierto').order('abierto_en', { ascending: false })
  if (cajaId !== undefined) query = cajaId === null ? query.is('caja_id', null) : query.eq('caja_id', cajaId)
  const { data, error } = await query
  if (error) throw error
  return ((data ?? []) as CashRow[]).map(toShift)
}

/** Devuelve el turno si la selección es inequívoca; nunca elige una caja arbitraria. */
export async function getOpenCashShift(cajaId?: string | null): Promise<CashShift | null> {
  const open = await getOpenCashShifts(cajaId)
  return open.length === 1 ? open[0] : null
}

export async function fetchCashShifts(limit = 100): Promise<CashShift[]> {
  const { data, error } = await requireSupabase().from('caja_turnos').select(SHIFT_COLUMNS).order('abierto_en', { ascending: false }).limit(limit)
  if (error) throw error
  return ((data ?? []) as CashRow[]).map(toShift)
}

export async function fetchCashMovements(shiftIds: string[]): Promise<CashMovement[]> {
  const unique = [...new Set(shiftIds.filter(Boolean))]
  if (!unique.length) return []
  const { data, error } = await requireSupabase().from('movimientos_tesoreria')
    .select('id,caja_turno_id,tipo,monto,medio_pago,referencia,created_at,anulado_en')
    .in('caja_turno_id', unique).order('created_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as Array<{ id: string; caja_turno_id: string; tipo: string; monto: number; medio_pago: string | null; referencia: string | null; created_at: string; anulado_en: string | null }>).map(row => ({
    id: String(row.id), cajaTurnoId: String(row.caja_turno_id), tipo: row.tipo === 'pago' ? 'pago' : 'cobro',
    monto: Number(row.monto), medioPago: row.medio_pago ?? 'Efectivo', referencia: row.referencia,
    createdAt: String(row.created_at), anuladoEn: row.anulado_en ? String(row.anulado_en) : null,
  }))
}

export async function openCashShift(cajaId: string, montoInicial: number, email: string | null): Promise<CashShift> {
  const inicial = Math.round(Number(montoInicial) * 100) / 100
  if (!cajaId) throw new Error('Selecciona una caja registrada antes de abrir el turno.')
  if (!Number.isFinite(inicial) || inicial < 0) throw new Error('El monto inicial debe ser cero o mayor.')
  const client = requireSupabase()
  const { data: open, error: openError } = await client.from('caja_turnos').select('id').eq('estado', 'Abierto').eq('caja_id', cajaId).limit(1)
  if (openError) throw openError
  if ((open as Array<{ id: string }> | null)?.length) throw new Error('Esta caja ya tiene un turno abierto. Ciérralo antes de abrir otro.')
  const { data, error } = await client.from('caja_turnos')
    .insert({ caja_id: cajaId, abierto_por_email: email, monto_inicial: inicial, estado: 'Abierto', conteo: {}, notas: '' })
    .select(SHIFT_COLUMNS).single()
  if (error?.code === '23505') throw new Error('Esta caja ya tiene un turno abierto. Actualiza la página para ver quién lo abrió.')
  if (error) throw error
  return toShift(data as CashRow)
}

export async function closeCashShift(id: string, conteo: Record<string, number>, notas: string): Promise<CashShift> {
  const clean: Record<string, number> = {}
  for (const [medio, monto] of Object.entries(conteo)) {
    const value = Math.round(Number(monto) * 100) / 100
    if (!Number.isFinite(value) || value < 0) throw new Error(`El conteo de ${medio} debe ser cero o mayor.`)
    if (value > 0) clean[medio.trim() || 'Efectivo'] = value
  }
  const { data, error } = await requireSupabase().from('caja_turnos')
    .update({ estado: 'Cerrado', cerrado_en: new Date().toISOString(), conteo: clean, notas: notas.trim() })
    .eq('id', id).eq('estado', 'Abierto').select(SHIFT_COLUMNS).single()
  if (error?.code === 'PGRST116') throw new Error('El turno ya fue cerrado o dejó de estar disponible. Actualiza la página.')
  if (error) throw error
  if (!data) throw new Error('El turno ya está cerrado o no existe.')
  return toShift(data as CashRow)
}
