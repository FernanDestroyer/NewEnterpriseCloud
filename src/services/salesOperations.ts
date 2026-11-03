import { requireSupabase } from '../lib/supabase'

export type SaleLine = { producto_id: string; cantidad: number; precio: number; afectacion: '10' | '20' | '30'; base?: number; igv?: number; total?: number }
export type SalesQuote = { id: string; cliente_id: string; version: number; estado: string; vence_el: string; moneda: 'PEN' | 'USD'; tipo_cambio: number; lineas: SaleLine[]; total: number }
export type SalesQuoteVersion = { cotizacion_id: string; version: number; cliente_id: string; vence_el: string; moneda: 'PEN' | 'USD'; tipo_cambio: number; lineas: SaleLine[]; total: number; created_at: string }
export type SalesOrder = { id: string; codigo: string; cliente_id: string; almacen_id: string; estado: string; moneda: 'PEN' | 'USD'; tipo_cambio: number; lineas: SaleLine[]; total: number; venta_id: string | null; cotizacion_id: string | null }
export type SalesReceipt = { id: string; venta_id: string; tipo: string; serie: string; numero: number; moneda: string; tipo_cambio: number; base: number; igv: number; total: number; created_at: string; snapshot: { cliente: string; lineas: SaleLine[] }; estado_sunat: string }
export type SalesGuide = { id: string; pedido_id: string; codigo: string; origen: string; destino: string; lineas: SaleLine[]; created_at: string }
export type SalesCredit = { id: string; pedido_id: string; codigo: string; motivo: string; total: number; lineas: Array<{ producto_id: string; cantidad: number }> }
export type SalesCatalog = { id: string; nombre: string; precio: number | null; stock: number }
export type SalesCustomer = { id: string; razon_social: string; tipo_doc: string | null; documento: string | null }
export type SalesWarehouse = { id: string; nombre: string; activo: boolean }
export type WarehouseStock = { producto_id: string; almacen_id: string; cantidad: number }
export type SalesReservation = { pedido_id: string; producto_id: string; cantidad: number; entregado: number }

async function list<T>(table: string, columns: string): Promise<T[]> {
  const sortColumns: Record<string, string[]> = {
    ec_cotizacion_versiones: ['cotizacion_id', 'version'],
    ec_reservas: ['pedido_id', 'producto_id'],
  }
  const result: T[] = []
  for (let offset = 0; ; offset += 500) {
    let query = requireSupabase().from(table).select(columns)
    for (const column of sortColumns[table] ?? ['id']) query = query.order(column)
    const { data, error } = await query.range(offset, offset + 499)
    if (error) throw error
    result.push(...((data ?? []) as T[]))
    if ((data ?? []).length < 500) return result
  }
}
export async function loadSalesOperations() {
  const [quotes, versions, orders, receipts, guides, credits, customers, products, warehouses, inventory, reservations] = await Promise.all([
    list<SalesQuote>('ec_cotizaciones', '*'), list<SalesQuoteVersion>('ec_cotizacion_versiones', '*'), list<SalesOrder>('ec_pedidos', '*'),
    list<SalesReceipt>('ec_comprobantes', '*'), list<SalesGuide>('ec_guias', '*'),
    list<SalesCredit>('ec_notas_credito', '*'), list<SalesCustomer>('clientes', 'id,razon_social,tipo_doc,documento'),
    list<SalesCatalog>('productos', 'id,nombre,precio,stock'), list<SalesWarehouse>('almacenes', 'id,nombre,activo'),
    list<WarehouseStock>('inventarios', 'producto_id,almacen_id,cantidad'),
    list<SalesReservation>('ec_reservas', 'pedido_id,producto_id,cantidad,entregado'),
  ])
  return { quotes, versions, orders, receipts, guides, credits, customers, products, warehouses: warehouses.filter(item => item.activo), inventory, reservations }
}

async function rpc(name: string, input: Record<string, unknown>): Promise<string> {
  const { data, error } = await requireSupabase().rpc(name, input)
  if (error) throw error
  return data as string
}
export const saveSalesQuote = (input: { id: string | null; cliente: string; vence: string; moneda: string; cambio: number; lineas: SaleLine[]; key: string }) => rpc('ec_guardar_cotizacion', { p_id: input.id, p_cliente_id: input.cliente, p_vence_el: input.vence, p_moneda: input.moneda, p_tipo_cambio: input.cambio, p_lineas: input.lineas, p_key: input.key })
export const createSalesOrder = (input: { cliente: string; almacen: string; moneda: string; cambio: number; lineas: SaleLine[]; key: string }) => rpc('ec_crear_pedido', { p_cliente_id: input.cliente, p_almacen_id: input.almacen, p_moneda: input.moneda, p_tipo_cambio: input.cambio, p_lineas: input.lineas, p_key: input.key })
export const convertSalesQuote = (input: { quote: string; almacen: string; tipo: string | null; serie: string | null; numero: number | null; key: string }) => rpc('ec_convertir_cotizacion', { p_cotizacion_id: input.quote, p_almacen_id: input.almacen, p_tipo: input.tipo, p_serie: input.serie, p_numero: input.numero, p_key: input.key })
export const invoiceSalesOrder = (order: string, tipo: string, serie: string, numero: number, key: string) => rpc('ec_facturar_pedido', { p_pedido_id: order, p_tipo: tipo, p_serie: serie, p_numero: numero, p_key: key })
export const cancelSalesOrder = (order: string, key: string) => rpc('ec_anular_pedido', { p_pedido_id: order, p_key: key })
export const guideSalesOrder = (order: string, origen: string, destino: string, key: string) => rpc('ec_emitir_guia', { p_pedido_id: order, p_origen: origen, p_destino: destino, p_key: key })
export const creditSalesOrder = (order: string, lines: Array<{ producto_id: string; cantidad: number }>, reason: string, stock: boolean, key: string) => rpc('ec_nota_credito', { p_pedido_id: order, p_lineas: lines, p_motivo: reason, p_devolver_stock: stock, p_key: key })

/** Saldo orientativo; la RPC de la nota vuelve a comprobar CxC y topes bajo bloqueo. */
export async function fetchSalesCreditBalance(ventaId: string): Promise<number> {
  const client = requireSupabase()
  const account = await client.from('pagos').select('id').eq('venta_id', ventaId).eq('tipo', 'cobrar').maybeSingle()
  if (account.error) throw account.error
  if (!account.data) throw new Error('No se encontró la cuenta por cobrar de esta venta.')
  const result = await client.rpc('obtener_saldos_cuentas', { p_cuenta_ids: [account.data.id] })
  if (result.error) throw result.error
  const row = (result.data as Array<{ saldo_pendiente: number }> | null)?.[0]
  if (!row) throw new Error('No se pudo consultar el saldo pendiente.')
  return Number(row.saldo_pendiente)
}
