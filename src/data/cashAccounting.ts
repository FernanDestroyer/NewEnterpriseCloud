export type CashCurrency = 'PEN' | 'USD'

export type CashLedgerMovement = {
  tipo: 'cobro' | 'pago'
  monto: number
  moneda: string | null
  medioPago: string | null
  anuladoEn: string | null
}

export type CashCurrencyTotals = Record<CashCurrency, {
  cobros: number
  pagos: number
  neto: number
  cantidad: number
}>

export type CashShiftExpected = {
  PEN: number
  USD: number
  monedaDesconocida: number
}

function isCash(movement: CashLedgerMovement): boolean {
  return movement.medioPago?.trim().toLocaleLowerCase('es') === 'efectivo'
}

function normalizedCurrency(value: string | null): CashCurrency | null {
  const currency = value?.trim().toUpperCase()
  return currency === 'PEN' || currency === 'USD' ? currency : null
}

export function cashCurrencyTotals(movements: CashLedgerMovement[]): CashCurrencyTotals {
  const totals: CashCurrencyTotals = {
    PEN: { cobros: 0, pagos: 0, neto: 0, cantidad: 0 },
    USD: { cobros: 0, pagos: 0, neto: 0, cantidad: 0 },
  }

  for (const movement of movements) {
    if (movement.anuladoEn || !isCash(movement)) continue
    const currency = normalizedCurrency(movement.moneda)
    if (!currency || !Number.isFinite(movement.monto) || movement.monto < 0) continue
    const row = totals[currency]
    const amount = Math.round(movement.monto * 100) / 100
    if (movement.tipo === 'cobro') {
      row.cobros = Math.round((row.cobros + amount) * 100) / 100
      row.neto = Math.round((row.neto + amount) * 100) / 100
    } else {
      row.pagos = Math.round((row.pagos + amount) * 100) / 100
      row.neto = Math.round((row.neto - amount) * 100) / 100
    }
    row.cantidad += 1
  }
  return totals
}

export function expectedCashByCurrency(
  opening: { pen: number; usd: number },
  movements: CashLedgerMovement[],
): CashShiftExpected {
  const totals = cashCurrencyTotals(movements)
  const unknown = movements.filter(movement =>
    !movement.anuladoEn && isCash(movement) && !normalizedCurrency(movement.moneda),
  ).length
  const pen = Number.isFinite(opening.pen) ? opening.pen : 0
  const usd = Number.isFinite(opening.usd) ? opening.usd : 0
  return {
    PEN: Math.round((pen + totals.PEN.neto) * 100) / 100,
    USD: Math.round((usd + totals.USD.neto) * 100) / 100,
    monedaDesconocida: unknown,
  }
}

export function hasUnreconciledHistoricalCashClose(
  estado: 'Abierto' | 'Cerrado',
  conteoUsd: number | null,
  movements: CashLedgerMovement[],
): boolean {
  return estado === 'Cerrado'
    && conteoUsd === null
    && movements.some(movement => !movement.anuladoEn && isCash(movement) && normalizedCurrency(movement.moneda) === 'USD')
}
