import { useEffect, useState } from 'react'

/**
 * Devuelve el valor recibido solo después de que haya dejado de cambiar
 * durante `delay` milisegundos. Evita disparar consultas en cada tecla.
 */
export default function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = globalThis.setTimeout(() => setDebounced(value), delay)
    return () => globalThis.clearTimeout(timer)
  }, [value, delay])

  return debounced
}
