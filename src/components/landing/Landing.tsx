import { useEffect, useRef, type CSSProperties } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, Boxes, ChartNoAxesCombined, Check, FileText, Files, Landmark, LayoutDashboard, Moon, PackageCheck, Pencil, Sun, TrendingUp, type LucideIcon } from 'lucide-react'
import OrbitScene from './OrbitScene'
import ProductPreview, { type PreviewData } from './ProductPreview'
import './landing.css'

type LandingProps = {
  onEnter: () => void
  onToggleTheme: () => void
  theme: 'dark' | 'light'
  previewData: PreviewData
}

const features = [
  { key: 'commercial', number: '01', label: 'VENTAS Y COMPRAS', title: 'Radar comercial', text: 'Del comprobante al cobro. Sigue cada operación, encuentra un cliente y revisa qué queda pendiente.', icon: ChartNoAxesCombined, detail: 'El detalle detrás de cada venta.' },
  { key: 'stock', number: '02', label: 'INVENTARIO', title: 'Stock que avisa', text: 'Productos, existencias y almacenes a la vista. Detecta lo que necesita reposición antes de la siguiente venta.', icon: PackageCheck, detail: 'Cada producto, en su lugar.' },
  { key: 'finance', number: '03', label: 'FINANZAS', title: 'Tesorería clara', text: 'Consulta montos, contrapartes y estados. Distingue las cuentas por cobrar de las obligaciones por pagar.', icon: Landmark, detail: 'Tus pendientes, bien ordenados.' },
  { key: 'documents', number: '04', label: 'DOCUMENTOS Y REPORTES', title: 'Memoria total', text: 'Organiza las referencias de tus documentos y reportes. Encuentra el registro que necesitas sin perder el contexto.', icon: Files, detail: 'La información que necesitas, a mano.' },
] as const

const steps: { name: string; icon: LucideIcon; text: string; result: string }[] = [
  { name: 'Conecta', icon: LayoutDashboard, text: 'Empieza con una vista general. Identifica tus módulos y ubica la información del día.', result: 'Toda tu operación a la vista' },
  { name: 'Opera', icon: Pencil, text: 'Registra, corrige y filtra. Los cambios se reflejan en el panel mientras sigues trabajando.', result: 'Menos pasos para actualizar' },
  { name: 'Decide', icon: TrendingUp, text: 'Revisa lo pendiente, atiende las alertas y exporta la información que vas a compartir.', result: 'Del dato a la siguiente acción' },
]

function FeatureIllustration({ kind }: { kind: typeof features[number]['key'] }) {
  if (kind === 'commercial') return (
    <div className="home-feature-visual home-chart-visual" aria-hidden="true">
      <div className="home-chart-bars">{[28, 45, 37, 60, 52, 75, 66, 88, 78, 98].map((height, index) => <i key={index} style={{ '--bar-height': `${height}%`, '--bar-delay': `${index * 70}ms` } as CSSProperties} />)}</div>
      <svg viewBox="0 0 320 110" preserveAspectRatio="none" fill="none"><path d="M0 93C24 93 25 78 52 80S86 87 108 62 148 71 177 43 216 56 241 25 285 33 320 8" /></svg>
      <span className="home-visual-caption">Registra. Revisa. Continúa.</span>
    </div>
  )
  if (kind === 'stock') return (
    <div className="home-feature-visual home-stock-visual" aria-hidden="true">
      <div className="home-stock-grid">{Array.from({ length: 8 }, (_, index) => <span key={index} className={index === 6 ? 'is-low' : ''}><Boxes size={23} strokeWidth={1.6} /></span>)}</div>
      <span className="home-visual-caption"><span className="home-stock-indicator" /> Detecta lo que necesita atención</span>
    </div>
  )
  if (kind === 'finance') return (
    <div className="home-feature-visual home-finance-visual" aria-hidden="true">
      <div><span>Por cobrar</span><i><b /></i><ArrowUpRight size={17} /></div>
      <div><span>Por pagar</span><i><b /></i><ArrowDown size={17} /></div>
      <span className="home-visual-caption">Dos movimientos. Una visión clara.</span>
    </div>
  )
  return (
    <div className="home-feature-visual home-files-visual" aria-hidden="true">
      <span className="home-paper home-paper--back"><FileText size={24} /><i /><i /></span>
      <span className="home-paper home-paper--front"><FileText size={27} /><i /><i /><span><Check size={12} /> Organizado</span></span>
      <span className="home-visual-caption">Documentos · Reportes · Referencias</span>
    </div>
  )
}

function FeatureGrid() {
  return (
    <section className="home-module-section home-container home-reveal" id="modulos" aria-labelledby="home-modules-title">
      <div className="home-section-heading">
        <div><span className="home-eyebrow">01 / CADA ÁREA, CON SU ESPACIO</span><h2 id="home-modules-title">Todo lo importante.<br /><span>Bien conectado.</span></h2></div>
        <p>Cuatro formas de mantener el control, con el detalle que necesita cada parte de tu negocio.</p>
      </div>
      <div className="home-feature-grid">
        {features.map(({ key, number, label, title, text, icon: Icon, detail }) => (
          <article className={`home-feature home-feature--${key}`} key={key}>
            <div className="home-feature-top"><span className="home-feature-icon"><Icon size={29} strokeWidth={1.7} /></span><span>{number} / {label}</span></div>
            <div className="home-feature-copy"><h3>{title}</h3><p>{text}</p></div>
            <FeatureIllustration kind={key} />
            <div className="home-feature-bottom"><span>{detail}</span><Check size={15} aria-hidden="true" /></div>
          </article>
        ))}
      </div>
    </section>
  )
}

function Workflow() {
  return (
    <section className="home-workflow-section home-container home-reveal" id="como-funciona" aria-labelledby="home-workflow-title">
      <div className="home-section-heading">
        <div><span className="home-eyebrow">03 / ASÍ SE MUEVE TU DÍA</span><h2 id="home-workflow-title">De la entrada<br /><span>a la decisión.</span></h2></div>
        <p>Un recorrido corto entre lo que pasa en tu negocio y lo que necesitas hacer después.</p>
      </div>
      <ol className="home-workflow">
        {steps.map(({ name, icon: Icon, text, result }, index) => (
          <li key={name}>
            <div className="home-step-track"><span className="home-step-icon"><Icon size={25} strokeWidth={1.8} /></span>{index < steps.length - 1 && <span className="home-step-connector" aria-hidden="true"><i /><ArrowRight size={13} /></span>}</div>
            <div className="home-step-heading"><span>0{index + 1}</span><h3>{name}</h3></div>
            <p>{text}</p>
            <span className="home-step-result"><Check size={15} />{result}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default function Landing({ onEnter, onToggleTheme, theme, previewData }: LandingProps) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (motion.matches || !('IntersectionObserver' in window)) return
    const elements = root.current?.querySelectorAll<HTMLElement>('.home-reveal') ?? []
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.setAttribute('data-visible', 'true')
          observer.unobserve(entry.target)
        }
      })
    }, { threshold: .08 })
    elements.forEach((element) => {
      if (element.getBoundingClientRect().top > window.innerHeight) element.dataset.visible = 'false'
      observer.observe(element)
    })
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={root} className="home-page" data-theme={theme} id="inicio">
      <a className="home-skip-link" href="#home-main">Ir al contenido</a>
      <header className="home-header">
        <div className="home-container home-header-inner">
          <a href="#inicio" className="home-brand" aria-label="Enterprise, inicio"><span>ENTERPRISE<span className="home-brand-dot">.</span></span></a>
          <nav className="home-nav" aria-label="Secciones de la página de inicio"><a href="#modulos">Módulos</a><a href="#vista-previa">Vista previa</a><a href="#como-funciona">Cómo funciona</a></nav>
          <button className="home-theme-toggle" type="button" onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'} title={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}>{theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</button>
        </div>
      </header>
      <main id="home-main">
        <section className="home-hero home-container" aria-labelledby="home-title">
          <div className="home-hero-copy">
            <span className="home-eyebrow home-hero-intro"><span /> GESTIÓN EMPRESARIAL, A TU RITMO</span>
            <h1 id="home-title">Tu negocio.<br />Una sola<br /><span className="home-title-accent">órbita<span className="home-title-period">.</span></span></h1>
            <p>Ventas, inventario y finanzas en el mismo lugar. Ten una visión completa de tu operación y espacio para lo que sigue.</p>
            <div className="home-hero-actions"><button type="button" className="home-enter" onClick={onEnter}>Iniciar sesión <span><ArrowUpRight size={21} /></span></button><a href="#modulos" className="home-explore">Explorar módulos <ArrowDown size={16} /></a></div>
          </div>
          <OrbitScene />
          <div className="home-hero-bottom"><span>DESCUBRE ENTERPRISE <ArrowDown size={14} /></span></div>
        </section>
        <section className="home-facts" aria-label="Lo esencial del producto">
          <div className="home-container home-facts-grid">
            <div><strong>10<span> módulos</span></strong><p>De ventas a reportes, en el mismo espacio.</p></div>
            <div><strong>01<span> visión completa</span></strong><p>Encuentra tus registros entre todas las áreas.</p></div>
            <div><strong>03<span> formatos de salida</span></strong><p>PDF, CSV y Excel para seguir trabajando.</p></div>
          </div>
        </section>
        <FeatureGrid />
        <ProductPreview data={previewData} />
        <Workflow />
      </main>
      <footer className="home-footer">
        <div className="home-container">
          <div className="home-footer-top"><p>Tu operación, en orden.<br /><span>Tu siguiente paso, más claro.</span></p><a href="#inicio" aria-label="Volver al inicio"><ArrowUpRight size={24} /></a></div>
          <div className="home-footer-wordmark" aria-hidden="true">ENTERPRISE<span>®</span></div>
          <div className="home-footer-bottom"><span>EnterpriseCloud</span><span>Hecho para el trabajo de cada día.</span><span>Tus registros se guardan en Supabase.</span></div>
        </div>
      </footer>
    </div>
  )
}
