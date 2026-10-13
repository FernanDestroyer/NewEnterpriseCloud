import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Plus } from 'lucide-react'
import { LogoMark } from '../LogoMark'
import { useAuth } from '../../context/AuthContext'
import { useRecords } from '../../context/RecordsContext'

// Recorridos de los satélites como paths para animateMotion.
// Capas anidadas con aire entre sí: núcleo (r≈110) < anillo (120) < segmentos (138) < elipses (162–205) < puntos (225).
const TEAL_ORBIT_PATH = 'M 55 260 A 205 162 0 1 1 465 260 A 205 162 0 1 1 55 260'
const VIOLET_ORBIT_PATH = 'M 65 260 A 195 168 0 1 1 455 260 A 195 168 0 1 1 65 260'
const DOTS_ORBIT_PATH = 'M 35 260 A 225 225 0 1 1 485 260 A 225 225 0 1 1 35 260'

function HeroOrbit() {
  const svgRef = useRef<SVGSVGElement>(null)

  // Con movimiento reducido se pausan los satélites (SMIL no obedece al CSS).
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => {
      if (query.matches) svg.pauseAnimations()
      else svg.unpauseAnimations()
    }
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])

  return (
    <div className="hero-orbit" aria-hidden="true">
      <div className="hero-orbit-stage">
      <svg ref={svgRef} className="hero-orbit-drawing" viewBox="0 0 520 520" fill="none" focusable="false">
        <circle className="hero-orbit-dots" cx="260" cy="260" r="225" strokeDasharray="1 10" />
        <circle className="hero-orbit-node-halo" r="11">
          <animateMotion dur="26s" repeatCount="indefinite" path={DOTS_ORBIT_PATH} />
        </circle>
        <circle className="hero-orbit-node" r="5">
          <animateMotion dur="26s" repeatCount="indefinite" path={DOTS_ORBIT_PATH} />
        </circle>
        <g transform="rotate(-28 260 260)">
          <ellipse className="hero-orbit-path" cx="260" cy="260" rx="205" ry="162" />
          <ellipse className="hero-orbit-trail" cx="260" cy="260" rx="205" ry="162" pathLength="100" strokeDasharray="7 93" />
          <circle className="hero-orbit-node-halo" r="12">
            <animateMotion dur="12s" repeatCount="indefinite" path={TEAL_ORBIT_PATH} />
          </circle>
          <circle className="hero-orbit-node" r="5.5">
            <animateMotion dur="12s" repeatCount="indefinite" path={TEAL_ORBIT_PATH} />
          </circle>
        </g>
        <g transform="rotate(38 260 260)">
          <ellipse className="hero-orbit-path hero-orbit-path--secondary" cx="260" cy="260" rx="195" ry="168" />
          <circle className="hero-orbit-node-halo hero-orbit-halo--soft" r="9">
            <animateMotion dur="17s" repeatCount="indefinite" path={VIOLET_ORBIT_PATH} />
          </circle>
          <circle className="hero-orbit-node hero-orbit-node--small" r="4">
            <animateMotion dur="17s" repeatCount="indefinite" path={VIOLET_ORBIT_PATH} />
          </circle>
          <circle className="hero-orbit-node-halo" r="10">
            <animateMotion dur="23s" repeatCount="indefinite" begin="-8s" path={VIOLET_ORBIT_PATH} />
          </circle>
          <circle className="hero-orbit-node" r="4.5">
            <animateMotion dur="23s" repeatCount="indefinite" begin="-8s" path={VIOLET_ORBIT_PATH} />
          </circle>
        </g>
        <circle className="hero-orbit-core-ring" cx="260" cy="260" r="120" />
        <circle className="hero-orbit-dashes" cx="260" cy="260" r="138" strokeDasharray="26 24" />
      </svg>
      <div className="hero-orbit-core"><LogoMark className="hero-logo" /></div>
      </div>
    </div>
  )
}

export default function OrbitalHero() {
  const { can } = useAuth()
  const { openComposer, loading, refreshing, lastSyncedAt, errors } = useRecords()
  const navigate = useNavigate()
  const hasErrors = Object.keys(errors).length > 0
  return (
    <section className="ws-orbital-hero" aria-labelledby="orbital-hero-title">
      <div className="ws-orbital-copy">
        <span className="ws-orbital-kicker"><i /> CENTRO DE CONTROL</span>
        <h1 id="orbital-hero-title">Tu negocio,<br /><span>en una sola órbita.</span></h1>
        <p>Ventas, inventario y finanzas en el mismo lugar. Registra movimientos, atiende alertas y exporta sin fricción.</p>
        <div className="ws-orbital-actions">
          {can('sales', 'crear') && <button className="primary-button ws-orbital-cta" type="button" onClick={() => openComposer('sales')}><Plus size={18} />Registrar venta</button>}
          {can('reports') && <button className="ws-orbital-link" type="button" onClick={() => navigate('/reports')}>Ver analítica<ArrowRight size={16} /></button>}
        </div>
        <div className={`ws-orbital-footnote${hasErrors ? ' has-warning' : ''}`}>
          <span><i />{loading || refreshing ? 'Consultando Supabase' : hasErrors ? 'Consulta con avisos' : 'Datos conectados a Supabase'}</span>
          {lastSyncedAt && <span>Última consulta: {lastSyncedAt.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</span>}
        </div>
      </div>
      <div className="ws-orbital-visual"><HeroOrbit /></div>
    </section>
  )
}
