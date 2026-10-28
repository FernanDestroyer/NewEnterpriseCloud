import { requireSupabase } from '../lib/supabase'

export type BankAccount = {
  id: string; nombre: string; banco: string; moneda: string; numero_enmascarado: string
  titular: string | null; saldo_inicial: number; fecha_saldo: string; activa: boolean
}
export type BankMovement = {
  id: string; cuenta_bancaria_id: string; tipo: 'ingreso' | 'egreso' | 'transferencia_entrada' | 'transferencia_salida'
  concepto: string; monto: number; fecha: string; referencia: string | null; nota: string | null; transferencia_id: string | null; created_at: string
}
export type BankReconciliation = {
  id: string; cuenta_bancaria_id: string; periodo_desde: string; periodo_hasta: string
  saldo_extracto: number; estado: 'abierta' | 'cerrada'; nota: string | null; created_at: string
}
export type BankStatementLine = {
  id: string; conciliacion_id: string; fecha: string; descripcion: string; referencia: string | null
  monto_firmado: number; movimiento_bancario_id: string | null
}
export type AppliedMoneyMovement = {
  id: string; tipo: 'cobro' | 'pago'; monto: number; medio_pago: string | null
  referencia: string | null; nota: string | null; created_at: string
}
async function fetchAllPages<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999)
    if (error) throw error
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < 1000) return rows
  }
}
export async function fetchTreasuryData() {
  const client = requireSupabase()
  const [accounts, reconciliations, lines, appliedMovements] = await Promise.all([
    client.from('cuentas_bancarias').select('*').order('nombre'),
    fetchAllPages<BankReconciliation>((from, to) => client.from('conciliaciones_bancarias').select('*').order('created_at', { ascending: false }).order('id').range(from, to)),
    fetchAllPages<BankStatementLine>((from, to) => client.from('lineas_extracto_bancario').select('*').order('fecha', { ascending: false }).order('id').range(from, to)),
    fetchAllPages<AppliedMoneyMovement>((from, to) => client.from('movimientos_tesoreria').select('id,tipo,monto,medio_pago,referencia,nota,created_at').is('anulado_en', null).order('created_at', { ascending: false }).order('id').range(from, to)),
  ])
  if (accounts.error) throw accounts.error
  const movements = await fetchAllPages<BankMovement>((from, to) => client.from('movimientos_bancarios').select('*').order('fecha', { ascending: false }).order('created_at', { ascending: false }).order('id').range(from, to))
  return {
    accounts: (accounts.data ?? []) as BankAccount[], movements,
    reconciliations, lines, appliedMovements,
  }
}
export async function saveBankAccount(input: { nombre: string; banco: string; moneda: string; numero_enmascarado: string; titular: string; saldo_inicial: number; fecha_saldo: string }, id?: string) {
  const payload = {
    nombre: input.nombre.trim(), banco: input.banco.trim(), moneda: input.moneda.trim().toUpperCase(),
    numero_enmascarado: input.numero_enmascarado.trim(), titular: input.titular.trim() || null,
    saldo_inicial: Math.round(input.saldo_inicial * 100) / 100, fecha_saldo: input.fecha_saldo,
  }
  if (!payload.nombre || !payload.banco || payload.numero_enmascarado.length < 4 || !Number.isFinite(payload.saldo_inicial)) throw new Error('Completa banco, nombre, número de cuenta y saldo inicial válido.')
  const client = requireSupabase()
  const result = id ? await client.from('cuentas_bancarias').update(payload).eq('id', id) : await client.from('cuentas_bancarias').insert(payload)
  if (result.error) throw result.error
}
export async function toggleBankAccount(id: string, activa: boolean) {
  const { error } = await requireSupabase().from('cuentas_bancarias').update({ activa }).eq('id', id)
  if (error) throw error
}
export async function saveBankMovement(input: { cuenta_bancaria_id: string; tipo: 'ingreso' | 'egreso'; concepto: string; monto: number; fecha: string; referencia: string; nota: string }) {
  const payload = { ...input, concepto: input.concepto.trim(), monto: Math.round(input.monto * 100) / 100, referencia: input.referencia.trim() || null, nota: input.nota.trim() || null }
  if (!payload.cuenta_bancaria_id || !payload.concepto || !payload.fecha || !Number.isFinite(payload.monto) || payload.monto <= 0) throw new Error('Cuenta, concepto, fecha e importe mayor que cero son obligatorios.')
  const { error } = await requireSupabase().from('movimientos_bancarios').insert(payload)
  if (error) throw error
}
export async function transferBankFunds(input: { origen: string; destino: string; monto: number; fecha: string; referencia: string }) {
  const { data, error } = await requireSupabase().rpc('registrar_transferencia_bancaria', {
    p_origen: input.origen, p_destino: input.destino, p_monto: input.monto,
    p_fecha: input.fecha, p_referencia: input.referencia || null,
  })
  if (error) throw error
  return String(data)
}
export async function createReconciliation(input: { cuenta_bancaria_id: string; periodo_desde: string; periodo_hasta: string; saldo_extracto: number; nota: string }) {
  const payload = { ...input, saldo_extracto: Math.round(input.saldo_extracto * 100) / 100, nota: input.nota.trim() || null }
  if (!payload.cuenta_bancaria_id || payload.periodo_hasta < payload.periodo_desde || !Number.isFinite(payload.saldo_extracto)) throw new Error('Selecciona cuenta, período válido y saldo final del extracto.')
  const { data, error } = await requireSupabase().from('conciliaciones_bancarias').insert(payload).select('id').single()
  if (error) throw error
  return String(data.id)
}
export async function addStatementLine(input: { conciliacion_id: string; fecha: string; descripcion: string; referencia: string; monto_firmado: number }) {
  const payload = { ...input, descripcion: input.descripcion.trim(), referencia: input.referencia.trim() || null, monto_firmado: Math.round(input.monto_firmado * 100) / 100 }
  if (!payload.conciliacion_id || !payload.fecha || !payload.descripcion || !Number.isFinite(payload.monto_firmado) || payload.monto_firmado === 0) throw new Error('Fecha, descripción e importe firmado (distinto de cero) son obligatorios.')
  const { error } = await requireSupabase().from('lineas_extracto_bancario').insert(payload)
  if (error) throw error
}
export async function matchStatementLine(lineId: string, movementId: string | null) {
  const { error } = await requireSupabase().rpc('conciliar_linea_extracto', { p_linea_id: lineId, p_movimiento_id: movementId })
  if (error?.code === '23505') throw new Error('Ese movimiento bancario ya está conciliado con otra línea.')
  if (error?.code === '23514') throw new Error(error.message || 'El movimiento debe coincidir con la línea del extracto.')
  if (error) throw error
}
export async function closeReconciliation(id: string, closed: boolean) {
  const { error } = await requireSupabase().rpc('actualizar_estado_conciliacion', { p_conciliacion_id: id, p_estado: closed ? 'cerrada' : 'abierta' })
  if (error?.code === '23514') throw new Error(error.message || 'No se puede cerrar la conciliación mientras haya diferencias.')
  if (error) throw error
}
export function movementSignedAmount(movement: BankMovement) {
  return movement.tipo === 'ingreso' || movement.tipo === 'transferencia_entrada' ? Number(movement.monto) : -Number(movement.monto)
}
export function accountBalance(account: BankAccount, movements: BankMovement[]) {
  const amount = movements.filter(item => item.cuenta_bancaria_id === account.id && item.fecha >= account.fecha_saldo)
    .reduce((sum, item) => sum + movementSignedAmount(item), Number(account.saldo_inicial))
  return Math.round(amount * 100) / 100
}
