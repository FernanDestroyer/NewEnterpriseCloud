import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Camera, CheckCircle2, Save, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecords } from '../context/RecordsContext'
import { DATA_PAGES, pageMeta } from '../data/catalog'
import { displayDate } from '../data/workspace'

const MAX_IMAGE_BYTES = 350 * 1024
const AVATAR_SIZE = 256

function processImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('El archivo debe ser una imagen (JPG, PNG o WebP).'))
      return
    }
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      try {
        const scale = Math.min(1, AVATAR_SIZE / Math.max(image.width, image.height))
        const width = Math.max(1, Math.round(image.width * scale))
        const height = Math.max(1, Math.round(image.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Tu navegador no pudo procesar la imagen.')
        context.drawImage(image, 0, 0, width, height)
        URL.revokeObjectURL(url)
        let dataUrl = canvas.toDataURL('image/jpeg', 0.82)
        if (dataUrl.length > MAX_IMAGE_BYTES * 1.4) dataUrl = canvas.toDataURL('image/jpeg', 0.6)
        if (dataUrl.length > MAX_IMAGE_BYTES * 1.4) throw new Error('La imagen es demasiado grande. Usa una foto de menos de 350 KB.')
        resolve(dataUrl)
      } catch (error) {
        URL.revokeObjectURL(url)
        reject(error)
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo leer la imagen. Prueba con otro archivo.'))
    }
    image.src = url
  })
}

export default function ProfilePage() {
  const { profile, session, can, updateProfile } = useAuth()
  const { notify } = useRecords()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<string | null | undefined>(undefined)
  const fileRef = useRef<HTMLInputElement>(null)
  const initials = profile?.nombre.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('es')
  const avatar = preview === undefined ? profile?.avatarUrl ?? null : preview

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy) return
    setError('')
    processImage(file)
      .then(setPreview)
      .catch((uploadError) => setError((uploadError as Error).message))
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    setBusy(true); setError('')
    try {
      await updateProfile(String(form.get('nombre') ?? ''), preview === undefined ? undefined : preview)
      setPreview(undefined)
      notify('Perfil actualizado en Supabase.')
    }
    catch (saveError) { setError((saveError as Error).message) }
    finally { setBusy(false) }
  }

  return <><section className="ws-page-heading"><div><span className="ws-eyebrow">TU CUENTA</span><h1>Mi perfil</h1><p>Información de tu cuenta y permisos de tu espacio de trabajo.</p></div></section><div className="ws-profile-grid"><section className="ws-card"><div className="ws-profile-identity"><span className="ws-avatar ws-avatar-large">{avatar ? <img src={avatar} alt="Foto de perfil" /> : initials}</span><div><h2>{profile?.nombre}</h2><p>{profile?.rol} · Cuenta de Supabase Auth</p><div className="ws-avatar-actions"><button className="ws-button ws-button-secondary" type="button" disabled={busy} onClick={() => fileRef.current?.click()}><Camera size={15} />{avatar ? 'Cambiar foto' : 'Subir foto'}</button>{avatar && <button className="ws-icon-button" type="button" disabled={busy} aria-label="Quitar foto de perfil" title="Quitar foto" onClick={() => setPreview(null)}><Trash2 size={15} /></button>}</div><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={chooseFile} aria-label="Seleccionar foto de perfil" /></div></div><form className="ws-form" onSubmit={save}><label>Nombre completo<input key={profile?.id} name="nombre" defaultValue={profile?.nombre} minLength={2} required /></label><label>Correo electrónico<input type="email" readOnly value={profile?.email ?? ''} /></label><div className="ws-notice"><CheckCircle2 size={18} /><span>Cuenta creada el {displayDate(session?.user.created_at)}. Tu perfil se conserva en la base de datos.</span></div>{error && <p className="ws-notice ws-notice-warning" role="alert">{error}</p>}<div><button className="ws-button" disabled={busy} type="submit"><Save size={16} />{busy ? 'Guardando…' : 'Guardar cambios'}</button></div></form></section><section className="ws-card"><div className="ws-card-heading"><div><h2>Permisos efectivos</h2><p>Autorizaciones obtenidas de Supabase</p></div><ShieldCheck size={21} /></div><div className="ws-permissions">{DATA_PAGES.filter(page => can(page)).map(page => <div className="ws-permission-row" key={page}><strong>{pageMeta[page].title}</strong>{(['ver', 'crear', 'editar', 'eliminar', 'importar'] as const).filter(action => can(page, action)).map(action => <span key={action}>{action === 'ver' ? 'Consultar' : action === 'importar' ? 'Importar CSV' : action}</span>)}</div>)}{!DATA_PAGES.some(page => can(page)) && <p className="relation-hint"><UserRound size={16} />Tu rol no tiene permisos de módulos asignados.</p>}</div></section></div></>
}
