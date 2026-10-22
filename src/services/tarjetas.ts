import { requireSupabase } from '../lib/supabase'
import { validateCardInput, type CardInput, type CustomerCard } from '../data/payments'

type CardRow = { id: string; cliente_id: string; marca: string; ultimos4: string; titular: string; vence_mes: number; vence_anio: number }

const toCard = (row: CardRow): CustomerCard => ({
  id: String(row.id), clienteId: String(row.cliente_id), marca: row.marca, ultimos4: row.ultimos4,
  titular: row.titular, venceMes: Number(row.vence_mes), venceAnio: Number(row.vence_anio),
})

/** Tarjetas activas registradas en la cuenta del cliente. */
export async function fetchCustomerCards(clienteId: string): Promise<CustomerCard[]> {
  const { data, error } = await requireSupabase().from('tarjetas_cliente')
    .select('id, cliente_id, marca, ultimos4, titular, vence_mes, vence_anio')
    .eq('cliente_id', clienteId).eq('activo', true).order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as CardRow[]).map(toCard)
}

/** Agrega una tarjeta a la cuenta del cliente (solo marca, últimos 4, titular y vencimiento). */
export async function addCustomerCard(clienteId: string, input: CardInput): Promise<CustomerCard> {
  const card = validateCardInput(input)
  const { data, error } = await requireSupabase().from('tarjetas_cliente').insert({
    cliente_id: clienteId, marca: card.marca, ultimos4: card.ultimos4, titular: card.titular,
    vence_mes: card.venceMes, vence_anio: card.venceAnio,
  }).select('id, cliente_id, marca, ultimos4, titular, vence_mes, vence_anio').single()
  if (error) throw error
  return toCard(data as CardRow)
}

export async function removeCustomerCard(id: string): Promise<void> {
  const { error } = await requireSupabase().from('tarjetas_cliente').update({ activo: false }).eq('id', id)
  if (error) throw error
}
