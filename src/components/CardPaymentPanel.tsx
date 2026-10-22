import { useCallback, useEffect, useState } from 'react'
import { CreditCard, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { money } from '../data/helpers'
import { CARD_BRANDS, cardLabel, isCardExpired, type CustomerCard } from '../data/payments'
import { addCustomerCard, fetchCustomerCards, removeCustomerCard } from '../services/tarjetas'
import { friendlyError } from '../services/records'

/** Clase de color por marca (solo colores y texto, sin logotipos oficiales). */
function brandClass(marca: string): string {
  return marca === 'Visa' ? 'visa' : marca === 'Mastercard' ? 'mastercard' : marca === 'American Express' ? 'amex' : marca === 'Diners Club' ? 'diners' : 'other'
}

type Props = {
  clienteId: string | null
  clienteName?: string
  total: number
  selectedId: string
  onSelect: (card: CustomerCard | null) => void
}

/** Pago con tarjeta: el cliente debe tener una tarjeta agregada a su cuenta y elegirla para la venta. */
export default function CardPaymentPanel({ clienteId, clienteName, total, selectedId, onSelect }: Props) {
  const [cards, setCards] = useState<CustomerCard[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ marca: 'Visa', ultimos4: '', titular: '', venceMes: '', venceAnio: '' })

  const load = useCallback(async () => {
    if (!clienteId) { setCards([]); return }
    setLoading(true); setError('')
    try {
      const rows = await fetchCustomerCards(clienteId)
      setCards(rows)
      const current = rows.find(card => card.id === selectedId)
      if (!current) onSelect(rows.find(card => !isCardExpired(card.venceMes, card.venceAnio)) ?? null)
      setAdding(rows.length === 0)
    } catch (cause) { setError(friendlyError(cause)) }
    finally { setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId])
  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!clienteId) return
    setSaving(true); setError('')
    try {
      const card = await addCustomerCard(clienteId, { marca: form.marca, ultimos4: form.ultimos4, titular: form.titular, venceMes: Number(form.venceMes), venceAnio: Number(form.venceAnio) })
      setCards(current => [card, ...current])
      onSelect(card)
      setAdding(false)
      setForm({ marca: 'Visa', ultimos4: '', titular: '', venceMes: '', venceAnio: '' })
    } catch (cause) { setError(friendlyError(cause)) }
    finally { setSaving(false) }
  }

  const remove = async (card: CustomerCard) => {
    setError('')
    setConfirmId(null)
    try {
      await removeCustomerCard(card.id)
      const rest = cards.filter(item => item.id !== card.id)
      setCards(rest)
      if (selectedId === card.id) onSelect(rest.find(item => !isCardExpired(item.venceMes, item.venceAnio)) ?? null)
      if (!rest.length) setAdding(true)
    } catch (cause) { setError(friendlyError(cause)) }
  }

  return <section className="yape-payment-panel card-payment-panel" aria-label="Pagar con tarjeta">
    <div className="yape-payment-heading"><span className="yape-payment-brand"><CreditCard size={16} />Pago con tarjeta</span><span className="yape-payment-tag">{money(total)}</span></div>
    {!clienteId ? <small className="yape-payment-error" role="alert">Vincula un cliente a la venta: la tarjeta se agrega a su cuenta.</small> : <>
      <small>Cuenta de {clienteName || 'el cliente'}. Solo se guarda marca, últimos 4 dígitos, titular y vencimiento; nunca el número completo ni el CVV.</small>
      {loading && <RefreshCw size={18} className="ws-spin" />}
      {cards.length > 0 && <div className={`bank-cards${cards.length >= 3 ? ' is-compact' : ''}`} role="radiogroup" aria-label="Tarjetas del cliente">
        {cards.map(card => {
          const expired = isCardExpired(card.venceMes, card.venceAnio)
          const selected = selectedId === card.id
          return <div key={card.id} className={`bank-card brand-${brandClass(card.marca)}${selected ? ' is-selected' : ''}${expired ? ' is-expired' : ''}`}>
            <input id={`card-${card.id}`} className="bank-card-radio" type="radio" name="tarjeta_elegida" checked={selected} disabled={expired} onChange={() => onSelect(card)} />
            <label htmlFor={`card-${card.id}`} className="bank-card-face">
              <span className="bank-card-top"><span className="bank-card-chip" aria-hidden="true" /><span className="bank-card-brand">{card.marca}</span></span>
              <span className="bank-card-number"><span className="bank-card-dots">•••• •••• </span>•••• {card.ultimos4}</span>
              <span className="bank-card-bottom">
                <span><small>Titular</small><strong>{card.titular}</strong></span>
              </span>
              {expired && <span className="bank-card-expired">VENCIDA</span>}
            </label>
            {confirmId === card.id
              ? <span className="bank-card-confirm"><button type="button" className="is-danger" onClick={() => void remove(card)}>Quitar</button><button type="button" onClick={() => setConfirmId(null)}>Cancelar</button></span>
              : <button className="bank-card-remove" type="button" aria-label={`Quitar ${cardLabel(card)}`} title="Quitar tarjeta" onClick={() => setConfirmId(card.id)}><Trash2 size={15} /></button>}
          </div>
        })}
      </div>}
      {!adding && <button className="ws-button ws-button-secondary" type="button" onClick={() => setAdding(true)}><Plus size={16} />Agregar tarjeta</button>}
      {adding && <div className="split-duo">
        <label>Marca<select value={form.marca} onChange={event => setForm({ ...form, marca: event.target.value })}>{CARD_BRANDS.map(brand => <option key={brand}>{brand}</option>)}</select></label>
        <label>Últimos 4 dígitos<input inputMode="numeric" maxLength={4} value={form.ultimos4} onChange={event => setForm({ ...form, ultimos4: event.target.value.replace(/\D/g, '') })} placeholder="1234" /></label>
        <label>Titular<input value={form.titular} onChange={event => setForm({ ...form, titular: event.target.value })} placeholder="Como aparece en la tarjeta" /></label>
        <label>Mes (MM)<input inputMode="numeric" maxLength={2} value={form.venceMes} onChange={event => setForm({ ...form, venceMes: event.target.value.replace(/\D/g, '') })} placeholder="08" /></label>
        <label>Año (AA)<input inputMode="numeric" maxLength={4} value={form.venceAnio} onChange={event => setForm({ ...form, venceAnio: event.target.value.replace(/\D/g, '') })} placeholder="28" /></label>
        <span className="supplier-product-actions">
          <button className="ws-button" type="button" disabled={saving} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar tarjeta'}</button>
          {cards.length > 0 && <button className="ws-button ws-button-secondary" type="button" onClick={() => setAdding(false)}>Cancelar</button>}
        </span>
      </div>}
      {!selectedId && !adding && !loading && <small className="yape-payment-error" role="alert">Elige o agrega una tarjeta para poder guardar la venta.</small>}
    </>}
    {error && <div className="yape-payment-error" role="alert"><span>{error}</span></div>}
  </section>
}
