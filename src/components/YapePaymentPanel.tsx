import { useEffect, useState } from 'react'
import { QrCode, RefreshCw, Smartphone } from 'lucide-react'
import { money } from '../data/helpers'
import type { YapeSettings } from '../data/payments'

export default function YapePaymentPanel({ settings, total, loading, totalLoading, error, onRetry }: { settings: YapeSettings | null; total: number; loading: boolean; totalLoading: boolean; error: string; onRetry: () => void }) {
  const [imageError, setImageError] = useState(false)
  useEffect(() => setImageError(false), [settings?.qrImage])
  const ready = !loading && settings?.enabled && settings.qrImage && !imageError

  return <section className="yape-payment-panel" aria-label="Cobrar con Yape">
    <div className="yape-payment-heading"><span className="yape-payment-brand"><Smartphone size={16} />Yape</span><span className="yape-payment-tag">Escanea y paga</span></div>
    <div className="yape-payment-body">
      <div className={`yape-payment-qr${ready ? '' : ' is-empty'}`}>
        {loading ? <RefreshCw size={26} className="ws-spin" /> : ready ? <img src={settings!.qrImage} alt={`QR de Yape de ${settings!.titular}`} onError={() => setImageError(true)} /> : <QrCode size={38} />}
      </div>
      <div className="yape-payment-detail">
        <span className="yape-payment-label">Monto a yapear</span>
        <strong className="yape-payment-total" aria-live="polite">{totalLoading ? 'Calculando…' : money(total)}</strong>
        {ready && <><span className="yape-payment-label">Titular</span><strong className="yape-payment-owner">{settings!.titular}</strong>{settings!.celular && <span className="yape-payment-phone">{settings!.celular}</span>}</>}
        {!totalLoading && total <= 0 && <small>Agrega productos o ingresa el monto de la venta.</small>}
        {!loading && !ready && !error && <small>{imageError ? 'No se pudo mostrar la imagen. Vuelve a cargar el QR en Mantenimiento.' : 'Configura tu QR en Mantenimiento → QR de Yape.'}</small>}
      </div>
    </div>
    {error && <div className="yape-payment-error" role="alert"><span>{error}</span><button className="ws-text-button" type="button" onClick={onRetry}>Reintentar</button></div>}
    <div className="yape-payment-note"><strong>Ingresa este monto en Yape.</strong> Tras revisar el abono en tu app, puedes registrar la venta como Completada.</div>
  </section>
}
