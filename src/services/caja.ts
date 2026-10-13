import { requireSupabase } from '../lib/supabase'

export type CashShift = {
  id: string
  abiertoPor: string | null
  abiertoEn: string
  montoInicial: number
  estado: 'Abierto' | 'Cerrado'
  cerradoEn: string | null
  conteo: Record<string, number>
  notas: string
}

type CashRow = {
  id: string
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
    abiertoPor: row.abierto_por_email,
    abiertoEn: String(row.abierto_en),
    montoInicial: Number(row.monto_inicial ?? 0),
    estado: row.estado === 'Cerrado' ? 'Cerrado' : 'Abierto',
    cerradoEn: row.cerrado_en ? String(row.cerrado_en) : null,
    conteo: row.conteo && typeof row.conteo === 'object' ? row.conteo as Record<string, number> : {},
    notas: row.notas ?? '',
  }
}

export async function fetchCashShifts(limit = 20): Promise<CashShift[]> {
  const { data, error } = await requireSupabase()
    .from('caja_turnos')
    .select('id, abierto_por_email, abierto_en, monto_inicial, estado, cerrado_en, conteo, notas')
    .order('abierto_en', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as CashRow[]).map(toShift)
}

export async function openCashShift(montoInicial: number, email: string | null): Promise<CashShift> {
  const inicial = Math.round(Number(montoInicial) * 100) / 100
  if (!Number.isFinite(inicial) || inicial < 0) throw new Error('El monto inicial debe ser cero o mayor.')
  const client = requireSupabase()
  const { data: open, error: openError } = await client
    .from('caja_turnos')
    .select('id')
    .eq('estado', 'Abierto')
    .limit(1)
  if (openError) throw openError
  if ((open as Array<{ id: string }> | null)?.length) throw new Error('Ya hay un turno abierto. Ciérralo antes de abrir otro.')
  const { data, error } = await client
    .from('caja_turnos')
    .insert({ abierto_por_email: email, monto_inicial: inicial, estado: 'Abierto', conteo: {}, notas: '' })
    .select('id, abierto_por_email, abierto_en, monto_inicial, estado, cerrado_en, conteo, notas')
    .single()
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
  const { data, error } = await requireSupabase()
    .from('caja_turnos')
    .update({ estado: 'Cerrado', cerrado_en: new Date().toISOString(), conteo: clean, notas: notas.trim() })
    .eq('id', id)
    .eq('estado', 'Abierto')
    .select('id, abierto_por_email, abierto_en, monto_inicial, estado, cerrado_en, conteo, notas')
    .single()
  if (error) throw error
  if (!data) throw new Error('El turno ya está cerrado o no existe.')
  return toShift(data as CashRow)
}
