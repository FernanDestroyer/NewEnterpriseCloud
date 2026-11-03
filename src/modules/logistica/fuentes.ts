// Fuentes de datos externas a la logística que usa la planificación: líneas de las ventas, almacenes y zonas de reparto.
// Todas fallan de forma controlada: si una no está disponible, la planificación sigue y avisa.
import { requireSupabase } from '../../lib/supabase'
import { fetchOrganizationSetup } from '../../services/organization'
import { fetchDocumentLines, friendlyError } from '../../services/records'
import type { LineaVenta, ZonaCliente } from './despachos'

export type AlmacenInfo = { id: string; nombre: string }

export type ContextoLogistico = {
  almacenes: AlmacenInfo[]
  /** Zona de reparto de cada cliente (clave: clientes.id). */
  zonaPorCliente: Record<string, ZonaCliente>
  /** Mensajes para mostrar cuando una fuente no pudo cargarse. */
  avisos: string[]
}

export interface FuenteDespacho {
  lineasVenta(ventaId: string): Promise<LineaVenta[]>
  contexto(): Promise<ContextoLogistico>
}

export function crearFuenteSupabase(): FuenteDespacho {
  return {
    async lineasVenta(ventaId) {
      const lineas = await fetchDocumentLines('sales', ventaId)
      return lineas.map(linea => ({ productoId: linea.producto_id, codigo: linea.codigo ?? '', nombre: linea.nombre ?? 'Producto', cantidad: linea.cantidad }))
    },

    async contexto() {
      const avisos: string[] = []
      let almacenes: AlmacenInfo[] = []
      const zonaPorCliente: Record<string, ZonaCliente> = {}
      try {
        const organizacion = await fetchOrganizationSetup()
        almacenes = organizacion.almacenes.filter(item => item.activo).map(item => ({ id: item.id, nombre: item.nombre }))
        const reparto = new Map(organizacion.zonas.filter(zona => zona.tipo === 'reparto' && zona.estado !== 'Inactivo').map(zona => [zona.id, zona.nombre]))
        if (reparto.size) {
          const { data, error } = await requireSupabase().from('zonas_clientes').select('zona_id,cliente_id')
          if (error) throw error
          for (const fila of (data ?? []) as Array<{ zona_id: string; cliente_id: string }>) {
            const nombre = reparto.get(fila.zona_id)
            if (nombre && !zonaPorCliente[fila.cliente_id]) zonaPorCliente[fila.cliente_id] = { id: fila.zona_id, nombre }
          }
        }
      } catch (error) {
        avisos.push(`No se pudieron cargar almacenes y zonas de reparto: ${friendlyError(error)}`)
      }
      return { almacenes, zonaPorCliente, avisos }
    },
  }
}
