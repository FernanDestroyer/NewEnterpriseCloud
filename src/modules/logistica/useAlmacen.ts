// Hook que resuelve el almacén de datos de Logística (Supabase si está disponible, navegador si no).
import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { obtenerAlmacenVerificado } from './db'
import { crearAlmacenLocal, type AlmacenLogistica } from './storage'

/** Devuelve null mientras se verifica dónde viven los datos; luego el almacén definitivo. */
export function useAlmacenLogistica(): AlmacenLogistica | null {
  const { session } = useAuth()
  const ambito = session?.user.id ?? 'sin-sesion'
  const [almacen, setAlmacen] = useState<AlmacenLogistica | null>(null)

  useEffect(() => {
    let vigente = true
    setAlmacen(null)
    void obtenerAlmacenVerificado(ambito)
      .then(resuelto => { if (vigente) setAlmacen(resuelto) })
      // Si la verificación falla (red, permisos), el módulo sigue usable con respaldo local
      // en lugar de quedarse para siempre en «Cargando…».
      .catch(() => { if (vigente) setAlmacen(crearAlmacenLocal(ambito)) })
    return () => { vigente = false }
  }, [ambito])

  return almacen
}
