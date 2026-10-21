import logoAnimation from '../assets/enterprisecloud-logo.gif'
import logoNegro from '../assets/enterprisecloud-logo-negro.png'

export function LogoMark({ className = '' }: { className?: string }) {
  return (
    <span className={`logo-mark orbit-logo ${className}`} aria-label="Logotipo de EnterpriseCloud" role="img">
      <img className="logo-img logo-img--dark" src={logoAnimation} alt="" />
      <img className="logo-img logo-img--light" src={logoNegro} alt="" />
      <svg className="orbit-ring" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <circle className="orbit-track" cx="24" cy="24" r="21" />
        <circle className="orbit-satellite" cx="45" cy="24" r="2.6" />
      </svg>
    </span>
  )
}
