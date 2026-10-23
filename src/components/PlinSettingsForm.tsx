import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ImagePlus, QrCode, RefreshCw, Save, Trash2 } from 'lucide-react'
import { EMPTY_PLIN_SETTINGS, type PlinSettings } from '../data/payments'
import { fetchPlinSettings, readPlinQrFile, savePlinSettings } from '../services/paymentSettings'
import { friendlyError } from '../services/records'

export default function PlinSettingsForm({ canCreate, canEdit, onSaved }: { canCreate: boolean; canEdit: boolean; onSaved: () => Promise<void> }) {
  const [settings, setSettings] = useState<PlinSettings>({ ...EMPTY_PLIN_SETTINGS })
  const [exists, setExists] = useState(false); const [loading, setLoading] = useState(true); const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [success, setSuccess] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null); const mounted = useRef(true); const editable = exists ? canEdit : canCreate
  useEffect(() => { let active = true; mounted.current = true; setLoading(true); setFailed(false); setMessage(''); fetchPlinSettings().then(saved => { if (active) { setExists(Boolean(saved)); setSettings(saved ?? { ...EMPTY_PLIN_SETTINGS }) } }).catch(error => { if (active) { setMessage(friendlyError(error)); setFailed(true) } }).finally(() => active && setLoading(false)); return () => { active = false; mounted.current = false } }, [reload])
  const chooseImage = async (file?: File) => { if (!file || busy || !editable) return; setBusy(true); setMessage(''); try { const qrImage = await readPlinQrFile(file); if (mounted.current) setSettings(value => ({ ...value, qrImage, enabled: true })) } catch (error) { if (mounted.current) setMessage(friendlyError(error)) } finally { if (mounted.current) setBusy(false) } }
  const save = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (loading || busy || !editable) return; setBusy(true); setMessage(''); setSuccess(false); try { await savePlinSettings(settings); if (mounted.current) setExists(true); await onSaved(); if (mounted.current) { setSuccess(true); setMessage('QR de Plin guardado y disponible al registrar ventas.') } } catch (error) { if (mounted.current) setMessage(friendlyError(error)) } finally { if (mounted.current) setBusy(false) } }
  if (loading) return <div className="ws-empty-compact"><RefreshCw size={24} className="ws-spin" /><strong>Cargando configuración de Plin…</strong></div>
  if (failed) return <div className="ws-notice ws-notice-warning" role="alert"><span>{message}</span><button className="ws-text-button" type="button" onClick={() => setReload(value => value + 1)}>Reintentar</button></div>
  return <form className="ws-form yape-settings-form" onSubmit={save}>
    <div className="yape-settings-preview">{settings.qrImage ? <img src={settings.qrImage} alt="Vista previa del QR de Plin" /> : <div className="yape-qr-placeholder"><QrCode size={44} /><span>Carga tu QR de Plin</span></div>}</div>
    {editable && <div className="ws-heading-actions"><button className="ws-button ws-button-secondary" type="button" disabled={busy} onClick={() => fileRef.current?.click()}><ImagePlus size={16} />{settings.qrImage ? 'Cambiar imagen' : 'Subir QR de Plin'}</button>{settings.qrImage && <button className="ws-text-button" type="button" disabled={busy} onClick={() => setSettings(value => ({ ...value, qrImage: '', enabled: false }))}><Trash2 size={15} />Quitar</button>}<input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Imagen del QR de Plin" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void chooseImage(file) }} /></div>}
    <small className="yape-help">PNG, JPG o WebP · hasta 1 MB. La imagen se conserva tal como la subes.</small>
    <label>Titular de Plin<input value={settings.titular} required={settings.enabled} minLength={2} disabled={!editable || busy} placeholder="Nombre que aparece al pagar" onChange={event => setSettings(value => ({ ...value, titular: event.target.value }))} /></label>
    <label>Celular de Plin (opcional)<input value={settings.celular} inputMode="numeric" maxLength={9} pattern="9[0-9]{8}" disabled={!editable || busy} placeholder="987654321" onChange={event => setSettings(value => ({ ...value, celular: event.target.value.replace(/\D/g, '') }))} /></label>
    <label className="yape-enabled"><input type="checkbox" checked={settings.enabled} disabled={!editable || busy} onChange={event => setSettings(value => ({ ...value, enabled: event.target.checked }))} /><span>Mostrar este QR al seleccionar Plin en ventas</span></label>
    <div className="yape-settings-note">El ERP muestra el total a pagar junto al QR. Verifica el abono antes de registrar la venta como completada.</div>
    {message && <div className={`ws-notice${success ? '' : ' ws-notice-warning'}`} role={success ? 'status' : 'alert'}>{message}</div>}{editable && <button className="ws-button" type="submit" disabled={busy}><Save size={16} />{busy ? 'Guardando…' : 'Guardar configuración'}</button>}
  </form>
}
