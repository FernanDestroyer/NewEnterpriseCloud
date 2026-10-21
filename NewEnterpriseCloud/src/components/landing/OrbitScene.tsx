import { useId, type PointerEvent } from 'react'
import logoAnimation from '../../assets/enterprisecloud-logo.gif'
import logoNegro from '../../assets/enterprisecloud-logo-negro.png'

export function BrandEmblem({ className = '' }: { className?: string }) {
  return (
    <span className={`home-emblem ${className}`} aria-hidden="true">
      <img className="emblem-img emblem-img--dark" src={logoAnimation} alt="" draggable={false} />
      <img className="emblem-img emblem-img--light" src={logoNegro} alt="" draggable={false} />
    </span>
  )
}

export default function OrbitScene() {
  const gradientId = useId()

  const moveScene = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const bounds = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty('--orbit-x', `${((event.clientX - bounds.left) / bounds.width - .5) * 14}px`)
    event.currentTarget.style.setProperty('--orbit-y', `${((event.clientY - bounds.top) / bounds.height - .5) * 14}px`)
  }

  return (
    <div className="home-orbit" onPointerMove={moveScene} onPointerLeave={(event) => {
      event.currentTarget.style.setProperty('--orbit-x', '0px')
      event.currentTarget.style.setProperty('--orbit-y', '0px')
    }} aria-hidden="true">
      <div className="home-orbit-grid" />
      <span className="home-orbit-coordinate home-orbit-coordinate--top">EC / SISTEMA CONECTADO</span>
      <div className="home-orbit-stage">
        <svg className="home-orbit-drawing" viewBox="0 0 600 600" fill="none" focusable="false">
          <defs>
            <linearGradient id={gradientId} x1="90" y1="150" x2="520" y2="480" gradientUnits="userSpaceOnUse">
              <stop className="home-orbit-gradient-start" />
              <stop offset="1" className="home-orbit-gradient-end" />
            </linearGradient>
          </defs>
          <path className="home-orbit-guides" d="M300 18v50m0 464v50M18 300h50m464 0h50M292 42h16M42 292v16m516-0v16M292 558h16" />
          <circle className="home-orbit-ticks" cx="300" cy="300" r="251" strokeDasharray="1 14" />
          <circle className="home-orbit-outer" cx="300" cy="300" r="219" />
          <circle className="home-orbit-inner" cx="300" cy="300" r="135" />
          <g transform="rotate(-32 300 300)">
            <ellipse className="home-orbit-path" cx="300" cy="300" rx="279" ry="107" stroke={`url(#${gradientId})`} />
            <ellipse className="home-orbit-trail" cx="300" cy="300" rx="279" ry="107" stroke={`url(#${gradientId})`} pathLength="100" strokeDasharray="9 91" />
          </g>
          <g transform="rotate(37 300 300)">
            <ellipse className="home-orbit-path home-orbit-path--secondary" cx="300" cy="300" rx="268" ry="111" />
          </g>
          <g className="home-orbit-satellite home-orbit-satellite--outer">
            <circle className="home-orbit-node-halo" cx="300" cy="81" r="13" />
            <circle className="home-orbit-node" cx="300" cy="81" r="5" />
          </g>
          <g className="home-orbit-satellite home-orbit-satellite--inner">
            <circle className="home-orbit-node-halo" cx="435" cy="300" r="10" />
            <circle className="home-orbit-node" cx="435" cy="300" r="4" />
          </g>
          <circle className="home-orbit-fixed-node" cx="146" cy="145" r="4" />
          <circle className="home-orbit-fixed-node home-orbit-fixed-node--violet" cx="473" cy="435" r="4" />
        </svg>
        <div className="home-orbit-core"><BrandEmblem /></div>
        <span className="home-orbit-label home-orbit-label--sales">Ventas</span>
        <span className="home-orbit-label home-orbit-label--stock">Inventario</span>
        <span className="home-orbit-label home-orbit-label--finance">Finanzas</span>
      </div>
      <div className="home-orbit-caption"><span>Una visión completa</span><span>10 / MÓDULOS</span></div>
    </div>
  )
}
