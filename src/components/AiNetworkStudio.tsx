import { useEffect, useState } from 'react'
import { Activity, BrainCircuit, ChevronLeft, ChevronRight, Pause, Play, RotateCcw, Zap } from 'lucide-react'
import { aiDisabledNeurons, aiNeuronCount, aiSources, type AiDraft } from '../data/enterpriseAi'

const PAGE_SIZE = 6
const phases = [
  { title: 'Preparación', description: 'Una señal de ejemplo entra en la red. No se cargan datos reales.', from: 0 },
  { title: 'Propagación', description: 'La señal avanza por las neuronas activas hasta la salida.', from: 15 },
  { title: 'Comparación', description: 'La salida se compararía con el valor esperado para calcular el error.', from: 45 },
  { title: 'Retropropagación', description: 'El error recorrería la red hacia atrás para ajustar los pesos.', from: 62 },
  { title: 'Ciclo completo', description: 'La siguiente iteración repetiría el proceso con nuevos ejemplos.', from: 90 },
] as const

type Node = { x: number; y: number; id: number; on: boolean }

export default function AiNetworkStudio({ draft, onToggle }: { draft: AiDraft; onToggle: (layer: number, neuron: number) => void }) {
  const [pages, setPages] = useState<Record<number, number>>({})
  const [progress, setProgress] = useState(0)
  const [running, setRunning] = useState(false)
  const sizes = draft.layers.map(aiNeuronCount)
  const muted = sizes.map((_, layer) => aiDisabledNeurons(draft, layer))
  const active = sizes.reduce((sum, size, layer) => sum + size - muted[layer].length, 0)
  const ready = draft.sources.length > 0 && sizes.every((size, layer) => size > muted[layer].length)
  const totalColumns = sizes.length + 2
  const columns = [Math.max(1, draft.sources.length), ...sizes, 1].map((count, col) => {
    const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
    const page = Math.min(pages[col] ?? 0, pageCount - 1)
    const start = page * PAGE_SIZE
    const shown = Math.min(PAGE_SIZE, count - start)
    const x = 8 + col * 84 / (totalColumns - 1)
    const nodes: Node[] = Array.from({ length: shown }, (_, index) => {
      const id = start + index + 1
      return { x, y: 46 + (index - (shown - 1) / 2) * 11.5, id, on: col === 0 ? draft.sources.length > 0 : !muted[col - 1]?.includes(id) }
    })
    return { x, nodes, page, pageCount, count, start }
  })

  const finished = progress === 100
  useEffect(() => {
    if (!running || finished) return
    const timer = window.setInterval(() => setProgress(value => Math.min(100, value + 1)), 85)
    return () => window.clearInterval(timer)
  }, [running, finished])

  const phaseIndex = phases.reduce((current, item, index) => progress >= item.from ? index : current, 0)
  const phase = phases[phaseIndex]
  const playing = running && !finished
  const flow = playing ? ({ 1: 'forward', 2: 'compare', 3: 'backward' } as Record<number, string>)[phaseIndex] : undefined
  const reset = () => { setRunning(false); setProgress(0) }

  return <section className="ws-card ai-panel ai-studio" aria-labelledby="ai-network-title">
    <div className="ai-panel-top ai-studio-header">
      <div className="ai-heading">
        <span className="ec-eyebrow"><BrainCircuit size={15} /> Laboratorio neuronal</span>
        <h2 id="ai-network-title">Arquitectura de la red</h2>
        <p>{draft.name.trim() || 'Modelo sin nombre'} · Haz clic en una neurona oculta para activarla o desactivarla. Cambia el rango para ver más.</p>
      </div>
      <div className="ai-studio-actions">
        <button className="ws-button ai-train" type="button" disabled={!ready} onClick={() => {
          if (playing) setRunning(false)
          else { if (progress === 100) setProgress(0); setRunning(true) }
        }}>
          {playing ? <Pause size={17} /> : progress > 0 && progress < 100 ? <Play size={17} /> : <Zap size={17} />}
          {playing ? 'Pausar' : progress === 100 ? 'Repetir simulación' : progress > 0 ? 'Reanudar' : 'Simular entrenamiento'}
        </button>
        <button className="ws-button ws-button-secondary ai-sim-reset" type="button" aria-label="Reiniciar simulación" title="Reiniciar simulación" disabled={!progress && !playing} onClick={reset}><RotateCcw size={17} /></button>
      </div>
    </div>

    <div className="ai-network-scroll" tabIndex={0} role="region" aria-label="Diagrama desplazable de la red">
      <div className="ai-canvas" data-flow={flow} style={{ minWidth: Math.max(480, totalColumns * 104) }}>
        <svg className="ai-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {columns.slice(0, -1).map((column, col) => column.nodes.flatMap(start => columns[col + 1].nodes.map(end => {
            const on = start.on && end.on
            return <line key={`${col}-${start.id}-${end.id}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} data-on={on} style={{ animationDelay: `${(flow === 'backward' ? totalColumns - col - 2 : col) * 95}ms` }} />
          })))}
        </svg>
        {columns.map((column, col) => {
          const hidden = col > 0 && col < totalColumns - 1
          const title = col === 0 ? 'Entrada' : hidden ? `Capa ${col}` : 'Salida'
          return <div className="ai-column" key={col} role="group" aria-label={title} style={{ left: `${column.x}%` }}>
            <span className="ai-column-title">{title}<small>{col === 0 ? `${draft.sources.length} fuentes` : hidden ? `${column.count - muted[col - 1].length}/${column.count} activas` : '1 objetivo'}</small></span>
            {column.nodes.map(node => hidden
              ? <button key={node.id} className="ai-node" data-on={node.on} type="button" aria-pressed={node.on} aria-label={`Capa ${col}, neurona ${node.id}`} title={node.on ? 'Desactivar neurona' : 'Activar neurona'} style={{ top: `${node.y}%` }} onClick={() => { reset(); onToggle(col - 1, node.id) }}>{node.id}</button>
              : <span key={node.id} className="ai-node ai-node-terminal" data-on={node.on} title={col === 0 ? aiSources[draft.sources[node.id - 1]]?.name ?? 'Sin fuentes' : draft.target} style={{ top: `${node.y}%` }}>{col === 0 ? (node.on ? node.id : '—') : <Activity size={17} />}</span>)}
            {hidden && column.pageCount > 1 && <div className="ai-node-pages">
              <button type="button" aria-label={`Neuronas anteriores de capa ${col}`} disabled={!column.page} onClick={() => setPages(current => ({ ...current, [col]: column.page - 1 }))}><ChevronLeft size={14} /></button>
              <select aria-label={`Rango de neuronas de capa ${col}`} value={column.page} onChange={event => setPages(current => ({ ...current, [col]: Number(event.target.value) }))}>
                {Array.from({ length: column.pageCount }, (_, page) => <option key={page} value={page}>{page * PAGE_SIZE + 1}–{Math.min(column.count, (page + 1) * PAGE_SIZE)}</option>)}
              </select>
              <button type="button" aria-label={`Siguientes neuronas de capa ${col}`} disabled={column.page + 1 === column.pageCount} onClick={() => setPages(current => ({ ...current, [col]: column.page + 1 }))}><ChevronRight size={14} /></button>
            </div>}
          </div>
        })}
      </div>
    </div>

    <div className="ai-network-meta">
      <div className="ai-legend"><span><i /> Activa</span><span><i /> Desactivada</span><span>{active.toLocaleString('es-PE')} neuronas activas en total</span></div>
      <small>Salida: {draft.target.trim() || 'Por definir'}</small>
    </div>
    <div className="ai-simulation" aria-label="Estado de la simulación">
      <div className="ai-sim-title" role="status">
        <strong>{progress === 100 ? 'Simulación completada' : playing ? phase.title : progress > 0 ? 'Simulación en pausa' : 'Simulación visual'}</strong>
        <span>{progress === 100 ? 'Se mostró un ciclo de ejemplo; no se entrenó ni se guardó un modelo.' : !ready ? 'Selecciona una fuente y deja al menos una neurona activa por capa.' : playing ? phase.description : progress > 0 ? `Pausa en: ${phase.title}.` : 'Observa cómo fluye una señal de ejemplo sin usar datos reales.'}</span>
      </div>
      <progress value={progress} max={100} aria-label="Avance de la simulación" />
      <ol className="ai-sim-phases" aria-label="Fases del ejemplo">{phases.map((item, index) => <li key={item.title} data-current={(playing || progress > 0) && index === phaseIndex}>{item.title}</li>)}</ol>
    </div>
  </section>
}
