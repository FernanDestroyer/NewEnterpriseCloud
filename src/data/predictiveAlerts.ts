// Alertas predictivas de inventario (lógica pura, sin Supabase ni React).
//
// Modelo V1: suavizado exponencial (EWMA) de la salida diaria de cada producto,
// proyectado contra la existencia actual para estimar cuántos días faltan para
// agotarla. Es un modelo estadístico explicable, NO una red neuronal; el
// contrato `PredictiveAlertInput` y el registro de proveedores de
// `services/predictiveAlerts.ts` permiten enchufar una red neuronal después sin
// tocar el Centro de Alertas.

export type PredictiveSeverity = 'critical' | 'warning' | 'info'

export type PredictiveAlertInput = {
  fuente: 'predictive'
  clave_fuente: string
  referencia: string
  titulo: string
  detalle: string
  severidad: PredictiveSeverity
}

export type OutflowMovement = { producto_id: string | null; tipo: string; cantidad: number; created_at: string }
export type PredictiveProduct = { productId: string; code: string; name: string; stock: number }

export type PredictiveOptions = {
  /** Fecha de negocio de hoy (AAAA-MM-DD). El consumo se mide hasta ayer (hoy está incompleto). */
  today: string
  /** Convierte un instante ISO en fecha de negocio (por defecto, los 10 primeros caracteres). */
  dayOf?: (iso: string) => string
  windowDays?: number
  minActiveDays?: number
  criticalDays?: number
  warningDays?: number
  alpha?: number
  maxAlerts?: number
}

export const PREDICTIVE_MODEL_ID = 'ewma-v1'
export const PREDICTIVE_MODEL_LABEL = 'Modelo estadístico (suavizado exponencial)'
export const PREDICTIVE_DEFAULTS = { windowDays: 28, minActiveDays: 3, criticalDays: 7, warningDays: 14, alpha: 0.3, maxAlerts: 300 } as const

function addDays(day: string, delta: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, date + delta))
  return value.toISOString().slice(0, 10)
}

/** Suavizado exponencial sobre una serie en orden cronológico. */
export function ewma(series: number[], alpha: number): number {
  if (!series.length) return 0
  let level = series[0]
  for (let index = 1; index < series.length; index += 1) level = alpha * series[index] + (1 - alpha) * level
  return level
}

export function confidenceLabel(activeDays: number, windowDays: number): 'baja' | 'media' | 'alta' {
  if (activeDays >= Math.ceil(windowDays * 0.5)) return 'alta'
  if (activeDays >= 7) return 'media'
  return 'baja'
}

/**
 * Devuelve las alertas de quiebre de stock previsto, de la más urgente a la menos urgente.
 * Solo se consideran salidas (ventas/consumos): ajustes y transferencias distorsionan la demanda.
 */
export function buildPredictiveAlerts(products: PredictiveProduct[], movements: OutflowMovement[], options: PredictiveOptions): PredictiveAlertInput[] {
  const windowDays = options.windowDays ?? PREDICTIVE_DEFAULTS.windowDays
  const minActiveDays = options.minActiveDays ?? PREDICTIVE_DEFAULTS.minActiveDays
  const criticalDays = options.criticalDays ?? PREDICTIVE_DEFAULTS.criticalDays
  const warningDays = options.warningDays ?? PREDICTIVE_DEFAULTS.warningDays
  const alpha = options.alpha ?? PREDICTIVE_DEFAULTS.alpha
  const maxAlerts = options.maxAlerts ?? PREDICTIVE_DEFAULTS.maxAlerts
  const dayOf = options.dayOf ?? ((iso: string) => iso.slice(0, 10))

  // La ventana termina AYER: el día en curso está incompleto y, contado como 0, rebajaría el consumo real.
  const firstDay = addDays(options.today, -windowDays)
  const dayIndex = new Map<string, number>()
  for (let offset = 0; offset < windowDays; offset += 1) dayIndex.set(addDays(firstDay, offset), offset)

  const seriesByProduct = new Map<string, number[]>()
  for (const movement of movements) {
    if (movement.tipo !== 'salida' || !movement.producto_id) continue
    const quantity = Math.abs(Number(movement.cantidad))
    if (!Number.isFinite(quantity) || quantity === 0) continue
    const index = dayIndex.get(dayOf(movement.created_at))
    if (index === undefined) continue
    let series = seriesByProduct.get(movement.producto_id)
    if (!series) { series = new Array<number>(windowDays).fill(0); seriesByProduct.set(movement.producto_id, series) }
    series[index] += quantity
  }

  const alerts: Array<{ days: number; alert: PredictiveAlertInput }> = []
  for (const product of products) {
    const series = seriesByProduct.get(product.productId)
    if (!series) continue
    const activeDays = series.filter(value => value > 0).length
    if (activeDays < minActiveDays) continue
    const rate = ewma(series, alpha)
    if (!(rate > 0)) continue
    const stock = Math.max(0, Number(product.stock) || 0)
    const daysOfCover = stock / rate
    const severity: PredictiveSeverity | null = daysOfCover <= criticalDays ? 'critical' : daysOfCover <= warningDays ? 'warning' : null
    if (!severity) continue

    const wholeDays = Math.floor(daysOfCover)
    const stockoutDay = addDays(options.today, wholeDays)
    const reorder = Math.max(0, Math.ceil(rate * 30 - stock))
    const when = stock <= 0 ? 'sin stock con demanda activa' : wholeDays === 0 ? 'se agotaría hoy' : `se agotaría en ~${wholeDays} día${wholeDays === 1 ? '' : 's'}`
    const detail = [
      `${stock} u. en stock`,
      `consumo ~${rate.toFixed(1)}/día`,
      stock > 0 ? `agota ~${stockoutDay}` : null,
      reorder > 0 ? `reponer ~${reorder} u. para 30 días` : null,
      `confianza ${confidenceLabel(activeDays, windowDays)}`,
      PREDICTIVE_MODEL_LABEL,
    ].filter(Boolean).join(' · ')
    alerts.push({
      days: daysOfCover,
      alert: {
        fuente: 'predictive',
        clave_fuente: `stockout:${product.productId}`,
        referencia: product.code,
        titulo: `${product.name}: ${when}`.slice(0, 180),
        detalle: detail.slice(0, 500),
        severidad: severity,
      },
    })
  }
  return alerts.sort((a, b) => a.days - b.days).slice(0, maxAlerts).map(item => item.alert)
}
