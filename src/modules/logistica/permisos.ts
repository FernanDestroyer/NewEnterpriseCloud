import type { PermissionAction } from '../../context/AuthContext'
import type { PermissionModuleKey } from '../../data/workspace'

// Permiso propio del módulo: las filas ('logistica', ver/crear/editar) vienen en el script base
// y las políticas RLS de vehiculos, conductores, asignaciones_vehiculo y despachos exigen las mismas.
export const PERMISO_LOGISTICA: PermissionModuleKey = 'logistica'

type Can = (page: PermissionModuleKey, action?: PermissionAction) => boolean

export function permisosLogistica(can: Can) {
  return {
    ver: can(PERMISO_LOGISTICA, 'ver'),
    crear: can(PERMISO_LOGISTICA, 'crear'),
    editar: can(PERMISO_LOGISTICA, 'editar'),
  }
}
