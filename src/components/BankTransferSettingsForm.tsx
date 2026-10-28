import { useEffect, useState, type FormEvent } from 'react'
import { RefreshCw, Save } from 'lucide-react'
import { EMPTY_BANK_TRANSFER_SETTINGS, type BankTransferSettings } from '../data/payments'
import { fetchBankTransferSettings, saveBankTransferSettings } from '../services/paymentSettings'
import { friendlyError } from '../services/records'

const BANK_OPTIONS = ['BCP', 'Scotiabank', 'Interbank'] as const

function selectedBankOption(bank: string): string {
  return BANK_OPTIONS.find(option => option.toLocaleLowerCase('es') === bank.trim().toLocaleLowerCase('es')) ?? (bank ? 'Otro' : '')
}

export default function BankTransferSettingsForm({ canCreate, canEdit, onSaved }: { canCreate: boolean; canEdit: boolean; onSaved: () => Promise<void> }) {
  const [settings, setSettings] = useState<BankTransferSettings>({ ...EMPTY_BANK_TRANSFER_SETTINGS }); const [exists, setExists] = useState(false); const [loading, setLoading] = useState(true); const [failed, setFailed] = useState(false); const [reload, setReload] = useState(0); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [success, setSuccess] = useState(false)
  const editable = exists ? canEdit : canCreate
  useEffect(() => { let active = true; setLoading(true); setFailed(false); setMessage(''); fetchBankTransferSettings().then(saved => { if (active) { setExists(Boolean(saved)); setSettings(saved ?? { ...EMPTY_BANK_TRANSFER_SETTINGS }) } }).catch(error => { if (active) { setMessage(friendlyError(error)); setFailed(true) } }).finally(() => active && setLoading(false)); return () => { active = false } }, [reload])
  const save = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!editable || loading || busy) return; setBusy(true); setMessage(''); setSuccess(false); try { await saveBankTransferSettings(settings); setExists(true); await onSaved(); setSuccess(true); setMessage('Datos de la cuenta bancaria guardados.') } catch (error) { setMessage(friendlyError(error)) } finally { setBusy(false) } }
  if (loading) return <div className="ws-empty-compact"><RefreshCw size={24} className="ws-spin" /><strong>Cargando cuenta bancaria…</strong></div>
  if (failed) return <div className="ws-notice ws-notice-warning" role="alert"><span>{message}</span><button className="ws-text-button" type="button" onClick={() => setReload(value => value + 1)}>Reintentar</button></div>
  const field = (key: keyof BankTransferSettings, label: string, placeholder: string, required = false) => <label>{label}<input value={String(settings[key])} required={required && settings.enabled} disabled={!editable || busy} placeholder={placeholder} onChange={event => setSettings(value => ({ ...value, [key]: event.target.value }))} /></label>
  const bankOption = selectedBankOption(settings.banco)
  return <form className="ws-form bank-transfer-settings-form" onSubmit={save}>
    <div className="ws-form-grid">{field('titular', 'Titular de la cuenta', 'Nombre de la persona o empresa', true)}
      <label>Banco<select value={bankOption} required={settings.enabled} disabled={!editable || busy} onChange={event => setSettings(value => ({ ...value, banco: event.target.value }))}><option value="">Selecciona un banco</option>{BANK_OPTIONS.map(bank => <option key={bank}>{bank}</option>)}<option value="Otro">Otro</option></select></label>
      {bankOption === 'Otro' && <label>Nombre del banco<input value={settings.banco === 'Otro' ? '' : settings.banco} required={settings.enabled} disabled={!editable || busy} placeholder="Escribe el nombre del banco" onChange={event => setSettings(value => ({ ...value, banco: event.target.value }))} /></label>}
      <label>Tipo de cuenta<select value={settings.tipoCuenta} disabled={!editable || busy} onChange={event => setSettings(value => ({ ...value, tipoCuenta: event.target.value }))}><option>Ahorros</option><option>Corriente</option></select></label>
      <label>Número de cuenta<input value={settings.numeroCuenta} inputMode="numeric" autoComplete="off" required={settings.enabled} disabled={!editable || busy} placeholder="Número de cuenta bancaria" aria-describedby="bank-transfer-account-help" onChange={event => setSettings(value => ({ ...value, numeroCuenta: event.target.value.replace(/[^\d\s-]/g, '') }))} /><small id="bank-transfer-account-help" className="yape-help">Puedes escribirla o pegarla con espacios o guiones; se guardará solo con números.</small></label>
      <label>CCI (opcional)<input value={settings.cci} inputMode="numeric" autoComplete="off" disabled={!editable || busy} placeholder="002-193-004567890101-11" aria-describedby="bank-transfer-cci-help" onChange={event => setSettings(value => ({ ...value, cci: event.target.value.replace(/[^\d\s-]/g, '') }))} /><small id="bank-transfer-cci-help" className="yape-help">{settings.cci ? `${settings.cci.replace(/\D/g, '').length} de 20 dígitos. ` : ''}Puedes escribirlo o pegarlo con guiones; se guardará solo con números.</small></label>
      <label>Moneda<select value={settings.moneda} disabled={!editable || busy} onChange={event => setSettings(value => ({ ...value, moneda: event.target.value }))}><option value="PEN">Soles (PEN)</option><option value="USD">Dólares (USD)</option></select></label></div>
    <label className="yape-enabled"><input type="checkbox" checked={settings.enabled} disabled={!editable || busy} onChange={event => setSettings(value => ({ ...value, enabled: event.target.checked }))} /><span>Mostrar estos datos al seleccionar transferencia bancaria en ventas</span></label>
    <div className="yape-settings-note">Los datos se mostrarán al vendedor para que los comparta con el cliente. Verifica el abono antes de completar la venta.</div>
    {message && <div className={`ws-notice${success ? '' : ' ws-notice-warning'}`} role={success ? 'status' : 'alert'}>{message}</div>}{editable && <button className="ws-button" type="submit" disabled={busy}><Save size={16} />{busy ? 'Guardando…' : 'Guardar configuración'}</button>}
  </form>
}
