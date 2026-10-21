import { useEffect, useRef } from 'react'

let openDialogs = 0
let previousOverflow = ''

export function useDialog<T extends HTMLElement>(onClose: () => void, busy = false) {
  const ref = useRef<T>(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  closeRef.current = onClose
  busyRef.current = busy
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    if (!openDialogs++) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden' }
    const focusable = () => [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]') ?? [])].filter(element => element.getClientRects().length)
    if (!ref.current?.contains(document.activeElement)) (ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0])?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (!ref.current?.contains(document.activeElement)) return
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); closeRef.current() }
      if (event.key !== 'Tab') return
      const items = focusable()
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      if (!--openDialogs) document.body.style.overflow = previousOverflow
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return ref
}
