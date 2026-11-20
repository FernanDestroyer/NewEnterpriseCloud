// Reglas de aprobación editables: lógica pura (sin Supabase ni React) para poder
// probarla con `node --test`. El servidor vuelve a validar todo.

export type ApprovalRuleKey = 'orden_compra_monto_minimo_pen' | 'conteo_fisico_variacion_maxima_unidades'
export type ApprovalRuleUnit = 'PEN' | 'unidades'

export type ApprovalRule = {
  clave: ApprovalRuleKey
  titulo: string
  descripcion: string
  unidad: ApprovalRuleUnit
  valor: number
  activa: boolean
  actualizado_por: string | null
  actualizado_en: string
}

export const MAX_RULE_VALUE = 1_000_000_000

export type RuleDraft = { valor: string; activa: boolean }
export type RuleValidation = { ok: true; value: number } | { ok: false; error: string }

/** Convierte lo que escribe la persona ("1,500.50", "1500", " 20 ") en un número válido para la regla. */
export function parseRuleValue(raw: string, unit: ApprovalRuleUnit, active: boolean): RuleValidation {
  const text = raw.trim().replace(/\s/g, '').replace(/,/g, '')
  if (text === '') return { ok: false, error: 'Indica un valor.' }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, error: 'Usa solo números positivos, con hasta 2 decimales.' }
  const value = Number(text)
  if (!Number.isFinite(value) || value > MAX_RULE_VALUE) return { ok: false, error: 'El valor máximo permitido es 1 000 000 000.' }
  if (unit === 'unidades' && !Number.isInteger(value)) return { ok: false, error: 'Este umbral se expresa en unidades enteras.' }
  if (active && value <= 0) return { ok: false, error: 'Para activar la regla indica un umbral mayor que 0.' }
  return { ok: true, value }
}

export function ruleDraftFrom(rule: ApprovalRule): RuleDraft {
  return { valor: String(rule.valor), activa: rule.activa }
}

/** ¿El borrador cambia algo respecto de lo guardado? Compara por valor numérico, no por texto. */
export function isRuleDirty(rule: ApprovalRule, draft: RuleDraft): boolean {
  if (draft.activa !== rule.activa) return true
  const parsed = parseRuleValue(draft.valor, rule.unidad, false)
  return !parsed.ok || parsed.value !== rule.valor
}

/** Frase corta con el efecto vigente de la regla, para la tarjeta. */
export function describeRuleEffect(rule: ApprovalRule, formatMoney: (amount: number) => string = value => `S/ ${value.toFixed(2)}`): string {
  if (!rule.activa || rule.valor <= 0) {
    return rule.clave === 'orden_compra_monto_minimo_pen'
      ? 'Inactiva: toda orden de compra exige aprobación de otra persona.'
      : 'Inactiva: todo conteo con diferencias exige aprobación de otra persona.'
  }
  return rule.clave === 'orden_compra_monto_minimo_pen'
    ? `Activa: las órdenes menores a ${formatMoney(rule.valor)} se emiten sin aprobación; desde ese monto exigen aprobación.`
    : `Activa: los conteos con variación de hasta ${rule.valor} unidades se aplican sin aprobación; con más, exigen aprobación.`
}

export type ApprovalOutcome = { estado: 'pending' | 'approved' | 'rejected' | 'stale'; auto: boolean }

/** Mensaje al terminar de enviar una solicitud, según la regla haya emitido el documento o no. */
export function submittedMessage(kind: 'order' | 'count', id: string, outcome: ApprovalOutcome | null): string {
  const short = id.slice(0, 8)
  if (outcome?.estado === 'approved' && outcome.auto) {
    return kind === 'order'
      ? `Orden emitida sin aprobación manual: su monto está bajo el umbral vigente (${short}). Queda registrada en el historial de aprobaciones.`
      : `Conteo aplicado sin aprobación manual: su variación está dentro del umbral vigente (${short}). Queda registrado en el historial de aprobaciones.`
  }
  return kind === 'order'
    ? `Solicitud de orden enviada a la bandeja de aprobaciones (${short}). La orden se creará cuando la apruebe otra persona.`
    : `Conteo enviado a aprobación (${short}). Los ajustes se aplicarán cuando lo apruebe otra persona.`
}
