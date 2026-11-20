import { aiSources, aiTemplates, MAX_AI_LAYERS, MAX_AI_NEURONS, reviewAiDraft, type AiDraft, type AiSource, type AiTemplate } from './enterpriseAi.ts'

export type AiSavedModel = {
  id: string
  area: AiTemplate
  name: string
  target: string
  layers: number[]
  disabledNeurons: number[][]
  sources: AiSource[]
  savedAt: string
}

export type AiDemoModel = AiSavedModel & {
  metrics: { label: string; value: string; detail: string }[]
  dataset: { name: string; period: string; rows: number; fields: string; split: string }
}

export function createSavedAiModel(area: AiTemplate, draft: AiDraft, id: string, savedAt: string): AiSavedModel | null {
  const { plan } = reviewAiDraft(area, draft)
  if (!plan) return null
  return { id, area, name: plan.nombre, target: plan.objetivo, layers: plan.capasOcultas, disabledNeurons: plan.neuronasDesactivadas, sources: [...draft.sources], savedAt }
}

const MAX_SAVED_MODELS = 100
const modelKey = (userId: string) => `enterprisecloud:ai-designs:v1:${userId}`

function isSavedAiModel(value: unknown): value is AiSavedModel {
  if (!value || typeof value !== 'object') return false
  const m = value as Partial<AiSavedModel>
  const { layers } = m
  return typeof m.id === 'string' && typeof m.name === 'string' && typeof m.target === 'string'
    && typeof m.savedAt === 'string' && Number.isFinite(Date.parse(m.savedAt))
    && typeof m.area === 'string' && Object.prototype.hasOwnProperty.call(aiTemplates, m.area)
    && Array.isArray(layers) && layers.length > 0 && layers.length <= MAX_AI_LAYERS
    && layers.every(n => Number.isInteger(n) && n >= 1 && n <= MAX_AI_NEURONS)
    && Array.isArray(m.disabledNeurons) && m.disabledNeurons.length === layers.length
    && m.disabledNeurons.every((ids, index) => Array.isArray(ids) && ids.length < layers[index] && new Set(ids).size === ids.length && ids.every(n => Number.isInteger(n) && n >= 1 && n <= layers[index]))
    && Array.isArray(m.sources) && m.sources.length > 0 && m.sources.every(id => typeof id === 'string' && Object.prototype.hasOwnProperty.call(aiSources, id))
}

export function readAiModels(userId: string, storage: Pick<Storage, 'getItem'> = window.localStorage): AiSavedModel[] {
  const raw = storage.getItem(modelKey(userId))
  if (!raw) return []
  let value: unknown
  try { value = JSON.parse(raw) } catch { return [] }
  return Array.isArray(value) ? value.filter(isSavedAiModel).slice(0, MAX_SAVED_MODELS) : []
}

export function saveAiModel(userId: string, model: AiSavedModel, storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage) {
  const existing = readAiModels(userId, storage)
  if (existing.some(item => item.id === model.id)) return
  if (existing.length >= MAX_SAVED_MODELS) throw new Error('La biblioteca local admite hasta 100 diseños.')
  storage.setItem(modelKey(userId), JSON.stringify([model, ...existing]))
}

export const aiDemoModels: AiDemoModel[] = [
  {
    id: 'demo-sales', area: 'sales', name: 'Pronóstico comercial semanal', target: 'Ventas de la próxima semana (PEN)',
    layers: [64, 32, 16], disabledNeurons: [[], [], []], sources: ['sales'], savedAt: '2026-11-01',
    metrics: [
      { label: 'MAPE', value: '8,4 %', detail: 'Error porcentual absoluto medio' },
      { label: 'MAE', value: 'S/ 620', detail: 'Error absoluto medio por semana' },
      { label: 'R²', value: '0,89', detail: 'Ajuste sobre la evaluación' },
    ],
    dataset: { name: 'Historial semanal sintético', period: 'Ene. 2024 – dic. 2025', rows: 104, fields: 'Semana, ventas en PEN, variación semanal', split: '70 % entrenamiento · 15 % validación · 15 % prueba' },
  },
  {
    id: 'demo-marketing', area: 'marketing', name: 'Radar de tendencias', target: 'Interés alto o bajo',
    layers: [64, 32], disabledNeurons: [[], []], sources: ['web'], savedAt: '2026-11-01',
    metrics: [
      { label: 'Precisión', value: '91,2 %', detail: 'Proporción de positivos predichos correctos' },
      { label: 'Sensibilidad', value: '84,6 %', detail: 'Proporción de positivos reales detectados' },
      { label: 'F1', value: '0,88', detail: 'Equilibrio entre precisión y sensibilidad' },
    ],
    dataset: { name: 'Serie sintética de interés por tema', period: 'Ene. – oct. 2025', rows: 1200, fields: 'Tema, índice de interés, crecimiento semanal, clase', split: '70 % entrenamiento · 15 % validación · 15 % prueba' },
  },
  {
    id: 'demo-inventory', area: 'inventory', name: 'Demanda por producto', target: 'Unidades de la próxima semana',
    layers: [32, 16], disabledNeurons: [[], []], sources: ['sales', 'inventory'], savedAt: '2026-11-01',
    metrics: [
      { label: 'MAE', value: '5,2 u.', detail: 'Error absoluto medio en unidades' },
      { label: 'RMSE', value: '7,1 u.', detail: 'Raíz del error cuadrático medio' },
    ],
    dataset: { name: 'Movimientos sintéticos por producto', period: 'Ene. – dic. 2025', rows: 2600, fields: 'Producto, semana, unidades vendidas, variación semanal', split: '70 % entrenamiento · 15 % validación · 15 % prueba' },
  },
]

export const aiTestSpecs = {
  sales: { input: 'Ventas de la semana anterior (PEN)', max: 100_000_000, sample: '12500', trend: '8', unit: 'PEN' },
  marketing: { input: 'Índice actual de interés (0–100)', max: 100, sample: '72', trend: '12', unit: '/ 100' },
  inventory: { input: 'Unidades vendidas la semana anterior', max: 1_000_000, sample: '85', trend: '10', unit: 'unidades' },
} as const

export function runAiExample(area: AiTemplate, baseline: string, trend: string, demo: boolean) {
  const input = Number(baseline)
  const change = Number(trend)
  const { max } = aiTestSpecs[area]
  if (!baseline.trim() || !Number.isFinite(input) || input < 0 || input > max || (area === 'inventory' && !Number.isInteger(input))) {
    return { error: `Indica ${area === 'inventory' ? 'un número entero' : 'un número'} entre 0 y ${max.toLocaleString('es-PE')}.` } as const
  }
  if (!trend.trim() || !Number.isFinite(change) || change < -100 || change > 100) {
    return { error: 'Indica una variación entre −100 % y 100 %.' } as const
  }
  if (!demo) return { result: null } as const
  const adjusted = input * (1 + change / 100)
  const estimate = area === 'marketing' ? Math.min(100, Math.round(adjusted)) : area === 'inventory' ? Math.round(adjusted) : Math.round(adjusted * 100) / 100
  return { result: { estimate, label: area === 'marketing' ? (estimate >= 70 ? 'Interés alto' : 'Interés bajo') : 'Estimación ilustrativa' } } as const
}
