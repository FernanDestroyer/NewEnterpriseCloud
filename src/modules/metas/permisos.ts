import type { PermissionAction } from '../../context/AuthContext'
import type { PermissionModuleKey } from '../../data/workspace'

// Permiso final: las filas metas:ver/crear/editar/eliminar se crean con la migración
// 20261103000000_metas_objetivos.sql. Cámbialo aquí si se renombra el módulo.
export const PERMISO_METAS: PermissionModuleKey = 'metas'

type Can = (page: PermissionModuleKey, action?: PermissionAction) => boolean

/**
 * El módulo se rige por el permiso `metas`, que se crea con la migración 20261103000000.
 * Mientras esa migración no se aplique (o antes de asignar el rol), el Administrador
 * conserva acceso completo para no quedar bloqueado. Y si el módulo corre con respaldo
 * en el navegador (sin tablas todavía), el fallback también se activa: de otra forma
 * nadie podría registrar las primeras metas para probar el módulo.
 */
export function permisosMetas(can: Can, esAdministrador = false, standalone = false) {
  const respaldo = esAdministrador || standalone
  return {
    ver: can(PERMISO_METAS, 'ver') || respaldo,
    crear: can(PERMISO_METAS, 'crear') || respaldo,
    editar: can(PERMISO_METAS, 'editar') || respaldo,
    eliminar: can(PERMISO_METAS, 'eliminar') || respaldo,
  }
}
