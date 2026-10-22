import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ImagePlus, QrCode, RefreshCw, Save, Trash2 } from 'lucide-react'
import { EMPTY_YAPE_SETTINGS, WALLETS, type WalletId, type YapeSettings } from '../data/payments'
import { fetchWalletSettings, readYapeQrFile, saveWalletSettings } from '../services/yape'
import { friendlyError } from '../services/records'

export default function YapeSettingsForm({ wallet = 'yape', canCreate, canEdit, onSaved }: { wallet?: WalletId; canCreate: boolean; canEdit: boolean; onSaved: () => Promise<void> }) {
  const label = WALLETS[wallet].label
  const [settings, setSettings] = useState<YapeSettings>({ ...EMPTY_YAPE_SETTINGS })
  const [exists, setExists] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadIndex, setReloadIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  const editable = exists ? canEdit : canCreate

  useEffect(() => {
    let active = true
    mounted.current = true
    setLoading(true)
    setLoadFailed(false)
    setMessage('')
    fetchWalletSettings(wallet).then(saved => {
      if (!active) return
      setExists(Boolean(saved))
      setSettings(saved ?? { ...EMPTY_YAPE_SETTINGS })
    }).catch(error => { if (active) { setMessage(friendlyError(error)); setLoadFailed(true) } })
      .finally(() => active && setLoading(false))
    return () => { active = false; mounted.current = false }
  }, [reloadIndex, wallet])

  const chooseImage = async (file?: File) => {
    if (!file || busy || !editable) return
    setBusy(true); setMessage(''); setSuccess(false)
    try {
      const qrImage = await readYapeQrFile(file)
      if (mounted.current) setSettings(current => ({ ...current, qrImage, enabled: true }))
    } catch (error) { if (mounted.current) setMessage(friendlyError(error)) }
    finally { if (mounted.current) setBusy(false) }
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (loading || busy || !editable) return
    setBusy(true); setMessage(''); setSuccess(false)
    try {
      await saveWalletSettings(wallet, settings)
      if (mounted.current) setExists(true)
      await onSaved()
      if (mounted.current) { setSuccess(true); setMessage(`QR de ${label} guardado. Ya se puede mostrar al registrar una venta.`) }
    } catch (error) { if (mounted.current) setMessage(friendlyError(error)) }
    finally { if (mounted.current) setBusy(false) }
  }

  if (loading) return <div className="ws-empty-compact"><RefreshCw size={24} className="ws-spin" /><strong>Cargando configuración de {label}…</strong></div>
  if (loadFailed) return <div className="ws-notice ws-notice-warning" role="alert"><span>{message}</span><button className="ws-text-button" type="button" onClick={() => setReloadIndex(value => value + 1)}>Reintentar</button></div>

  return <form className="ws-form yape-settings-form" onSubmit={save}>
    <div className="yape-settings-preview">
      {settings.qrImage ? <img src={settings.qrImage} alt={`Vista previa de tu QR de ${label}`} /> : <div className="yape-qr-placeholder"><QrCode size={44} /><span>Carga tu QR original de {label}</span></div>}
    </div>
    {editable && <div className="ws-heading-actions">
      <button className="ws-button ws-button-secondary" type="button" disabled={busy} onClick={() => fileRef.current?.click()}><ImagePlus size={16} />{settings.qrImage ? 'Cambiar imagen' : `Subir QR de ${label}`}</button>
      {settings.qrImage && <button className="ws-text-button" type="button" disabled={busy} onClick={() => { setSettings(current => ({ ...current, qrImage: '', enabled: false })); setMessage(''); setSuccess(false) }}><Trash2 size={15} />Quitar</button>}
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label={`Imagen del QR de ${label}`} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void chooseImage(file) }} />
    </div>}
    <small className="yape-help">PNG, JPG o WebP · hasta 1 MB. La imagen se conserva tal como la subes.</small>
    <label>Titular de {label}<input value={settings.titular} required={settings.enabled} minLength={2} disabled={!editable || busy} placeholder="Nombre que aparece al escanear tu QR" onChange={event => { setSettings(current => ({ ...current, titular: event.target.value })); setSuccess(false) }} /></label>
    <label>Celular de {label} (opcional)<input value={settings.celular} inputMode="numeric" maxLength={9} pattern="9[0-9]{8}" disabled={!editable || busy} placeholder="987654321" onChange={event => { setSettings(current => ({ ...current, celular: event.target.value.replace(/\D/g, '') })); setSuccess(false) }} /></label>
    <label className="yape-enabled"><input type="checkbox" checked={settings.enabled} disabled={!editable || busy} onChange={event => { setSettings(current => ({ ...current, enabled: event.target.checked })); setSuccess(false) }} /><span>Mostrar este QR al seleccionar {label} en ventas</span></label>
    <div className="yape-settings-note">El ERP muestra el total a pagar junto al QR. El cliente escribe ese monto en su app {label}.</div>
    {message && <div className={`ws-notice${success ? '' : ' ws-notice-warning'}`} role={success ? 'status' : 'alert'}>{message}</div>}
    {editable && <button className="ws-button" type="submit" disabled={busy}><Save size={16} />{busy ? 'Guardando…' : 'Guardar configuración'}</button>}
  </form>
}
