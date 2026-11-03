export type TreasuryPermissionInput = {
  operation: 'sale' | 'purchase'
  editing: boolean
  status: string
  paymentMethod?: string | null
  total: number
}

/**
 * Una cuenta por cobrar/pagar derivada pertenece al documento de origen.
 * Tesorería solo se requiere para editar documentos existentes (que pueden
 * actualizar la cuenta vinculada) o para cobrar una venta inmediatamente.
 */
export function requiresTreasuryPermission(input: TreasuryPermissionInput): boolean {
  if (input.editing) return true
  if (input.operation !== 'sale' || input.status !== 'Completada' || input.total <= 0) return false
  return (input.paymentMethod ?? '').trim().toLocaleLowerCase('es') !== 'tarjeta'
}
