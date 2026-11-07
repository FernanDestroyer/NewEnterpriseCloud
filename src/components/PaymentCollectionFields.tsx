import { useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { moneyCurrency } from '../data/helpers'
import {
  isBankTransferMethod,
  isPlinMethod,
  isYapeMethod,
  type BankTransferSettings,
  type PlinSettings,
  type YapeSettings,
} from '../data/payments'
import { getOpenCashShifts, type CashShift } from '../services/caja'
import { fetchBankTransferSettings, fetchPlinSettings } from '../services/paymentSettings'
import { fetchPaymentMethods, friendlyError } from '../services/records'
import { fetchYapeSettings } from '../services/yape'
import YapePaymentPanel from './YapePaymentPanel'
import { BankTransferPaymentPanel, WalletPaymentPanel } from './AdditionalPaymentPanels'

type Props = {
  /** Importe del comprobante o saldo pendiente, en su moneda original. */
  amount: number
  currency?: 'PEN' | 'USD'
  exchangeRate?: number
  value: string
  onChange: (value: string) => void
  cashShiftId: string
  onCashShiftChange: (value: string) => void
  pendingLabel?: string
  /** Nota que se muestra cuando aún no hay método elegido. */
  pendingNote?: string
  disabled?: boolean
}

const isCash = (method: string) => method.trim().toLocaleLowerCase('es') === 'efectivo'
const isCard = (method: string) => method.trim().toLocaleLowerCase('es') === 'tarjeta'

/**
 * Selector de cobro compartido por la venta directa, la facturación y el cobro
 * posterior. Cada método carga su propia configuración y panel de pago.
 */
export default function PaymentCollectionFields({
  amount, currency = 'PEN', exchangeRate = 1, value, onChange,
  cashShiftId, onCashShiftChange, pendingLabel = 'Sin cobro ahora (CxC pendiente)', pendingNote = 'Se creará una cuenta por cobrar pendiente. Podrás registrar el cobro más tarde desde la lista de pedidos.', disabled = false,
}: Props) {
  const selectId = useId()
  const [methods, setMethods] = useState<string[]>([])
  const [shifts, setShifts] = useState<CashShift[]>([])
  const [shiftsLoading, setShiftsLoading] = useState(false)
  const [shiftsError, setShiftsError] = useState('')
  const [yapeSettings, setYapeSettings] = useState<YapeSettings | null>(null)
  const [yapeLoading, setYapeLoading] = useState(false)
  const [yapeError, setYapeError] = useState('')
  const [yapeReload, setYapeReload] = useState(0)
  const [plinSettings, setPlinSettings] = useState<PlinSettings | null>(null)
  const [plinLoading, setPlinLoading] = useState(false)
  const [plinError, setPlinError] = useState('')
  const [plinReload, setPlinReload] = useState(0)
  const [bankSettings, setBankSettings] = useState<BankTransferSettings | null>(null)
  const [bankLoading, setBankLoading] = useState(false)
  const [bankError, setBankError] = useState('')
  const [bankReload, setBankReload] = useState(0)
  const shiftRef = useRef(cashShiftId)
  shiftRef.current = cashShiftId
  const cash = isCash(value)

  useEffect(() => {
    let active = true
    fetchPaymentMethods()
      .then(items => { if (active) setMethods(items.map(item => item.nombre)) })
      .catch(() => { if (active) setMethods([]) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!cash) {
      setShifts([])
      setShiftsLoading(false)
      setShiftsError('')
      return
    }
    let active = true
    setShiftsLoading(true)
    setShiftsError('')
    getOpenCashShifts()
      .then(items => {
        if (!active) return
        setShifts(items)
        const current = shiftRef.current
        if (!current || !items.some(shift => shift.id === current)) {
          onCashShiftChange(items.length === 1 ? items[0].id : '')
        }
      })
      .catch(error => { if (active) setShiftsError(friendlyError(error)) })
      .finally(() => { if (active) setShiftsLoading(false) })
    return () => { active = false }
  }, [cash, onCashShiftChange])

  useEffect(() => {
    if (!isYapeMethod(value)) { setYapeSettings(null); setYapeError(''); setYapeLoading(false); return }
    let active = true
    setYapeSettings(null); setYapeLoading(true); setYapeError('')
    fetchYapeSettings()
      .then(settings => { if (active) setYapeSettings(settings) })
      .catch(error => { if (active) setYapeError(friendlyError(error)) })
      .finally(() => { if (active) setYapeLoading(false) })
    return () => { active = false }
  }, [value, yapeReload])

  useEffect(() => {
    if (!isPlinMethod(value)) { setPlinSettings(null); setPlinError(''); setPlinLoading(false); return }
    let active = true
    setPlinSettings(null); setPlinLoading(true); setPlinError('')
    fetchPlinSettings()
      .then(settings => { if (active) setPlinSettings(settings) })
      .catch(error => { if (active) setPlinError(friendlyError(error)) })
      .finally(() => { if (active) setPlinLoading(false) })
    return () => { active = false }
  }, [value, plinReload])

  useEffect(() => {
    if (!isBankTransferMethod(value)) { setBankSettings(null); setBankError(''); setBankLoading(false); return }
    let active = true
    setBankSettings(null); setBankLoading(true); setBankError('')
    fetchBankTransferSettings()
      .then(settings => { if (active) setBankSettings(settings) })
      .catch(error => { if (active) setBankError(friendlyError(error)) })
      .finally(() => { if (active) setBankLoading(false) })
    return () => { active = false }
  }, [value, bankReload])

  const options = methods.includes(value) || !value ? methods : [value, ...methods]
  // Los QR peruanos operan en soles; para ventas USD se muestra el equivalente.
  const panelTotal = currency === 'USD' && exchangeRate > 0
    ? Math.round(amount * exchangeRate * 100) / 100
    : amount

  return <section className="ws-payment-fields" aria-label="Método de pago">
    <div className="ws-payment-fields-head">
      <div><span className="ws-sales-kicker">COBRO</span><h3>Método de pago</h3></div>
      <strong className="ws-payment-fields-total">{moneyCurrency(amount, currency)}</strong>
    </div>
    <label htmlFor={selectId}>¿Cómo paga el cliente?
      <select id={selectId} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
        <option value="">{pendingLabel}</option>
        {options.map(method => <option key={method} value={method}>{method}</option>)}
      </select>
    </label>
    {cash && <label>Turno de caja que recibe el efectivo
      <select value={cashShiftId} required disabled={disabled || shiftsLoading} onChange={event => onCashShiftChange(event.target.value)}>
        <option value="">{shiftsLoading ? 'Consultando turnos…' : 'Selecciona un turno abierto'}</option>
        {shifts.map(shift => <option key={shift.id} value={shift.id}>
          {new Date(shift.abiertoEn).toLocaleString('es-PE', { timeZone: 'America/Lima' })}{shift.cajaId ? ` · Caja ${shift.cajaId.slice(0, 8)}` : ' · Turno sin caja'}
        </option>)}
      </select>
      <small className={shifts.length ? 'relation-hint' : 'relation-hint ws-payment-cash-warning'}>
        {shiftsError || (shifts.length
          ? 'El cobro quedará asociado al turno elegido.'
          : 'No hay una caja abierta. Abre un turno en Caja antes de confirmar el cobro en efectivo.')}
      </small>
    </label>}
    {isYapeMethod(value) && <YapePaymentPanel settings={yapeSettings} total={panelTotal} loading={yapeLoading} totalLoading={false} error={yapeError} onRetry={() => setYapeReload(current => current + 1)} />}
    {isPlinMethod(value) && <WalletPaymentPanel brand="Plin" settings={plinSettings} total={panelTotal} loading={plinLoading} totalLoading={false} error={plinError} onRetry={() => setPlinReload(current => current + 1)} />}
    {isBankTransferMethod(value) && <BankTransferPaymentPanel settings={bankSettings} total={panelTotal} loading={bankLoading} error={bankError} onRetry={() => setBankReload(current => current + 1)} />}
    {isCard(value) && <p className="relation-hint ws-payment-note"><AlertTriangle size={13} /> Tarjeta se registra como venta a crédito: la cuenta por cobrar queda pendiente hasta su cobro en Tesorería.</p>}
    {!value && pendingNote && <p className="relation-hint ws-payment-note">{pendingNote}</p>}
    {currency === 'USD' && value && exchangeRate > 0 && <p className="relation-hint ws-payment-note">El comprobante y la CxC están en USD. El QR muestra el equivalente en soles con TC {exchangeRate.toFixed(4)}.</p>}
  </section>
}
