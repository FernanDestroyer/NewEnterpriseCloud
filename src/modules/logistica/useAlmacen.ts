// Hook que resuelve el almacén de datos de Logística (Supabase si está disponible, navegador si no).
import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { obtenerAlmacenVerificado } from './db'
import type { AlmacenLogistica } from './storage'

/** Devuelve null mientras se verifica dónde viven los datos; luego el almacén definitivo. */
export function useAlmacenLogistica(): AlmacenLogistica | null {
  const { session } = useAuth()
  const ambito = session?.user.id ?? 'sin-sesion'
  const [almacen, setAlmacen] = useState<AlmacenLogistica | null>(null)

  useEffect(() => {
    let vigente = true
    setAlmacen(null)
    void obtenerAlmacenVerificado(ambito).then(resuelto => { if (vigente) setAlmacen(resuelto) })
    return () => { vigente = false }
  }, [ambito])

  return almacen
}
