import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import useDebouncedValue from '../hooks/useDebouncedValue'
import { COMMUNITY_CANDIDATE_PAGE_SIZE, COMMUNITY_MAX_MEMBERS, communityError, listCommunityCandidates, type CommunityCandidate } from '../services/community'

export default function CommunityMemberPicker({ members, onChange, disabled }: {
  members: CommunityCandidate[]
  onChange: (members: CommunityCandidate[]) => void
  disabled: boolean
}) {
  const [search, setSearch] = useState('')
  const query = useDebouncedValue(search.trim(), 240)
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<CommunityCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const ready = !loading && query === search.trim()

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    listCommunityCandidates(query, page).then(next => { if (active) setRows(next) })
      .catch(cause => {
        if (!active) return
        setRows([])
        setError(communityError(cause, 'No se pudieron cargar los usuarios.'))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [query, page, retry])

  const selected = new Set(members.map(member => member.id))
  const toggle = (candidate: CommunityCandidate) => {
    if (selected.has(candidate.id)) onChange(members.filter(member => member.id !== candidate.id))
    else if (members.length < COMMUNITY_MAX_MEMBERS) onChange([...members, candidate])
  }

  return <section className="community-picker" aria-label="Seleccionar miembros">
    <label><span><Search size={14} /> Buscar usuarios activos</span><input type="search" maxLength={100} placeholder="Nombre, correo o rol…" value={search} disabled={disabled} onChange={event => { setSearch(event.target.value); setPage(0) }} /></label>
    <div className="community-picker-selection">
      <strong aria-live="polite">{members.length} {members.length === 1 ? 'persona seleccionada' : 'personas seleccionadas'}</strong>
      <div>{members.map(member => <button className="community-member-chip" key={member.id} type="button" title={`${member.nombre} · ${member.rol}`} aria-label={`Quitar a ${member.nombre}`} disabled={disabled} onClick={() => toggle(member)}>{member.nombre}<X size={13} /></button>)}</div>
    </div>
    {ready && error && <div className="community-picker-message" role="alert">{error} <button className="ws-button ws-button-secondary" type="button" disabled={disabled} onClick={() => setRetry(value => value + 1)}>Reintentar</button></div>}
    {!ready && <p className="community-picker-message" role="status">Buscando usuarios…</p>}
    {ready && !error && <div className="community-picker-results" role="group" aria-label="Resultados de usuarios">
      {rows.map(candidate => <label className="community-member-option" key={candidate.id}>
        <input type="checkbox" checked={selected.has(candidate.id)} disabled={disabled || (members.length >= COMMUNITY_MAX_MEMBERS && !selected.has(candidate.id))} onChange={() => toggle(candidate)} />
        <span><strong>{candidate.nombre}</strong>{candidate.correo && <small>{candidate.correo}</small>}</span>
        <small className="community-member-role">{candidate.rol}</small>
      </label>)}
      {!rows.length && <p className="community-picker-message">No se encontraron usuarios en esta página.</p>}
    </div>}
    {ready && !error && (page > 0 || rows.length === COMMUNITY_CANDIDATE_PAGE_SIZE) && <div className="community-picker-pages">
      <button className="ws-button ws-button-secondary" type="button" disabled={disabled || page === 0} onClick={() => setPage(value => value - 1)}><ChevronLeft size={14} /> Anterior</button>
      <small>Página {page + 1}</small>
      <button className="ws-button ws-button-secondary" type="button" disabled={disabled || rows.length < COMMUNITY_CANDIDATE_PAGE_SIZE} onClick={() => setPage(value => value + 1)}>Siguiente <ChevronRight size={14} /></button>
    </div>}
  </section>
}
