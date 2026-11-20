import { useMemo, useState, type FormEvent } from 'react'
import { BarChart3, BrainCircuit, ChevronRight, Database, FlaskConical, Info, Layers3, Plus, Search } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { aiSources, aiTemplates } from '../data/enterpriseAi'
import { aiDemoModels, aiTestSpecs, readAiModels, runAiExample, type AiSavedModel } from '../data/enterpriseAiModels'
import { PageHeader } from './ui/PageHeader'
import './enterprise-ai.css'

type Detail = 'metrics' | 'data' | 'test'
const details = [
  { id: 'metrics', label: 'Métricas', icon: BarChart3 },
  { id: 'data', label: 'Datos de entrenamiento', icon: Database },
  { id: 'test', label: 'Pruebas', icon: FlaskConical },
] as const

function ModelTest({ model, demo }: { model: AiSavedModel; demo: boolean }) {
  const spec = aiTestSpecs[model.area]
  const [baseline, setBaseline] = useState('')
  const [trend, setTrend] = useState('')
  const [outcome, setOutcome] = useState<ReturnType<typeof runAiExample> | null>(null)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setOutcome(runAiExample(model.area, baseline, trend, demo))
  }

  return <section className="ai-model-detail" aria-labelledby="ai-test-title">
    <div className="ai-heading"><h3 id="ai-test-title">Banco de pruebas</h3><p>{demo ? 'Cambia las entradas y observa la salida de una regla ilustrativa. No es una predicción de la red.' : 'Valida entradas de ejemplo para esta área. El diseño no puede generar predicciones hasta que exista un modelo entrenado.'}</p></div>
    <form className="ai-model-test" onSubmit={submit} noValidate>
      <div className="ai-fields">
        <label>{spec.input}<input required type="number" min={0} max={spec.max} step={model.area === 'inventory' ? 1 : 'any'} value={baseline} onChange={event => { setBaseline(event.target.value); setOutcome(null) }} /></label>
        <label>Variación semanal (%)<input required type="number" min={-100} max={100} step="any" value={trend} onChange={event => { setTrend(event.target.value); setOutcome(null) }} /></label>
      </div>
      <div className="ai-review-actions">
        <button className="ws-button" type="submit"><FlaskConical size={16} />{demo ? 'Ejecutar prueba simulada' : 'Validar entradas'}</button>
        <button className="ws-button ws-button-secondary" type="button" onClick={() => { setBaseline(spec.sample); setTrend(spec.trend); setOutcome(null) }}>Cargar ejemplo</button>
      </div>
    </form>
    <div role="status">
      {outcome && ('error' in outcome ? <div className="ws-notice ws-notice-warning">{outcome.error}</div> : <div className="ai-test-result">
        {outcome.result ? <><span className="ec-eyebrow">Resultado simulado</span><strong>{outcome.result.estimate.toLocaleString('es-PE')} {spec.unit}</strong><span>{outcome.result.label} · no modifica las métricas del catálogo.</span></>
          : <><strong>Entradas válidas</strong><span>No se ejecutó inferencia: este diseño aún no tiene un modelo entrenado.</span></>}
      </div>)}
    </div>
  </section>
}

function ModelDetail({ model }: { model: AiSavedModel }) {
  const [tab, setTab] = useState<Detail>('metrics')
  const demo = aiDemoModels.find(item => item.id === model.id)
  const architecture = model.layers.reduce((total, size, i) => total + size - model.disabledNeurons[i].length, 0)

  return <article className="ws-card ai-panel ai-model-profile">
    <div className="ai-panel-top">
      <div className="ai-heading"><span className="ec-eyebrow">{aiTemplates[model.area].title}</span><h2>{model.name}</h2><p>Objetivo: {model.target}</p></div>
      <span className={`ws-badge ${demo ? 'amber' : 'info'}`}>{demo ? 'Ejemplo simulado' : 'Diseño sin entrenar'}</span>
    </div>
    <div className="ai-model-meta"><span><Layers3 size={15} />{model.layers.length} capas ocultas: {model.layers.join(' → ')}</span><span><BrainCircuit size={15} />{architecture.toLocaleString('es-PE')} neuronas activas</span>{!demo && <span>Guardado el {new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium' }).format(new Date(model.savedAt))}</span>}</div>
    <div className="ai-model-tabs" role="group" aria-label="Información del modelo">
      {details.map(({ id, label, icon: Icon }) => <button className="ws-button ws-button-secondary" type="button" key={id} aria-pressed={id === tab} onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}
    </div>

    {tab === 'metrics' && <section className="ai-model-detail" aria-labelledby="ai-metrics-title">
      <div className="ai-heading"><h3 id="ai-metrics-title">Calidad del modelo</h3><p>{demo ? 'Cifras ilustrativas; no se calcularon entrenando o evaluando una red real.' : 'Todavía no hay métricas. Aparecerían al evaluar un modelo entrenado con un conjunto de prueba.'}</p></div>
      {demo && <dl className="ai-metrics-grid">{demo.metrics.map(metric => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd><small>{metric.detail}</small></div>)}</dl>}
    </section>}
    {tab === 'data' && <section className="ai-model-detail" aria-labelledby="ai-data-title">
      <div className="ai-heading"><h3 id="ai-data-title">{demo ? 'Conjunto de entrenamiento de ejemplo' : 'Fuentes previstas'}</h3><p>{demo ? 'Ficha ficticia de un conjunto sintético. No se descargaron ni procesaron registros.' : 'Ningún dato se usó para entrenar. Estas son las fuentes seleccionadas en el estudio.'}</p></div>
      {demo && <dl className="ai-dataset">
        <div><dt>Conjunto</dt><dd>{demo.dataset.name}</dd></div>
        <div><dt>Período</dt><dd>{demo.dataset.period}</dd></div>
        <div><dt>Registros de ejemplo</dt><dd>{demo.dataset.rows.toLocaleString('es-PE')}</dd></div>
        <div><dt>Partición</dt><dd>{demo.dataset.split}</dd></div>
        <div><dt>Variables</dt><dd>{demo.dataset.fields}</dd></div>
      </dl>}
      {demo ? null : <ul className="ai-model-sources">{model.sources.map(id => <li key={id}><Database size={15} /><div><strong>{aiSources[id].name}</strong><small>{aiSources[id].kind} · {aiSources[id].description}</small></div></li>)}</ul>}
    </section>}
    {tab === 'test' && <ModelTest model={model} demo={Boolean(demo)} />}
  </article>
}

export default function EnterpriseAiModelsPage() {
  const { can, session } = useAuth()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const userId = session?.user.id
  const { saved, storageFailed } = useMemo(() => {
    try { return { saved: userId ? readAiModels(userId) : [], storageFailed: false } }
    catch { return { saved: [], storageFailed: true } }
  }, [userId])
  const query = search.trim().toLocaleLowerCase('es')
  const items = [
    ...(filter !== 'demo' ? saved.map(model => ({ model, demo: false })) : []),
    ...(filter !== 'saved' ? aiDemoModels.map(model => ({ model, demo: true })) : []),
  ].filter(({ model }) => `${model.name} ${model.target} ${aiTemplates[model.area].title}`.toLocaleLowerCase('es').includes(query))
  const selected = items.find(({ model }) => model.id === params.get('modelo')) ?? items[0]

  if (!can('reports')) return <div className="ws-empty-compact"><strong>Acceso restringido</strong><p>Tu rol no tiene permiso para abrir el catálogo de modelos.</p></div>

  return <>
    <PageHeader icon={BrainCircuit} section="IA empresarial" title="Modelos" description="Consulta tus diseños y explora métricas, fuentes y pruebas de modelos de ejemplo." actions={<Link className="ws-button" to="/ia-empresarial"><Plus size={16} /> Nuevo diseño</Link>} />
    <div className="ws-notice" role="note"><Info size={17} /><div><strong>Biblioteca de diseño</strong><span>Los diseños se guardan en este navegador. Las métricas, los datos y las predicciones de los ejemplos son simulados.</span></div></div>
    {storageFailed && <div className="ws-notice ws-notice-warning" role="status">No se pudo acceder a los diseños guardados en este navegador.</div>}
    <div className="ai-library">
      <section className="ws-card ai-panel" aria-labelledby="ai-library-title">
        <div className="ai-heading"><h2 id="ai-library-title">Catálogo</h2><p>{saved.length} diseños guardados · {aiDemoModels.length} ejemplos</p></div>
        <div className="ai-library-filters ai-fields">
          <label><span><Search size={13} /> Buscar modelo</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nombre o área" /></label>
          <label>Mostrar<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todos</option><option value="saved">Mis diseños</option><option value="demo">Ejemplos simulados</option></select></label>
        </div>
        <div className="ai-model-list">
          {items.map(({ model, demo }) => <button className="ai-model-option" type="button" key={model.id} aria-pressed={selected?.model.id === model.id} onClick={() => setParams({ modelo: model.id }, { replace: true })}>
            <span><strong>{model.name}</strong><small>{aiTemplates[model.area].title} · {demo ? 'Ejemplo' : 'Diseño guardado'}</small></span><ChevronRight size={16} />
          </button>)}
          {!items.length && <p className="ai-library-empty">{filter === 'saved' && !query && !saved.length ? 'Aún no has guardado ningún diseño desde el estudio.' : 'No hay modelos que coincidan con la búsqueda.'}</p>}
        </div>
      </section>
      {selected ? <ModelDetail key={selected.model.id} model={selected.model} /> : <div className="ws-card ai-panel"><div className="ai-heading"><h2>Sin modelo seleccionado</h2><p>Ajusta los filtros o crea un diseño en el estudio.</p></div></div>}
    </div>
  </>
}
