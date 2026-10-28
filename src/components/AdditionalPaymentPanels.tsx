import { QrCode, RefreshCw, Smartphone, Landmark } from 'lucide-react'
import { money } from '../data/helpers'
import type { PlinSettings, BankTransferSettings } from '../data/payments'

export function WalletPaymentPanel({ brand, settings, total, loading, totalLoading, error, onRetry }: { brand: string; settings: PlinSettings | null; total: number; loading: boolean; totalLoading: boolean; error: string; onRetry: () => void }) {
  const ready = !loading && settings?.enabled && settings.qrImage
  const brandClass = brand.toLocaleLowerCase('es') === 'plin' ? ' plin-payment-panel' : ''
  return <section className={`yape-payment-panel${brandClass}`} aria-label={`Cobrar con ${brand}`}>
    <div className="yape-payment-heading"><span className="yape-payment-brand"><Smartphone size={16} />{brand}</span><span className="yape-payment-tag">Escanea y paga</span></div>
    <div className="yape-payment-body"><div className={`yape-payment-qr${ready ? '' : ' is-empty'}`}>{loading ? <RefreshCw size={26} className="ws-spin" /> : ready ? <img src={settings!.qrImage} alt={`QR de ${brand} de ${settings!.titular}`} /> : <QrCode size={38} />}</div>
      <div className="yape-payment-detail"><span className="yape-payment-label">Monto a pagar</span><strong className="yape-payment-total" aria-live="polite">{totalLoading ? 'Calculando…' : money(total)}</strong>{ready && <><span className="yape-payment-label">Titular</span><strong className="yape-payment-owner">{settings!.titular}</strong>{settings!.celular && <span className="yape-payment-phone">{settings!.celular}</span>}</>}{!totalLoading && total <= 0 && <small>Agrega productos o ingresa el monto de la venta.</small>}{!loading && !ready && !error && <small>Configura el QR y titular en Mantenimiento → QR de {brand}.</small>}</div></div>
    {error && <div className="yape-payment-error" role="alert"><span>{error}</span><button className="ws-text-button" type="button" onClick={onRetry}>Reintentar</button></div>}<div className="yape-payment-note"><strong>Ingresa este monto en {brand}.</strong> Verifica el abono en tu aplicación antes de completar la venta.</div>
  </section>
}

export function BankTransferPaymentPanel({ settings, total, loading, error, onRetry }: { settings: BankTransferSettings | null; total: number; loading: boolean; error: string; onRetry: () => void }) {
  const ready = !loading && settings?.enabled
  const bank = settings?.banco.trim().toLocaleLowerCase('es') ?? ''
  const bankClass = bank.includes('scotia') ? 'bank-transfer-panel--scotiabank' : bank.includes('interbank') ? 'bank-transfer-panel--interbank' : bank.includes('bcp') || bank.includes('credito') ? 'bank-transfer-panel--bcp' : 'bank-transfer-panel--other'
  return <section className={`yape-payment-panel bank-transfer-panel ${bankClass}`} aria-label={`Datos para transferencia bancaria${settings?.banco ? ` · ${settings.banco}` : ''}`}>
    <div className="yape-payment-heading"><span className="yape-payment-brand"><Landmark size={16} />Transferencia bancaria</span><span className="yape-payment-tag">{settings?.banco || 'Datos de abono'}</span></div>
    {loading ? <div className="ws-empty-compact"><RefreshCw size={22} className="ws-spin" /><span>Cargando cuenta bancaria…</span></div> : ready ? <div className="bank-transfer-details">
      <div><span>Titular</span><strong>{settings!.titular}</strong></div><div><span>Banco</span><strong>{settings!.banco}</strong></div><div><span>Tipo de cuenta</span><strong>{settings!.tipoCuenta}</strong></div><div><span>Cuenta</span><strong>{settings!.numeroCuenta}</strong></div>{settings!.cci && <div><span>CCI</span><strong>{settings!.cci}</strong></div>}<div><span>Moneda</span><strong>{settings!.moneda}</strong></div><div><span>Monto a transferir</span><strong className="yape-payment-total">{money(total)}</strong></div>
    </div> : !error && <div className="ws-notice ws-notice-warning">Configura la cuenta bancaria en Mantenimiento → Transferencia bancaria.</div>}
    {error && <div className="yape-payment-error" role="alert"><span>{error}</span><button className="ws-text-button" type="button" onClick={onRetry}>Reintentar</button></div>}<div className="yape-payment-note">Confirma el abono en la cuenta antes de registrar la venta como completada.</div>
  </section>
}
