import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ArrowLeft, Eye, EyeOff, Loader2, Lock, LogIn, Mail, MailCheck, Moon, ShieldCheck, Sun, User, UserPlus } from 'lucide-react'
import { LogoMark } from './LogoMark'
import LoadingScreen from './LoadingScreen'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import './login.css'

const MIN_PASSWORD = 8

export default function LoginPage({ mode = 'login' }: { mode?: 'login' | 'register' }) {
  const { theme, toggleTheme } = useTheme()
  const { session, loading: authLoading, configured, signIn, signUp } = useAuth()
  const registering = mode === 'register'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  if (authLoading) return <LoadingScreen />
  if (session) return <Navigate to="/dashboard" replace />

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setNotice('')
    if (loading) return

    if (registering) {
      if (name.trim().length < 2) return setError('Escribe tu nombre completo.')
      if (password.length < MIN_PASSWORD) return setError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`)
      if (password !== confirm) return setError('Las contraseñas no coinciden.')
    }

    setLoading(true)
    try {
      if (registering) {
        const result = await signUp(name, email, password)
        if (result.error) setError(result.error)
        else if (result.needsConfirmation) setNotice(`Cuenta creada. Te enviamos un correo de confirmación a ${email.trim()}. Ábrelo para activar tu acceso y luego inicia sesión.`)
        // Si no requiere confirmación, la sesión se activa y esta página redirige al panel.
      } else {
        const message = await signIn(email, password)
        if (message) setError(message)
      }
    } catch (error) {
      setError((error as Error).message || 'No se pudo conectar con Supabase. Inténtalo nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="erp-shell login-shell" data-theme={theme}>
      <div className="login-bg" aria-hidden="true" />
      <header className="login-top">
        <Link to="/" className="login-back"><ArrowLeft size={16} /> Volver al inicio</Link>
        <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </header>

      <main className="login-main">
        <form className="login-card" onSubmit={submit} aria-labelledby="login-title">
          <span className="login-logo"><LogoMark className="login-mark" /></span>
          <p className="login-eyebrow"><ShieldCheck size={13} /> {registering ? 'CREAR CUENTA' : 'ACCESO AL SISTEMA'}</p>
          <h1 id="login-title">{registering ? 'Crea tu cuenta.' : 'Bienvenido de nuevo.'}</h1>
          <p className="login-sub">{registering ? 'Regístrate para guardar y consultar tu información empresarial en la nube.' : 'Accede con tu cuenta para continuar.'}</p>

          {!configured && (
            <p className="login-error" role="alert">Falta conectar la base de datos. Copia <strong>.env.example</strong> como <strong>.env</strong>, completa <strong>VITE_SUPABASE_URL</strong> y <strong>VITE_SUPABASE_ANON_KEY</strong> y reinicia el servidor.</p>
          )}

          {registering && (
            <label className="login-field">
              <span>Nombre completo</span>
              <span className="login-input"><User size={16} /><input type="text" name="name" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Tu nombre" /></span>
            </label>
          )}

          <label className="login-field">
            <span>Correo electrónico</span>
            <span className="login-input"><Mail size={16} /><input type="email" name="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@empresa.pe" /></span>
          </label>

          <label className="login-field">
            <span>Contraseña</span>
            <span className="login-input">
              <Lock size={16} />
              <input type={showPassword ? 'text' : 'password'} name="password" autoComplete={registering ? 'new-password' : 'current-password'} required minLength={registering ? MIN_PASSWORD : undefined} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" />
              <button type="button" className="login-eye" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
          </label>

          {registering && (
            <label className="login-field">
              <span>Confirmar contraseña</span>
              <span className="login-input"><Lock size={16} /><input type={showPassword ? 'text' : 'password'} name="confirm" autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="••••••••" /></span>
            </label>
          )}

          {error && <p className="login-error" role="alert">{error}</p>}
          {notice && <p className="login-notice" role="status"><MailCheck size={14} /> {notice}</p>}

          <button className="primary-button login-submit" type="submit" disabled={loading || !configured}>
            {loading ? <Loader2 size={17} className="login-spin" /> : registering ? <UserPlus size={17} /> : <LogIn size={17} />}
            {loading ? (registering ? 'Creando cuenta…' : 'Verificando acceso…') : registering ? 'Crear cuenta' : 'Iniciar sesión'}
          </button>

          <p className="login-switch">
            {registering ? <>¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link></> : <>¿Aún no tienes cuenta? <Link to="/registro">Regístrate</Link></>}
          </p>
        </form>
      </main>
    </div>
  )
}
