import type { ReactNode } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import '../../enterprise-ui.css'

export function PageHeader({ title, description, section, icon: Icon, actions }: {
  title: string; description: string; section: string; icon: LucideIcon; actions?: ReactNode
}) {
  return <header className="ec-page-header">
    <nav className="ec-breadcrumbs" aria-label="Ruta de navegación"><Link to="/dashboard">Espacio de trabajo</Link><ChevronRight size={12} /><span>{section}</span><ChevronRight size={12} /><span aria-current="page">{title}</span></nav>
    <div className="ec-page-header-main"><span className="ec-page-icon"><Icon size={25} strokeWidth={1.6} /></span><div><span className="ec-eyebrow">{section}</span><h1>{title}</h1><p>{description}</p></div><div className="ec-page-actions">{actions}</div></div>
  </header>
}
