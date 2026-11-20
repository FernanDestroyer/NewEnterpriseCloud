import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronUp, LockKeyhole, MessageCircle, RefreshCw, Send } from 'lucide-react'
import { COMMUNITY_PAGE_SIZE, communityError, listCommunityMessages, sendCommunityMessage, type CommunityGroup, type CommunityMessage } from '../services/community'

const clock = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit' })
const calendar = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', dateStyle: 'long' })

export default function CommunityChat({ group, userId }: { group: CommunityGroup; userId: string }) {
  const [latest, setLatest] = useState<CommunityMessage[]>([])
  const [earlier, setEarlier] = useState<CommunityMessage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [hasEarlier, setHasEarlier] = useState(true)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [error, setError] = useState('')
  const [sendError, setSendError] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const pending = useRef<{ id: string; text: string } | null>(null)
  const latestRef = useRef<CommunityMessage[]>([])
  const request = useRef(0)
  const alive = useRef(false)
  const scroll = useRef<HTMLDivElement>(null)
  const shouldFollow = useRef(true)
  const scrollAnchor = useRef<{ height: number; top: number } | null>(null)

  const refresh = useCallback(async () => {
    const version = ++request.current
    try {
      const rows = await listCommunityMessages(group.id)
      if (!alive.current || version !== request.current) return
      const previous = latestRef.current
      const incoming = new Set(rows.map(message => message.id))
      const overlapping = previous.some(message => incoming.has(message.id))
      if (!rows.length || (previous.length > 0 && !overlapping)) {
        setEarlier([])
        setHasEarlier(true)
      }
      // Si hay solapamiento, conserva el tramo ya visto aunque entre un mensaje nuevo.
      latestRef.current = overlapping ? [...rows, ...previous.filter(message => !incoming.has(message.id))] : rows
      setLatest(latestRef.current)
      setError('')
    } catch (cause) {
      if (!alive.current || version !== request.current) return
      latestRef.current = []
      setLatest([])
      setEarlier([])
      setHasEarlier(true)
      setError(communityError(cause, 'No se pudo actualizar la conversación.'))
    } finally {
      if (alive.current && version === request.current) setLoaded(true)
    }
  }, [group.id])

  useEffect(() => {
    alive.current = true
    const poll = () => { if (document.visibilityState === 'visible') void refresh() }
    void refresh()
    const timer = window.setInterval(poll, 6000)
    document.addEventListener('visibilitychange', poll)
    return () => { alive.current = false; request.current++; window.clearInterval(timer); document.removeEventListener('visibilitychange', poll) }
  }, [refresh])

  useLayoutEffect(() => {
    const panel = scroll.current
    if (!panel) return
    if (scrollAnchor.current) {
      panel.scrollTop = scrollAnchor.current.top + panel.scrollHeight - scrollAnchor.current.height
      scrollAnchor.current = null
    } else if (shouldFollow.current) panel.scrollTop = panel.scrollHeight
  }, [latest, earlier])

  const messages = latest.length ? [...new Map([...earlier, ...latest].map(message => [message.id, message])).values()]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)) : []

  const loadEarlier = async () => {
    if (!messages.length || loadingEarlier) return
    setLoadingEarlier(true)
    try {
      const rows = await listCommunityMessages(group.id, messages[0])
      if (!alive.current) return
      if (scroll.current) scrollAnchor.current = { height: scroll.current.scrollHeight, top: scroll.current.scrollTop }
      setEarlier(current => [...current, ...rows])
      setHasEarlier(rows.length === COMMUNITY_PAGE_SIZE)
      setError('')
    } catch (cause) { if (alive.current) setError(communityError(cause, 'No se pudo cargar el historial.')) }
    finally { if (alive.current) setLoadingEarlier(false) }
  }

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = body.trim()
    if (!text || text.length > 2000 || sending) return
    setSending(true)
    setSendError('')
    try {
      if (pending.current?.text !== text) pending.current = { id: crypto.randomUUID(), text }
      await sendCommunityMessage(group.id, pending.current.id, text)
      if (!alive.current) return
      pending.current = null
      setBody('')
      shouldFollow.current = true
      void refresh()
    } catch (cause) { if (alive.current) setSendError(communityError(cause, 'No se pudo enviar. Puedes reintentar sin duplicar el mensaje.')) }
    finally { if (alive.current) setSending(false) }
  }

  return <>
    <div className="community-chat-meta"><LockKeyhole size={14} />{group.rol
      ? <span>Solo las personas con el rol <strong>{group.rol}</strong>{group.rol !== 'Administrador' && ' y los administradores'} pueden leer y escribir.</span>
      : <span>Solo las <strong>personas seleccionadas</strong> y los administradores pueden leer y escribir.</span>}</div>
    <div className="community-thread" ref={scroll} role="region" aria-label="Mensajes del grupo" tabIndex={0} onScroll={event => {
      const panel = event.currentTarget
      shouldFollow.current = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 70
    }}>
      {messages.length >= COMMUNITY_PAGE_SIZE && hasEarlier && <button className="ws-button ws-button-secondary community-earlier" type="button" disabled={loadingEarlier} onClick={() => void loadEarlier()}><ChevronUp size={15} />{loadingEarlier ? 'Cargando…' : 'Ver mensajes anteriores'}</button>}
      {!messages.length && <div className="community-thread-empty">
        <span className="community-empty-icon"><MessageCircle size={26} /></span>
        <strong>{!loaded ? 'Cargando conversación…' : error ? 'Conversación no disponible' : 'Aún no hay mensajes'}</strong>
        {loaded && !error && <span>Sé la primera persona en iniciar la conversación.</span>}
      </div>}
      {messages.map((message, index) => {
        const mine = message.autor_id === userId
        const date = calendar.format(new Date(message.created_at))
        const previous = messages[index - 1]
        return <div key={message.id}>
          {(!previous || calendar.format(new Date(previous.created_at)) !== date) && <div className="community-day"><span>{date}</span></div>}
          <div className={`community-message${mine ? ' community-message-mine' : ''}`}>
            <span className="community-avatar" aria-hidden="true">{mine ? 'TÚ' : message.autor_nombre.trim().slice(0, 2).toLocaleUpperCase('es') || '?'}</span>
            <div className="community-bubble"><div><strong>{mine ? 'Tú' : message.autor_nombre}</strong><time dateTime={message.created_at}>{clock.format(new Date(message.created_at))}</time></div><p>{message.cuerpo}</p></div>
          </div>
        </div>
      })}
    </div>
    {error && <div className="community-chat-error" role="status">{error} <button className="ws-button ws-button-secondary" type="button" onClick={() => void refresh()}><RefreshCw size={14} /> Reintentar</button></div>}
    <form className="community-compose" onSubmit={send}>
      <label htmlFor="community-message-body">Escribir mensaje</label>
      <div><textarea id="community-message-body" rows={2} maxLength={2000} value={body} disabled={sending || !loaded} onChange={event => { setBody(event.target.value); setSendError('') }} placeholder={`Envía un mensaje a ${group.nombre}…`} /><button className="ws-button community-send" type="submit" disabled={sending || !loaded || !body.trim()}><Send size={16} />{sending ? 'Enviando…' : 'Enviar'}</button></div>
      {sendError ? <small className="community-error-text" role="alert">{sendError}</small> : <small>{body.length}/2000</small>}
    </form>
  </>
}
