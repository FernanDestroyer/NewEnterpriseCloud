import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowRight, BrainCircuit, ChartNoAxesCombined, Check, Database, Download, FileSpreadsheet, Globe,
  Layers3, Megaphone, Package, Plus, RotateCcw, Save, Trash2,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  aiNeuronCount, aiSources, aiTemplates, createAiDraft, MAX_AI_LAYERS, MAX_AI_NEURONS, reviewAiDraft,
  type AiDraft, type AiSource, type AiTemplate,
} from '../data/enterpriseAi'
import { createSavedAiModel, saveAiModel } from '../data/enterpriseAiModels'
import { PageHeader } from './ui/PageHeader'
import AiNetworkStudio from './AiNetworkStudio'
import './enterprise-ai.css'

const areaIcons = { marketing: Megaphone, sales: ChartNoAxesCombined, inventory: Package }
const sourceIcons = { sales: Database, inventory: Database, web: Globe, csv: FileSpreadsheet }
const areas = Object.keys(aiTemplates) as AiTemplate[]
const sources = Object.keys(aiSources) as AiSource[]

export default function EnterpriseAiPage() {
  const { can, session } = useAuth()
  const [area, setArea] = useState<AiTemplate>('sales')
  const [drafts, setDrafts] = useState(() => ({
    marketing: createAiDraft('marketing'), sales: createAiDraft('sales'), inventory: createAiDraft('inventory'),
  }))
  const [reviewed, setReviewed] = useState(false)
  const [fileKey, setFileKey] = useState(0)
  const [savedId, setSavedId] = useState('')
  const [saveError, setSaveError] = useState('')
  const reviewRef = useRef<HTMLDivElement>(null)
  const draft = drafts[area]
  const { errors, plan } = reviewAiDraft(area, draft)
  useEffect(() => { if (reviewed) reviewRef.current?.focus() }, [reviewed])

  const update = (patch: Partial<AiDraft>) => {
    setDrafts(current => ({ ...current, [area]: { ...current[area], ...patch } }))
    setReviewed(false)
    setSavedId('')
    setSaveError('')
  }

  const reset = () => {
    update(createAiDraft(area))
    setFileKey(value => value + 1)
  }

  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setReviewed(true)
  }

  const download = () => {
    if (!reviewed || !plan) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `diseno-ia-${area}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const save = () => {
    if (!reviewed || !plan || !session || savedId) return
    try {
      const model = createSavedAiModel(area, draft, crypto.randomUUID(), new Date().toISOString())
      if (!model) return
      saveAiModel(session.user.id, model)
      setSavedId(model.id)
      setSaveError('')
    } catch (error) {
      setSaveError(`No se pudo guardar en este navegador. ${error instanceof Error && error.message === 'La biblioteca local admite hasta 100 diseños.' ? error.message : 'Puedes descargar el diseño como JSON.'}`)
    }
  }

  if (!can('reports')) return <div className="ws-empty-compact"><strong>Acceso restringido</strong><p>Tu rol no tiene permiso para abrir el estudio de modelos.</p></div>

  return <>
    <PageHeader icon={BrainCircuit} section="IA empresarial" title="Estudio de modelos" description="Diseña redes neuronales especializadas para distintas áreas de tu negocio." actions={<Link className="ws-button ws-button-secondary" to="/ia-empresarial/modelos"><Layers3 size={16} /> Ver modelos</Link>} />
    <AiNetworkStudio key={`${area}:${fileKey}:${draft.layers.join(',')}:${draft.sources.join(',')}`} draft={draft} onToggle={(layer, neuron) => {
      update({ disabledNeurons: draft.disabledNeurons.map((disabled, index) => index !== layer ? disabled : disabled.includes(neuron) ? disabled.filter(id => id !== neuron) : [...disabled, neuron]) })
    }} />

    <section className="ai-areas" aria-labelledby="ai-areas-title">
      <div className="ai-heading"><h2 id="ai-areas-title">Elige un área</h2><p>Cada plantilla tiene su propio borrador mientras permanezcas en el estudio.</p></div>
      <div className="ai-area-grid" role="group" aria-label="Plantillas de modelos">
        {areas.map(key => {
          const template = aiTemplates[key]
          const Icon = areaIcons[key]
          return <button type="button" className="ws-card ai-area" aria-pressed={area === key} key={key} onClick={() => { if (area !== key) { setArea(key); setReviewed(false); setSavedId(''); setSaveError('') } }}>
            <span className={`ws-soft-icon ${key === 'marketing' ? 'violet' : key === 'sales' ? 'green' : 'amber'}`}><Icon size={20} /></span>
            <span className="ai-area-copy"><strong>{template.title}</strong><small>{template.description}</small></span>
            {area === key ? <Check size={18} className="ai-area-indicator" /> : <ArrowRight size={16} className="ai-area-indicator" />}
          </button>
        })}
      </div>
    </section>

    <form className="ai-layout" onSubmit={review} noValidate>
      <div className="ai-builder">
        <section className="ws-card ai-panel" aria-labelledby="ai-objective-title">
          <div className="ai-heading"><span className="ec-eyebrow">01 · Modelo</span><h2 id="ai-objective-title">Define el objetivo</h2><p>Identifica el modelo y qué valor esperas obtener.</p></div>
          <div className="ai-fields">
            <label>Nombre del modelo<input required maxLength={100} value={draft.name} onChange={event => update({ name: event.target.value })} /></label>
            <label>Variable objetivo<input required maxLength={120} value={draft.target} onChange={event => update({ target: event.target.value })} /></label>
          </div>
        </section>

        <section className="ws-card ai-panel" aria-labelledby="ai-sources-title">
          <div className="ai-heading"><span className="ec-eyebrow">02 · Datos</span><h2 id="ai-sources-title">Fuentes de datos</h2><p>Combina fuentes internas y externas según lo que quieras predecir.</p></div>
          <div className="ai-source-grid" role="group" aria-label="Fuentes que incluiría el modelo">
            {sources.map(source => {
              const item = aiSources[source]
              const Icon = sourceIcons[source]
              return <label className="ai-source" key={source}>
                <Icon size={17} className="ai-source-icon" />
                <span><strong>{item.name}</strong><small>{item.kind} · {item.description}</small></span>
                <input type="checkbox" checked={draft.sources.includes(source)} onChange={event => update({
                  sources: event.target.checked ? [...draft.sources, source] : draft.sources.filter(value => value !== source),
                })} />
              </label>
            })}
          </div>
          {draft.sources.includes('web') && <label className="ai-extra-field">URL del conjunto de datos público
            <input type="url" required placeholder="https://…" value={draft.webUrl} onChange={event => update({ webUrl: event.target.value })} />
            <small>Usa una URL HTTPS sin tokens ni otros datos privados. No se abrirá desde el prototipo.</small>
          </label>}
          {draft.sources.includes('csv') && <label className="ai-extra-field">Archivo CSV de referencia
            <input key={`${area}-${fileKey}`} type="file" accept=".csv" onChange={event => update({ fileName: event.target.files?.[0]?.name ?? '' })} />
            <small>{draft.fileName ? `Referencia: ${draft.fileName}. ` : ''}Solo se conserva el nombre; el contenido no se lee ni se sube.</small>
          </label>}
        </section>

      </div>
      <div className="ai-builder">
        <section className="ws-card ai-panel" aria-labelledby="ai-layers-title">
          <div className="ai-panel-top">
            <div className="ai-heading"><span className="ec-eyebrow">03 · Arquitectura</span><h2 id="ai-layers-title">Capas ocultas</h2><p>Configura hasta {MAX_AI_LAYERS} capas y {MAX_AI_NEURONS.toLocaleString('es-PE')} neuronas por capa.</p></div>
            <button type="button" className="ws-button ws-button-secondary" disabled={draft.layers.length >= MAX_AI_LAYERS} onClick={() => update({ layers: [...draft.layers, '16'], disabledNeurons: [...draft.disabledNeurons, []] })}><Plus size={16} /> Añadir capa</button>
          </div>
          <div className="ai-layers">
            {draft.layers.map((value, index) => <div className="ai-layer" key={index}>
              <span className="ai-layer-title"><Layers3 size={16} /> Capa {index + 1}</span>
              <label>Neuronas<input type="number" aria-label={`Neuronas de la capa ${index + 1}`} min={1} max={MAX_AI_NEURONS} step={1} required value={value} onChange={event => update({ layers: draft.layers.map((previous, i) => i === index ? event.target.value : previous) })} onBlur={() => {
                const count = aiNeuronCount(value)
                if (count && draft.disabledNeurons[index].some(id => id > count)) update({ disabledNeurons: draft.disabledNeurons.map((ids, i) => i === index ? ids.filter(id => id <= count) : ids) })
              }} /></label>
              <button className="ws-button ws-button-secondary ai-remove" type="button" disabled={draft.layers.length === 1} aria-label={`Eliminar capa ${index + 1}`} onClick={() => update({ layers: draft.layers.filter((_, i) => i !== index), disabledNeurons: draft.disabledNeurons.filter((_, i) => i !== index) })}><Trash2 size={15} /></button>
            </div>)}
          </div>
        </section>
      <section className="ws-card ai-panel" aria-labelledby="ai-export-title">
        <div className="ai-heading"><span className="ec-eyebrow">04 · Borrador</span><h2 id="ai-export-title">Revisa y descarga</h2><p>El diseño incluye las neuronas activas y desactivadas, pero no los datos de entrenamiento.</p></div>
        <div className="ai-review-actions">
          <button className="ws-button" type="submit">Revisar diseño <ArrowRight size={16} /></button>
          <button className="ws-button ws-button-secondary" type="button" onClick={reset}><RotateCcw size={15} /> Restablecer plantilla</button>
        </div>
        <div className="ai-review-result" ref={reviewRef} tabIndex={-1} role="status">
          {reviewed && (plan ? <>
            <p className="ai-ready"><Check size={16} /> {savedId ? 'Diseño guardado en este navegador' : 'Diseño listo para guardar o descargar'}</p>
            <small>La biblioteca guarda la configuración y el tipo de fuente, sin URLs, archivos ni datos de entrenamiento.</small>
            <div className="ai-review-actions">
              {savedId ? <Link className="ws-button" to={`/ia-empresarial/modelos?modelo=${encodeURIComponent(savedId)}`}><Layers3 size={16} /> Ver diseño guardado</Link> : <button className="ws-button" type="button" onClick={save}><Save size={16} /> Guardar en Modelos</button>}
              <button className="ws-button ws-button-secondary" type="button" onClick={download}><Download size={16} /> Descargar JSON</button>
            </div>
            {saveError && <span>{saveError}</span>}
          </> : <><strong>Completa la configuración</strong><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></>)}
        </div>
      </section>
      </div>
    </form>
  </>
}
