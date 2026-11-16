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
  montoInicialUsd: number
  estado: 'Abierto' | 'Cerrado'
  cerradoEn: string | null
  conteo: Record<string, number>
  conteoUsd: number | null
  saldoEsperadoPen: number | null
  saldoEsperadoUsd: number | null
  descuadrePen: number | null
  descuadreUsd: number | null
  notas: string
}
export type CashMovement = {
  id: string
  cajaTurnoId: string
  tipo: 'cobro' | 'pago'
  monto: number
  moneda: 'PEN' | 'USD' | null
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
  monto_inicial_usd: number
  estado: string
  cerrado_en: string | null
  conteo: Record<string, number> | null
  conteo_usd: number | null
  saldo_esperado_pen: number | null
  saldo_esperado_usd: number | null
  descuadre_pen: number | null
  descuadre_usd: number | null
  notas: string | null
}

export type CashShiftCloseResult = {
  esperadoPen: number
  esperadoUsd: number
  contadoPen: number
  contadoUsd: number
  descuadrePen: number
  descuadreUsd: number
}

function toShift(row: CashRow): CashShift {
  return {
    id: String(row.id),
    cajaId: row.caja_id ? String(row.caja_id) : null,
    abiertoPor: row.abierto_por_email,
    abiertoEn: String(row.abierto_en),
    montoInicial: Number(row.monto_inicial ?? 0),
    montoInicialUsd: Number(row.monto_inicial_usd ?? 0),
    estado: row.estado === 'Cerrado' ? 'Cerrado' : 'Abierto',
    cerradoEn: row.cerrado_en ? String(row.cerrado_en) : null,
    conteo: row.conteo && typeof row.conteo === 'object' ? row.conteo as Record<string, number> : {},
    conteoUsd: row.conteo_usd == null ? null : Number(row.conteo_usd),
    saldoEsperadoPen: row.saldo_esperado_pen == null ? null : Number(row.saldo_esperado_pen),
    saldoEsperadoUsd: row.saldo_esperado_usd == null ? null : Number(row.saldo_esperado_usd),
    descuadrePen: row.descuadre_pen == null ? null : Number(row.descuadre_pen),
    descuadreUsd: row.descuadre_usd == null ? null : Number(row.descuadre_usd),
    notas: row.notas ?? '',
  }
}

const SHIFT_COLUMNS = 'id, caja_id, abierto_por_email, abierto_en, monto_inicial, monto_inicial_usd, estado, cerrado_en, conteo, conteo_usd, saldo_esperado_pen, saldo_esperado_usd, descuadre_pen, descuadre_usd, notas'

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
    .select('id,caja_turno_id,tipo,monto,moneda,medio_pago,referencia,created_at,anulado_en')
    .in('caja_turno_id', unique).order('created_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as Array<{ id: string; caja_turno_id: string; tipo: string; monto: number; moneda: string | null; medio_pago: string | null; referencia: string | null; created_at: string; anulado_en: string | null }>).map(row => ({
    id: String(row.id), cajaTurnoId: String(row.caja_turno_id), tipo: row.tipo === 'pago' ? 'pago' : 'cobro',
    monto: Number(row.monto), moneda: row.moneda === 'PEN' || row.moneda === 'USD' ? row.moneda : null,
    medioPago: row.medio_pago ?? 'Efectivo', referencia: row.referencia,
    createdAt: String(row.created_at), anuladoEn: row.anulado_en ? String(row.anulado_en) : null,
  }))
}

export async function openCashShift(cajaId: string, montoInicialPen: number, montoInicialUsd: number): Promise<string> {
  const inicialPen = Math.round(Number(montoInicialPen) * 100) / 100
  const inicialUsd = Math.round(Number(montoInicialUsd) * 100) / 100
  if (!cajaId) throw new Error('Selecciona una caja registrada antes de abrir el turno.')
  if (!Number.isFinite(inicialPen) || inicialPen < 0 || !Number.isFinite(inicialUsd) || inicialUsd < 0) throw new Error('Los montos iniciales deben ser cero o mayores.')
  const { data, error } = await requireSupabase().rpc('abrir_turno_caja_v1', {
    p_caja_id: cajaId,
    p_monto_inicial_pen: inicialPen,
    p_monto_inicial_usd: inicialUsd,
  })
  if (error?.code === '23505') throw new Error('Esta caja ya tiene un turno abierto. Actualiza la página para ver quién lo abrió.')
  if (error) throw error
  if (typeof data !== 'string' || !data) throw new Error('No se recibió el identificador del turno creado.')
  return data
}

export async function closeCashShift(id: string, conteoPen: number, conteoUsd: number, notas: string): Promise<CashShiftCloseResult> {
  const pen = Math.round(Number(conteoPen) * 100) / 100
  const usd = Math.round(Number(conteoUsd) * 100) / 100
  if (!id || !Number.isFinite(pen) || pen < 0 || !Number.isFinite(usd) || usd < 0) throw new Error('El turno y los conteos de ambas monedas deben ser válidos.')
  const { data, error } = await requireSupabase().rpc('cerrar_turno_caja_v1', {
    p_caja_turno_id: id,
    p_conteo_pen: pen,
    p_conteo_usd: usd,
    p_notas: notas.trim(),
  })
  if (error) throw error
  if (!data || typeof data !== 'object') throw new Error('No se recibió el resultado del cierre. Actualiza la pantalla para confirmar el estado.')
  const row = data as Record<string, unknown>
  const values = [row.esperado_pen, row.esperado_usd, row.contado_pen, row.contado_usd, row.descuadre_pen, row.descuadre_usd].map(Number)
  if (values.some(value => !Number.isFinite(value))) throw new Error('El servidor cerró el turno, pero no devolvió un resultado de arqueo válido. Actualiza la pantalla.')
  return {
    esperadoPen: values[0]!, esperadoUsd: values[1]!, contadoPen: values[2]!,
    contadoUsd: values[3]!, descuadrePen: values[4]!, descuadreUsd: values[5]!,
  }
}
