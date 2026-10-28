import { requireSupabase } from '../lib/supabase'

export type Seller = { id: string; codigo: string; nombre: string; estado: string }
export type CommissionRule = { id: string; nombre: string; porcentaje: number; vigente_desde: string; vigente_hasta: string | null; activa: boolean }
export type CommissionScale = { id: string; regla_id: string; desde_ventas: number; hasta_ventas: number | null; porcentaje: number }
export type CommissionException = { id: string; vendedor_id: string; porcentaje: number; vigente_desde: string; vigente_hasta: string | null; motivo: string; activa: boolean }
export type SaleAssignment = { venta_id: string; vendedor_id: string; asignado_at: string }
export type CommissionSettlement = { id: string; vendedor_id: string; periodo_desde: string; periodo_hasta: string; ventas_netas: number; comision_calculada: number; estado: 'calculada' | 'liquidada' | 'pagada'; nota: string | null; created_at: string }
export type CommissionAdjustment = { id: string; liquidacion_id: string; monto: number; motivo: string; created_at: string }
export type CommissionPayment = { id: string; liquidacion_id: string; monto: number; fecha: string; medio: string; referencia: string | null; cuenta_bancaria_id: string | null; created_at: string }
export async function fetchCommissionData(includePayments = true) {
  const client = requireSupabase()
  const [sellers, rules, scales, exceptions, assignments, settlements, adjustments, payments] = await Promise.all([
    client.from('vendedores').select('id,codigo,nombre,estado').order('nombre'),
    client.from('reglas_comision').select('*').order('vigente_desde', { ascending: false }),
    client.from('escalas_comision').select('*').order('desde_ventas'),
    client.from('excepciones_comision').select('*').order('vigente_desde', { ascending: false }),
    client.from('ventas_vendedor').select('*').order('asignado_at', { ascending: false }),
    client.from('liquidaciones_comision').select('*').order('periodo_desde', { ascending: false }),
    client.from('ajustes_comision').select('*').order('created_at', { ascending: false }),
    includePayments ? client.from('pagos_comision').select('*').order('fecha', { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ])
  for (const result of [sellers, rules, scales, exceptions, assignments, settlements, adjustments, payments]) if (result.error) throw result.error
  return {
    sellers: (sellers.data ?? []) as Seller[], rules: (rules.data ?? []) as CommissionRule[],
    scales: (scales.data ?? []) as CommissionScale[], exceptions: (exceptions.data ?? []) as CommissionException[],
    assignments: (assignments.data ?? []) as SaleAssignment[], settlements: (settlements.data ?? []) as CommissionSettlement[],
    adjustments: (adjustments.data ?? []) as CommissionAdjustment[], payments: (payments.data ?? []) as CommissionPayment[],
  }
}
export async function saveCommissionRule(input: { nombre: string; porcentaje: number; vigente_desde: string; vigente_hasta?: string }, id?: string) {
  if (!input.nombre.trim() || !Number.isFinite(input.porcentaje) || input.porcentaje < 0 || input.porcentaje > 100) throw new Error('El nombre y una tasa entre 0 y 100 % son obligatorios.')
  const payload = { nombre: input.nombre.trim(), porcentaje: input.porcentaje, vigente_desde: input.vigente_desde, vigente_hasta: input.vigente_hasta || null }
  const client = requireSupabase()
  if (!id) {
    const { error } = await client.from('reglas_comision').insert(payload)
    if (error?.code === '23505') throw new Error('Solo puede existir una regla activa; desactiva la anterior antes de crear otra.')
    if (error) throw error
    return
  }
  const { error } = await client.from('reglas_comision').update(payload).eq('id', id)
  if (error) throw error
}
export async function setRuleActive(id: string, activa: boolean) {
  const { error } = await requireSupabase().from('reglas_comision').update({ activa }).eq('id', id)
  if (error?.code === '23505') throw new Error('Desactiva la regla vigente antes de activar esta regla.')
  if (error) throw error
}
export async function saveCommissionScale(input: { regla_id: string; desde_ventas: number; hasta_ventas: number | null; porcentaje: number }, id?: string) {
  if (!input.regla_id || input.desde_ventas < 0 || (input.hasta_ventas !== null && input.hasta_ventas <= input.desde_ventas) || input.porcentaje < 0 || input.porcentaje > 100) throw new Error('Revisa los límites y la tasa de la escala.')
  const client = requireSupabase()
  const result = id ? await client.from('escalas_comision').update(input).eq('id', id) : await client.from('escalas_comision').insert(input)
  const error = result.error
  if (error?.code === '23505') throw new Error('Ya existe una escala con ese límite inicial.')
  if (error) throw error
}
export async function saveCommissionException(input: { vendedor_id: string; porcentaje: number; vigente_desde: string; vigente_hasta?: string; motivo: string }, id?: string) {
  if (!input.vendedor_id || !input.motivo.trim() || !Number.isFinite(input.porcentaje) || input.porcentaje < 0 || input.porcentaje > 100) throw new Error('Selecciona vendedor, motivo y una tasa de 0 a 100 %.')
  const payload = { ...input, motivo: input.motivo.trim(), vigente_hasta: input.vigente_hasta || null }
  const client = requireSupabase()
  const result = id ? await client.from('excepciones_comision').update(payload).eq('id', id) : await client.from('excepciones_comision').insert(payload)
  if (result.error) throw result.error
}
export async function setExceptionActive(id: string, activa: boolean) {
  const { error } = await requireSupabase().from('excepciones_comision').update({ activa }).eq('id', id)
  if (error) throw error
}
export async function assignSaleToSeller(venta_id: string, vendedor_id: string | null) {
  const client = requireSupabase()
  const result = vendedor_id
    ? await client.from('ventas_vendedor').upsert({ venta_id, vendedor_id }, { onConflict: 'venta_id' })
    : await client.from('ventas_vendedor').delete().eq('venta_id', venta_id)
  if (result.error) throw result.error
}
export async function calculateCommissions(desde: string, hasta: string) {
  const { data, error } = await requireSupabase().rpc('calcular_comisiones', { p_desde: desde, p_hasta: hasta })
  if (error) throw error
  return Number(data ?? 0)
}
export async function changeSettlementStatus(id: string, _estado: 'liquidada') {
  const { error } = await requireSupabase().rpc('liquidar_comision', { p_liquidacion_id: id })
  if (error) throw error
}
export async function addCommissionAdjustment(input: { liquidacion_id: string; monto: number; motivo: string }) {
  if (!input.liquidacion_id || !Number.isFinite(input.monto) || input.monto === 0 || !input.motivo.trim()) throw new Error('Indica un ajuste distinto de cero y explica el motivo.')
  const { error } = await requireSupabase().from('ajustes_comision').insert({ ...input, motivo: input.motivo.trim() })
  if (error) throw error
}
export async function payCommission(input: { liquidacion_id: string; monto: number; fecha: string; medio: string; referencia: string; cuenta_bancaria_id: string | null }) {
  const { data, error } = await requireSupabase().rpc('registrar_pago_comision', {
    p_liquidacion_id: input.liquidacion_id, p_monto: input.monto, p_fecha: input.fecha,
    p_medio: input.medio, p_referencia: input.referencia || null, p_cuenta_bancaria_id: input.cuenta_bancaria_id,
  })
  if (error) throw error
  return String(data)
}
export function settlementTotals(settlement: CommissionSettlement, adjustments: CommissionAdjustment[], payments: CommissionPayment[]) {
  const adjustment = adjustments.filter(item => item.liquidacion_id === settlement.id).reduce((sum, item) => sum + Number(item.monto), 0)
  const paid = payments.filter(item => item.liquidacion_id === settlement.id).reduce((sum, item) => sum + Number(item.monto), 0)
  const total = Math.round((Number(settlement.comision_calculada) + adjustment) * 100) / 100
  return { adjustments: Math.round(adjustment * 100) / 100, paid: Math.round(paid * 100) / 100, total, balance: Math.round((total - paid) * 100) / 100 }
}
