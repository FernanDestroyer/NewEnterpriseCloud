import { useEffect, useMemo, useState } from 'react'
import { Activity, BrainCircuit, Check, ChevronRight, CircleHelp, Gauge, Pause, Play, RotateCcw, Sparkles, ThumbsDown, ThumbsUp, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useRecords } from '../context/RecordsContext'
import { PageHeader } from './ui/PageHeader'
import './neural-network.css'

type EngineState = 'DEMO' | 'Entrenando' | 'Validando' | 'Publicado' | 'Inferencia activa'
type Node = { x: number; y: number; label: string; tone?: 'risk' | 'goal' | 'cash' | 'rank' }

const inputNodes: Node[] = [
  { x: 74, y: 74, label: 'Ventas' }, { x: 74, y: 142, label: 'Inventario' },
  { x: 74, y: 210, label: 'Tesorería' }, { x: 74, y: 278, label: 'Compras' },
  { x: 74, y: 346, label: 'Logística' }, { x: 74, y: 414, label: 'Metas' },
]
const hiddenNodes: Node[] = [
  { x: 230, y: 54, label: 'h1' }, { x: 230, y: 124, label: 'h2' }, { x: 230, y: 194, label: 'h3' },
  { x: 230, y: 264, label: 'h4' }, { x: 230, y: 334, label: 'h5' }, { x: 230, y: 404, label: 'h6' },
]
const outputNodes: Node[] = [
  { x: 465, y: 92, label: 'Quiebre de stock', tone: 'risk' },
  { x: 465, y: 190, label: 'Cumplimiento', tone: 'goal' },
  { x: 465, y: 288, label: 'Morosidad CxC / CxP', tone: 'cash' },
  { x: 465, y: 386, label: 'Ranking IA', tone: 'rank' },
]
const recommendations = [
  { id: 'stock', title: 'Reponer SKU-204 antes del viernes', detail: 'La demanda proyectada supera el stock disponible en Almacén Central.', score: '92%', factors: ['cobertura: 3 días', 'demanda +18%', 'lead time: 5 días'], tone: 'risk' },
  { id: 'goal', title: 'Acelerar la meta de ventas de Lima', detail: 'La sucursal lleva 78% de avance y quedan 6 días del periodo.', score: '84%', factors: ['avance: 78%', 'brecha: S/ 12,400', 'tendencia positiva'], tone: 'goal' },
  { id: 'cash', title: 'Priorizar cobranza de Comercial Andina', detail: 'Factura vencida con impacto alto en el flujo de caja semanal.', score: '76%', factors: ['mora: 18 días', 'saldo: S/ 8,640', 'riesgo medio'], tone: 'cash' },
]

function edgeLines(from: Node[], to: Node[]) {
  return from.flatMap((source, sourceIndex) => to.map((target, targetIndex) => <line key={`${source.label}-${target.label}`} x1={source.x + 14} y1={source.y} x2={target.x - 14} y2={target.y} className="nn-edge" style={{ animationDelay: `${(sourceIndex + targetIndex) * 90}ms` }} />))
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  return <article className={`nn-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>
}

export default function NeuralNetworkPage() {
  const { records } = useRecords()
  const [engineState, setEngineState] = useState<EngineState>('DEMO')
  const [progress, setProgress] = useState(68)
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [feedback, setFeedback] = useState<Record<string, 'Útil' | 'Descartada'>>({})

  const metrics = useMemo(() => {
    const sales = records.sales.length
    const inventory = records.inventory.length
    const finance = records.finance.length
    return { sales: sales ? `${sales} señales` : '24 señales', inventory: inventory ? `${inventory} SKUs` : '186 SKUs', finance: finance ? `${finance} cuentas` : '42 cuentas' }
  }, [records.finance.length, records.inventory.length, records.sales.length])

  useEffect(() => {
    if (paused || engineState === 'DEMO' || engineState === 'Publicado' || engineState === 'Inferencia activa') return
    const timer = window.setInterval(() => {
      setProgress(current => {
        const next = Math.min(100, current + 2 * speed)
        if (next >= 100) {
          setEngineState('Publicado')
          window.setTimeout(() => setEngineState('Inferencia activa'), 900)
        } else if (next > 72) setEngineState('Validando')
        return next
      })
    }, 220)
    return () => window.clearInterval(timer)
  }, [engineState, paused, speed])

  const startTraining = () => { setProgress(8); setPaused(false); setEngineState('Entrenando') }
  const resetDemo = () => { setProgress(68); setPaused(false); setEngineState('DEMO') }
  const allEdges = <>{edgeLines(inputNodes, hiddenNodes)}{edgeLines(hiddenNodes, outputNodes)}</>

  return <>
    <PageHeader icon={BrainCircuit} section="Reportes e Inteligencia de Negocios" title="Red neuronal empresarial" description="Observa cómo el motor multitarea convierte señales del ERP en riesgos, metas y recomendaciones accionables." actions={<div className="nn-header-actions"><span className={`nn-state nn-state-${engineState.toLocaleLowerCase().replace(/ /g, '-')}`}><i />{engineState}</span><button className="ws-button" onClick={startTraining}><Zap size={15} />Entrenar modelo</button></div>} />

    <div className="nn-summary"><Metric label="Modelo publicado" value="v0.8.4" detail="actualizado hace 12 min" tone="teal" /><Metric label="Calidad de validación" value="91.8%" detail="+3.4 pp vs. versión anterior" tone="green" /><Metric label="Señales activas" value="1,248" detail={`${metrics.sales} · ${metrics.inventory} · ${metrics.finance}`} tone="violet" /><Metric label="Inferencias hoy" value="384" detail="96 recomendaciones generadas" tone="amber" /></div>

    <div className="nn-layout">
      <section className="ws-card nn-network-card">
        <div className="ws-card-heading"><div><h2>Arquitectura multitarea</h2><p>ERP → representación compartida → cuatro cabezas de salida</p></div><div className="nn-controls"><button className="nn-icon-button" onClick={() => setPaused(value => !value)} aria-label={paused ? 'Reanudar animación' : 'Pausar animación'}>{paused ? <Play size={15} /> : <Pause size={15} />}</button><label>Velocidad <select value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label><button className="nn-icon-button" onClick={resetDemo} aria-label="Restablecer demo"><RotateCcw size={15} /></button></div></div>
        <div className="nn-stage"><svg viewBox="0 0 570 470" role="img" aria-label="Diagrama animado de la red neuronal"><defs><linearGradient id="nn-flow" x1="0" x2="1"><stop offset="0" stopColor="var(--ws-primary)" /><stop offset="1" stopColor="var(--ws-violet)" /></linearGradient><filter id="nn-glow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>{allEdges}<g className="nn-layer-labels"><text x="48" y="455">SEÑALES ERP</text><text x="198" y="455">REPRESENTACIÓN</text><text x="425" y="455">SALIDAS</text></g>{inputNodes.map(node => <g key={node.label} className="nn-node-group" onClick={() => setSelectedNode(node)}><circle cx={node.x} cy={node.y} r="14" className="nn-node input" filter="url(#nn-glow)" /><text x={node.x - 38} y={node.y + 31} className="nn-node-text">{node.label}</text></g>)}{hiddenNodes.map(node => <g key={node.label} className="nn-node-group" onClick={() => setSelectedNode(node)}><circle cx={node.x} cy={node.y} r="13" className="nn-node hidden" /><text x={node.x - 7} y={node.y + 4} className="nn-node-mini">{node.label}</text></g>)}{outputNodes.map(node => <g key={node.label} className="nn-node-group" onClick={() => setSelectedNode(node)}><circle cx={node.x} cy={node.y} r="17" className={`nn-node output ${node.tone ?? ''}`} filter="url(#nn-glow)" /><circle cx={node.x} cy={node.y} r="7" className="nn-node-core" /><text x={node.x + 26} y={node.y + 4} className="nn-node-text output-label">{node.label}</text></g>)}</svg>{selectedNode && <button className="nn-inspector" onClick={() => setSelectedNode(null)}><CircleHelp size={15} /><span><strong>{selectedNode.label}</strong><small>Activación 0.{selectedNode.label.length}7 · peso conectado 0.84</small></span><ChevronRight size={15} /></button>}</div>
        <div className="nn-training-bar"><div><span><Activity size={14} />{engineState === 'DEMO' ? 'Inferencia demostrativa' : `Época ${Math.min(42, Math.ceil(progress * .42))} de 42`}</span><strong>{progress}%</strong></div><div className="nn-progress"><i style={{ width: `${progress}%` }} /></div><small>{engineState === 'DEMO' ? 'Datos de ejemplo conectados al esquema ERP. Ejecuta un entrenamiento para actualizar pesos.' : engineState === 'Validando' ? 'Validando contra el conjunto holdout…' : engineState === 'Publicado' ? 'Pesos validados y listos para publicar.' : 'Ajustando pesos con métricas de Ventas, Inventario, Tesorería, Compras, Logística y Metas.'}</small></div>
      </section>

      <aside className="nn-side"><section className="ws-card nn-status-card"><div className="ws-card-heading"><div><h2>Estado del motor</h2><p>Última ejecución y disponibilidad</p></div><Gauge size={19} /></div><div className="nn-status-body"><div className="nn-status-main"><span className={`nn-live-dot ${engineState === 'DEMO' ? 'demo' : ''}`} /><strong>{engineState}</strong><small>{engineState === 'Inferencia activa' ? 'Listo para producir predicciones' : 'Motor en modo de supervisión'}</small></div><dl><div><dt>Modelo</dt><dd>multitask-v0.8.4</dd></div><div><dt>Loss final</dt><dd>0.0842</dd></div><div><dt>Épocas</dt><dd>42 / 42</dd></div><div><dt>Latencia</dt><dd>118 ms</dd></div></dl></div></section><section className="nn-legend"><strong><Sparkles size={15} />Inspecciona la red</strong><span>Haz clic en una neurona para revisar activación y peso. Pausa la animación para comparar el flujo entre capas.</span></section></aside>
    </div>

    <section className="nn-recommendations"><div className="nn-section-title"><div><span className="ec-eyebrow">INFERENCIA ACTIVA</span><h2>Bandeja de recomendaciones IA</h2><p>Cada sugerencia muestra los factores que explican su prioridad para que el equipo pueda decidir con contexto.</p></div><span className="nn-count">3 pendientes de revisión</span></div><div className="nn-recommendation-grid">{recommendations.map(item => <article className={`ws-card nn-recommendation ${item.tone}`} key={item.id}><div className="nn-rec-top"><span className="nn-rec-icon"><Sparkles size={16} /></span><span className="nn-confidence">Confianza {item.score}</span></div><h3>{item.title}</h3><p>{item.detail}</p><div className="nn-factors">{item.factors.map(factor => <span key={factor}>{factor}</span>)}</div><div className="nn-rec-actions"><button className={feedback[item.id] === 'Útil' ? 'is-selected' : ''} onClick={() => setFeedback(current => ({ ...current, [item.id]: 'Útil' }))}><ThumbsUp size={14} />{feedback[item.id] === 'Útil' ? 'Marcada útil' : 'Útil'}</button><button className={feedback[item.id] === 'Descartada' ? 'is-selected danger' : ''} onClick={() => setFeedback(current => ({ ...current, [item.id]: 'Descartada' }))}><ThumbsDown size={14} />{feedback[item.id] === 'Descartada' ? 'Descartada' : 'Descartar'}</button></div></article>)}</div><div className="nn-demo-note"><Check size={15} /> DEMO: las recomendaciones se generan con datos de muestra hasta que `enterprise-neural-engine` publique las predicciones reales.</div></section><div className="nn-back-link"><Link to="/mantenimientos#api-webhooks">Configurar API y webhooks <ChevronRight size={14} /></Link></div>
  </>
}
