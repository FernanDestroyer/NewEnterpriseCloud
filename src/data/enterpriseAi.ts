export const aiTemplates = {
  marketing: {
    title: 'Marketing', description: 'Identifica tendencias para orientar campañas y contenidos.',
    name: 'Radar de tendencias', target: 'Interés por tema',
    layers: [64, 32], sources: ['web'],
  },
  sales: {
    title: 'Predicción de ventas', description: 'Proyecta ventas a partir del historial comercial.',
    name: 'Pronóstico comercial', target: 'Ventas por semana',
    layers: [64, 32, 16], sources: ['sales'],
  },
  inventory: {
    title: 'Inventario', description: 'Anticipa la demanda para planificar la reposición.',
    name: 'Demanda por producto', target: 'Unidades por producto',
    layers: [32, 16], sources: ['sales', 'inventory'],
  },
} as const

export const aiSources = {
  sales: { name: 'Historial de ventas', kind: 'Base de datos ERP', description: 'Fechas, productos, cantidades e importes.' },
  inventory: { name: 'Movimientos de inventario', kind: 'Base de datos ERP', description: 'Entradas, salidas y existencias por almacén.' },
  web: { name: 'Fuente web pública', kind: 'Web', description: 'URL de un índice de tendencias o conjunto público.' },
  csv: { name: 'Archivo CSV', kind: 'Archivo', description: 'Referencia a un conjunto de datos propio.' },
} as const

export type AiTemplate = keyof typeof aiTemplates
export type AiSource = keyof typeof aiSources
export type AiDraft = {
  name: string
  target: string
  layers: string[]
  disabledNeurons: number[][]
  sources: AiSource[]
  webUrl: string
  fileName: string
}

export const MAX_AI_LAYERS = 8
export const MAX_AI_NEURONS = 1024

export function aiNeuronCount(value: string) {
  const size = Number(value)
  return Number.isInteger(size) && size >= 1 && size <= MAX_AI_NEURONS ? size : 0
}

export function aiDisabledNeurons(draft: AiDraft, layer: number) {
  const size = aiNeuronCount(draft.layers[layer])
  return (draft.disabledNeurons[layer] ?? []).filter(index => index >= 1 && index <= size)
}

export function createAiDraft(area: AiTemplate): AiDraft {
  const template = aiTemplates[area]
  return {
    name: template.name, target: template.target, layers: template.layers.map(String),
    disabledNeurons: template.layers.map(() => []),
    sources: [...template.sources], webUrl: '', fileName: '',
  }
}

export function reviewAiDraft(area: AiTemplate, draft: AiDraft) {
  const errors: string[] = []
  if (!draft.name.trim()) errors.push('Escribe el nombre del modelo.')
  if (!draft.target.trim()) errors.push('Define la variable objetivo.')
  if (!draft.sources.length) errors.push('Selecciona al menos una fuente de datos.')
  if (draft.sources.includes('web')) {
    const url = URL.canParse(draft.webUrl.trim()) ? new URL(draft.webUrl.trim()) : null
    if (url?.protocol !== 'https:' || url.username || url.password) errors.push('Indica una URL web HTTPS sin credenciales.')
  }
  if (draft.sources.includes('csv') && !/^.+\.csv$/i.test(draft.fileName.trim())) errors.push('Selecciona un archivo .csv como referencia.')
  const layers = draft.layers.map(Number)
  if (!layers.length || layers.length > MAX_AI_LAYERS || layers.some(size => !Number.isInteger(size) || size < 1 || size > MAX_AI_NEURONS)) {
    errors.push(`Usa de 1 a ${MAX_AI_LAYERS} capas y de 1 a ${MAX_AI_NEURONS} neuronas enteras por capa.`)
  }
  if (draft.layers.some((value, layer) => aiNeuronCount(value) > 0 && aiDisabledNeurons(draft, layer).length === aiNeuronCount(value))) {
    errors.push('Deja al menos una neurona activa por capa.')
  }
  if (errors.length) return { errors, plan: null }
  return {
    errors,
    plan: {
      version: 1,
      modo: 'diseño',
      area: aiTemplates[area].title,
      nombre: draft.name.trim(),
      objetivo: draft.target.trim(),
      capasOcultas: layers,
      neuronasDesactivadas: layers.map((_, layer) => aiDisabledNeurons(draft, layer)),
      fuentes: draft.sources.map(id => ({
        tipo: aiSources[id].kind,
        nombre: aiSources[id].name,
        ...(id === 'web' ? { url: draft.webUrl.trim() } : {}),
        ...(id === 'csv' ? { archivo: draft.fileName } : {}),
      })),
    },
  }
}
