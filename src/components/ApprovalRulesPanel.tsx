import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, RefreshCw, Save, SlidersHorizontal } from 'lucide-react'
import { describeRuleEffect, isRuleDirty, parseRuleValue, ruleDraftFrom, type ApprovalRule, type RuleDraft } from '../data/approvalRules'
import { money } from '../data/helpers'
import { fetchApprovalRules, updateApprovalRule } from '../services/approvals'

function updatedLabel(rule: ApprovalRule) {
  const date = new Date(rule.actualizado_en)
  const when = Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  return rule.actualizado_por ? `Última modificación ${when}` : 'Valor inicial del sistema'
}

/** Umbrales editables de aprobación. Solo Gerente/Administrador guardan; el resto los consulta. */
export default function ApprovalRulesPanel({ canEdit }: { canEdit: boolean }) {
  const [rules, setRules] = useState<ApprovalRule[]>([])
  const [drafts, setDrafts] = useState<Record<string, RuleDraft>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const result = await fetchApprovalRules()
      setRules(result)
      setDrafts(Object.fromEntries(result.map(rule => [rule.clave, ruleDraftFrom(rule)])))
      setErrors({})
    } catch (cause) {
      setRules([]); setLoadError((cause as { message?: string } | null)?.message ?? 'No se pudieron consultar las reglas.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async (rule: ApprovalRule) => {
    const draft = drafts[rule.clave]
    if (!draft || !canEdit || savingKey) return
    const parsed = parseRuleValue(draft.valor, rule.unidad, draft.activa)
    if (!parsed.ok) { setErrors(current => ({ ...current, [rule.clave]: parsed.error })); return }
    setSavingKey(rule.clave); setNotice(''); setErrors(current => ({ ...current, [rule.clave]: '' }))
    try {
      await updateApprovalRule(rule.clave, parsed.value, draft.activa)
      setNotice(`Regla guardada: ${rule.titulo}. Rige para las solicitudes que se envíen desde ahora; las ya pendientes siguen su curso.`)
      await load()
    } catch (cause) {
      setErrors(current => ({ ...current, [rule.clave]: (cause as { message?: string } | null)?.message ?? 'No se pudo guardar la regla.' }))
    } finally { setSavingKey('') }
  }

  return <section className="ec-approval-thresholds" aria-label="Umbrales de aprobación">
    <div className="ws-card-heading">
      <div>
        <h2><SlidersHorizontal size={16} /> Umbrales de aprobación</h2>
        <p>Define a partir de qué importe o variación se exige la decisión de otra persona. Con una regla inactiva, todo sigue exigiendo aprobación.</p>
      </div>
      <button type="button" className="ws-button ws-button-secondary" disabled={loading || Boolean(savingKey)} onClick={() => void load()}><RefreshCw size={15} />Actualizar</button>
    </div>
    {loadError && <div className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={16} />{loadError}</div>}
    {notice && <div className="ws-notice ws-notice-info" role="status"><Check size={16} />{notice}</div>}
    {!canEdit && !loadError && <div className="ws-notice" role="note">Solo Gerente o Administrador pueden modificar estos umbrales.</div>}
    {loading && !rules.length && !loadError && <div className="ws-empty-compact" role="status">Consultando reglas…</div>}
    <div className="ec-approval-rules-grid">
      {rules.map(rule => {
        const draft = drafts[rule.clave] ?? ruleDraftFrom(rule)
        const dirty = isRuleDirty(rule, draft)
        const error = errors[rule.clave]
        const inputId = `rule-${rule.clave}`
        return <article key={rule.clave} className="ec-approval-rule-card ec-approval-threshold-card">
          <strong>{rule.titulo}</strong>
          <p>{rule.descripcion}</p>
          <small className={rule.activa ? 'ec-rule-effect is-active' : 'ec-rule-effect'}>{describeRuleEffect(rule, money)}</small>
          <div className="ec-rule-fields">
            <label htmlFor={inputId}>Umbral ({rule.unidad === 'PEN' ? 'S/' : 'unidades'})
              <input id={inputId} className="ws-control" inputMode="decimal" autoComplete="off" disabled={!canEdit || Boolean(savingKey)} value={draft.valor}
                aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined}
                onChange={event => { const valor = event.target.value; setDrafts(current => ({ ...current, [rule.clave]: { ...draft, valor } })); setErrors(current => ({ ...current, [rule.clave]: '' })) }} />
            </label>
            <label className="ec-rule-toggle">
              <input type="checkbox" disabled={!canEdit || Boolean(savingKey)} checked={draft.activa}
                onChange={event => { const activa = event.target.checked; setDrafts(current => ({ ...current, [rule.clave]: { ...draft, activa } })); setErrors(current => ({ ...current, [rule.clave]: '' })) }} />
              Regla activa
            </label>
          </div>
          {error && <div id={`${inputId}-error`} className="ws-notice ws-notice-warning" role="alert"><AlertTriangle size={14} />{error}</div>}
          <div className="ec-rule-footer">
            <small>{updatedLabel(rule)}</small>
            {canEdit && <button type="button" className="ws-button" disabled={!dirty || Boolean(savingKey)} onClick={() => void save(rule)}>
              {savingKey === rule.clave ? <RefreshCw size={14} className="ws-spin" /> : <Save size={14} />}Guardar
            </button>}
          </div>
        </article>
      })}
    </div>
  </section>
}
