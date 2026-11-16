import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const read = path => readFileSync(join(process.cwd(), path), 'utf8')
const migration = read('supabase/migrations/20261113113300_20261113051710_approvals_purchase_and_inventory_v1.sql')
const notificationMigration = read('supabase/migrations/20261113120316_approval_notifications_inbox_v1.sql')

test('approval requests and their event history expose read access only through RLS', () => {
  assert.match(migration, /alter table public\.ec_solicitudes_aprobacion enable row level security/i)
  assert.match(migration, /alter table public\.ec_aprobacion_eventos enable row level security/i)
  assert.match(migration, /revoke all on public\.ec_solicitudes_aprobacion, public\.ec_aprobacion_eventos from public, anon, authenticated/i)
  assert.match(migration, /grant select on public\.ec_solicitudes_aprobacion, public\.ec_aprobacion_eventos to authenticated/i)
  assert.match(migration, /solicitante_id = \(select auth\.uid\(\)\)/i)
  assert.match(migration, /active_user\.id = \(select auth\.uid\(\)\) and active_user\.activo/i)
})

test('only a separate active Gerente or Administrador may decide, and rejection needs a reason', () => {
  const decision = migration.slice(migration.indexOf('create or replace function public.ec_decidir_aprobacion_v1'), migration.indexOf('create or replace function public.ec_cerrar_conteo_sin_diferencias_v1'))
  assert.match(decision, /v_role is null or v_role not in \('Administrador', 'Gerente'\)/i)
  assert.match(decision, /v_approval\.solicitante_id = v_actor/i)
  assert.match(decision, /length\(v_reason\) not between 3 and 1000/i)
  assert.match(migration, /create unique index ec_solicitudes_aprobacion_origen_pendiente_idx[\s\S]*?tipo in \('purchase_sourcing', 'purchase_contract', 'physical_count'\)/i)
})

test('an order or count is written before the request reaches the approved state', () => {
  const decision = migration.slice(migration.indexOf('create or replace function public.ec_decidir_aprobacion_v1'), migration.indexOf('create or replace function public.ec_cerrar_conteo_sin_diferencias_v1'))
  assert.ok(decision.indexOf('v_result := public.crear_orden_compra_operativa_v4') < decision.indexOf("set estado = 'approved'"))
  assert.ok(decision.indexOf('v_result := public.convertir_solicitud_a_orden_v1') < decision.indexOf("set estado = 'approved'"))
  assert.ok(decision.indexOf('v_result := public.crear_orden_compra_desde_contrato_v1') < decision.indexOf("set estado = 'approved'"))
  assert.ok(decision.indexOf('v_result := public.ec_cerrar_inventario_fisico') < decision.indexOf("set estado = 'approved'"))
  assert.match(decision, /exception[\s\S]*?23514[\s\S]*?set estado = 'stale'/i)
})

test('purchase tables reject direct browser writes while keeping reads available', () => {
  assert.match(migration, /foreach v_table in array array\['compras', 'detalle_compras'\]/i)
  assert.match(migration, /from pg_policies[\s\S]*?cmd <> 'SELECT'[\s\S]*?drop policy/i)
  assert.match(migration, /revoke all on table public\.%i from public, anon, authenticated/i)
  assert.match(migration, /grant select on table public\.%i to authenticated/i)
  assert.match(migration, /revoke all on function app_private\._crear_orden_compra_operativa_v2\([^)]+\) from public, anon, authenticated/i)
  const historicalImport = migration.slice(
    migration.indexOf('create or replace function app_private._importar_compras_historicas_v1'),
    migration.indexOf('-- Purchase writers are exposed only')
  )
  assert.match(historicalImport, /tiene_permiso\('compras','importar'\)/i)
  assert.doesNotMatch(historicalImport, /tiene_permiso\('compras','crear'\)/i)
})

test('the physical-count snapshot groups every non-aggregate selection', () => {
  const snapshot = migration.slice(
    migration.indexOf('create or replace function app_private._ec_physical_count_snapshot_v1'),
    migration.indexOf('create or replace function app_private._ec_insert_approval_event_v1')
  )
  assert.match(snapshot, /a\.nombre/i)
  assert.match(snapshot, /group by c\.id, a\.nombre/i)
})

test('manual-order snapshots resolve provider-catalog IDs through their supplier link', () => {
  const request = migration.slice(
    migration.indexOf('create or replace function public.ec_solicitar_aprobacion_orden_manual_v1'),
    migration.indexOf('create or replace function public.ec_solicitar_aprobacion_conversion_compra_v1'),
  )
  assert.match(request, /pp\.id = \(x\.value->>'producto_id'\)::uuid and pp\.proveedor_id = p_proveedor_id/i)
  assert.match(request, /join public\.productos p on p\.id = pp\.producto_id/i)
  assert.match(request, /'producto_id', pp\.id/i)
  assert.match(request, /pp\.id is null or pp\.producto_id is null/i)
  assert.doesNotMatch(request, /join public\.productos p on p\.id = \(x\.value->>'producto_id'\)::uuid/i)
})

test('all four creation flows route through approval requests instead of direct writers', () => {
  const records = read('src/services/records.ts')
  const sourcing = read('src/services/purchaseSourcing.ts')
  const contracts = read('src/services/approvals.ts')
  const inventory = read('src/services/inventoryOperations.ts')
  assert.match(records, /ec_solicitar_aprobacion_orden_manual_v1/)
  assert.doesNotMatch(records, /crear_orden_compra_operativa_v4/)
  assert.match(sourcing, /ec_solicitar_aprobacion_conversion_compra_v1/)
  assert.doesNotMatch(sourcing, /convertir_solicitud_a_orden_v1/)
  assert.match(contracts, /ec_solicitar_aprobacion_orden_contrato_v1/)
  assert.doesNotMatch(contracts, /crear_orden_compra_desde_contrato_v1/)
  assert.match(contracts, /ec_solicitar_aprobacion_conteo_fisico_v1/)
  assert.match(inventory, /ec_cerrar_conteo_sin_diferencias_v1/)
  assert.doesNotMatch(inventory, /ec_cerrar_inventario_fisico/)
})

test('all approval request services normalize missing-migration errors', () => {
  const approvals = read('src/services/approvals.ts')
  for (const name of ['requestSourcingApproval', 'requestContractOrderApproval', 'requestPhysicalCountApproval']) {
    const start = approvals.indexOf(`export async function ${name}`)
    const end = approvals.indexOf('\nexport async function ', start + 1)
    assert.ok(start >= 0, `${name} is present`)
    assert.match(approvals.slice(start, end < 0 ? undefined : end), /if \(error\) throw approvalFailure\(error\)/)
  }
})

test('the navigation badge refreshes after every approval request route and decision', () => {
  const approvals = read('src/services/approvals.ts')
  const records = read('src/services/records.ts')
  const sourcing = read('src/services/purchaseSourcing.ts')
  const layout = read('src/components/layout/AppLayout.tsx')
  assert.match(records, /ec_solicitar_aprobacion_orden_manual_v1[\s\S]*?notifyApprovalQueueChanged\(\)/)
  assert.match(sourcing, /ec_solicitar_aprobacion_conversion_compra_v1[\s\S]*?notifyApprovalQueueChanged\(\)/)
  for (const name of ['decideApproval', 'requestSourcingApproval', 'requestContractOrderApproval', 'requestPhysicalCountApproval']) {
    const start = approvals.indexOf(`export async function ${name}`)
    const end = approvals.indexOf('\nexport async function ', start + 1)
    assert.match(approvals.slice(start, end < 0 ? undefined : end), /notifyApprovalQueueChanged\(\)/, `${name} refreshes the queue badge`)
  }
  assert.match(layout, /fetchApprovals\('pending', 0\)/)
  assert.match(layout, /child\.path === '\/aprobaciones'[\s\S]*?pendingApprovalCount/)
})

test('approval notices are transactional, idempotent and readable only with the approval permission', () => {
  const baseNotifications = read('supabase/migrations/20261113043804_persistent_operational_notifications.sql')
  const insertPolicy = baseNotifications.slice(
    baseNotifications.indexOf('create policy notificaciones_insert_propias'),
    baseNotifications.indexOf('create policy notificaciones_update_propias'),
  )
  assert.match(notificationMigration, /check \(fuente in \('inventory', 'finance', 'purchases', 'approvals'\)\)/i)
  assert.match(notificationMigration, /when 'approvals' then \(select public\.tiene_permiso\('aprobaciones', 'ver'\)\)/i)
  assert.doesNotMatch(insertPolicy, /approvals/)
  assert.match(notificationMigration, /security definer\s+set search_path = ''/i)
  assert.match(notificationMigration, /after insert on public\.ec_solicitudes_aprobacion/i)
  assert.match(notificationMigration, /after update of estado on public\.ec_solicitudes_aprobacion/i)
  assert.match(notificationMigration, /'request:' \|\| new\.id::text[\s\S]*?on conflict \(usuario_id, fuente, clave_fuente\) do nothing/i)
  assert.match(notificationMigration, /'decision:' \|\| new\.id::text[\s\S]*?on conflict \(usuario_id, fuente, clave_fuente\) do nothing/i)
  assert.match(notificationMigration, /old\.estado = 'pending'[\s\S]*?new\.estado in \('approved', 'rejected', 'stale'\)/i)

  const page = read('src/components/NotificationsPage.tsx')
  const layout = read('src/components/layout/AppLayout.tsx')
  assert.match(page, /approvals: 'Aprobaciones'/)
  assert.match(page, /return '\/aprobaciones'/)
  assert.match(layout, /source === 'approvals'\) return '\/aprobaciones'/)
})
