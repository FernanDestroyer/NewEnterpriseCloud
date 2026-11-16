const businessCalendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Devuelve la fecha de negocio peruana sin depender de la zona horaria del dispositivo. */
export function businessDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = businessCalendar.formatToParts(date)
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T05:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** Límites UTC semiabiertos para consultar fechas civiles de Perú en timestamptz. */
export function peruDateBounds(range: { from: string; to: string }): { fromInclusive: string | null; toExclusive: string | null } {
  if (range.from && range.to && range.from > range.to) throw new Error('La fecha inicial supera la fecha final.')
  if ((range.from && !validIsoDate(range.from)) || (range.to && !validIsoDate(range.to))) throw new Error('El intervalo de fechas no es válido.')
  const fromInclusive = range.from ? `${range.from}T05:00:00.000Z` : null
  let toExclusive: string | null = null
  if (range.to) {
    const next = new Date(`${range.to}T05:00:00.000Z`)
    if (!Number.isFinite(next.getTime())) throw new Error('El intervalo de fechas no es válido.')
    next.setUTCDate(next.getUTCDate() + 1)
    toExclusive = next.toISOString()
  }
  return { fromInclusive, toExclusive }
}
