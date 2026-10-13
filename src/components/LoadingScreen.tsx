import { LogoMark } from './LogoMark'

export default function LoadingScreen() {
  return (
    <div className="boot-screen" role="status" aria-label="Cargando panel">
      <span className="boot-logo-wrap">
        <LogoMark className="boot-logo" />
      </span>
      <p>Preparando tu panel<span className="boot-dots" aria-hidden="true" /></p>
      <span className="boot-bar" aria-hidden="true"><i /></span>
    </div>
  )
}
