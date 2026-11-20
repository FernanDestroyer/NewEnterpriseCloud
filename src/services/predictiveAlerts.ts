import { requireSupabase } from '../lib/supabase'
import { businessDate } from '../data/businessCalendar'
import {
  buildPredictiveAlerts, PREDICTIVE_DEFAULTS, PREDICTIVE_MODEL_ID, PREDICTIVE_MODEL_LABEL,
  type OutflowMovement, type PredictiveAlertInput, type PredictiveProduct,
} from '../data/predictiveAlerts'

export type { PredictiveAlertInput, PredictiveProduct } from '../data/predictiveAlerts'

/** Datos que reciben todos los proveedores de predicción. */
export type PredictiveContext = {
  products: PredictiveProduct[]
  movements: OutflowMovement[]
  today: string
}

/**
 * Contrato para conectar una fuente de predicciones (modelo estadístico, red neuronal, servicio externo…).
 * `run` devuelve alertas con `fuente: 'predictive'`; las claves (`clave_fuente`) deben ser estables para que
 * la bandeja actualice en vez de duplicar. Un proveedor que falle no impide que los demás se muestren.
 * Los servicios externos deben invocarse desde una Edge Function: nunca poner claves en el navegador.
 */
export type PredictiveAlertProvider = {
  id: string
  label: string
  kind: 'statistical' | 'neural' | 'external'
  run: (context: PredictiveContext) => Promise<PredictiveAlertInput[]>
}

export const statisticalStockoutProvider: PredictiveAlertProvider = {
  id: PREDICTIVE_MODEL_ID,
  label: PREDICTIVE_MODEL_LABEL,
  kind: 'statistical',
  run: async context => buildPredictiveAlerts(context.products, context.movements, {
    today: context.today,
    dayOf: iso => businessDate(new Date(iso)),
  }),
}

const providers: PredictiveAlertProvider[] = [statisticalStockoutProvider]

export function registerPredictiveProvider(provider: PredictiveAlertProvider): () => void {
  if (providers.some(item => item.id === provider.id)) throw new Error(`Ya existe un proveedor de predicciones con id "${provider.id}".`)
  providers.push(provider)
  return () => { const index = providers.indexOf(provider); if (index >= 0) providers.splice(index, 1) }
}

export function listPredictiveProviders(): readonly PredictiveAlertProvider[] { return providers }

export type PredictiveRun = { alerts: PredictiveAlertInput[]; failures: Array<{ provider: string; message: string }>; truncated: boolean }

/** Salidas de los últimos `windowDays` días (paginado). `truncated` avisa si se alcanzó el tope de lectura. */
export async function fetchRecentOutflows(windowDays: number = PREDICTIVE_DEFAULTS.windowDays): Promise<{ rows: OutflowMovement[]; truncated: boolean }> {
  const client = requireSupabase()
  const since = new Date(Date.now() - (windowDays + 1) * 86_400_000).toISOString()
  const pageSize = 1000
  const maxPages = 20
  const rows: OutflowMovement[] = []
  for (let page = 0; page < maxPages; page += 1) {
    const { data, error } = await client.from('movimientos_inventario')
      .select('producto_id,tipo,cantidad,created_at')
      .eq('tipo', 'salida').gte('created_at', since)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1)
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as OutflowMovement[]
    rows.push(...batch)
    if (batch.length < pageSize) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

export async function runPredictiveProviders(context: PredictiveContext, truncated = false): Promise<PredictiveRun> {
  const alerts = new Map<string, PredictiveAlertInput>()
  const failures: PredictiveRun['failures'] = []
  for (const provider of providers) {
    try {
      for (const alert of await provider.run(context)) {
        // Si dos proveedores avisan lo mismo, gana la severidad más alta.
        const existing = alerts.get(alert.clave_fuente)
        const rank = { info: 0, warning: 1, critical: 2 } as const
        if (!existing || rank[alert.severidad] > rank[existing.severidad]) alerts.set(alert.clave_fuente, alert)
      }
    } catch (cause) {
      failures.push({ provider: provider.id, message: cause instanceof Error ? cause.message : String(cause) })
    }
  }
  return { alerts: [...alerts.values()], failures, truncated }
}

export async function syncPredictiveAlerts(alerts: PredictiveAlertInput[]): Promise<number> {
  const { data, error } = await requireSupabase().rpc('ec_sincronizar_alertas_predictivas_v1', { p_alertas: alerts })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}
