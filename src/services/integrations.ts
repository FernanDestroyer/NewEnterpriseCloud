import { requireSupabase } from '../lib/supabase'
import {
  integrationErrorState,
  parsePeruIntegrationStatus,
  type PeruIntegrationStatus,
} from '../data/integrationStatus'

const PERU_LOOKUP_STATUS_CODE = 'INTEGRACION_PERU_LOOKUP_STATUS'
const PERU_LOOKUP_STATUS_NAME = 'Estado de integración RENIEC/SUNAT'

export async function fetchPeruIntegrationStatus(): Promise<PeruIntegrationStatus | null> {
  const { data, error } = await requireSupabase().from('configuracion')
    .select('detalle')
    .eq('codigo', PERU_LOOKUP_STATUS_CODE)
    .maybeSingle()
  if (error) throw new Error('No se pudo leer el estado guardado de la integración.')
  if (!data?.detalle) return null
  try {
    return parsePeruIntegrationStatus(JSON.parse(String(data.detalle)))
  } catch {
    return null
  }
}

async function persistStatus(status: PeruIntegrationStatus): Promise<void> {
  const { error } = await requireSupabase().from('configuracion').upsert({
    codigo: PERU_LOOKUP_STATUS_CODE,
    nombre: PERU_LOOKUP_STATUS_NAME,
    detalle: JSON.stringify(status),
    estado: 'Vigente',
  }, { onConflict: 'codigo' })
  if (error) throw new Error('No se pudo guardar el resultado de la comprobación.')
}

export async function checkPeruLookupIntegration(): Promise<PeruIntegrationStatus> {
  const client = requireSupabase()
  const checkedAt = new Date().toISOString()
  const { data, error } = await client.functions.invoke('peru-document-lookup', {
    body: { action: 'status' },
  })

  const status = error
    ? { state: integrationErrorState(error), provider: null, verified: false as const, checked_at: checkedAt }
    : parsePeruIntegrationStatus(data) ?? { state: 'unavailable' as const, provider: null, verified: false as const, checked_at: checkedAt }

  await persistStatus(status)
  return status
}
