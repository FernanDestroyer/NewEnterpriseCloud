-- Línea base de Compras A01-A04 — SOLO LECTURA.
-- Ejecutar en Supabase SQL Editor. No contiene DDL/DML ni cambia datos.
-- Exportar cada resultado con su número/etiqueta y anotar fecha/proyecto.

-- 01. Tablas de Compras y dependencias directas: columnas, tipos, defaults y nulabilidad.
with target_tables(table_name) as (
  values
    ('proveedores'), ('proveedor_productos'), ('productos'), ('inventarios'),
    ('compras'), ('detalle_compras'), ('pagos'),
    ('recepciones_compra'), ('detalle_recepciones_compra'),
    ('solicitudes_compra'), ('solicitud_compra_lineas'),
    ('ofertas_compra'), ('detalle_ofertas_compra'),
    ('devoluciones_compra'), ('detalle_devoluciones_compra'),
    ('movimientos_inventario'), ('movimientos_tesoreria'), ('aplicaciones_pago'),
    ('usuarios'), ('permisos'), ('roles'), ('rol_permisos'), ('usuario_permisos')
)
select
  c.table_schema,
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_schema,
  c.udt_name,
  c.is_nullable,
  c.column_default,
  c.character_maximum_length,
  c.numeric_precision,
  c.numeric_scale
from information_schema.columns c
join target_tables t on t.table_name = c.table_name
where c.table_schema = 'public'
order by c.table_name, c.ordinal_position;

-- 01b. Constraints, incluidas PK/FK/check/unique y acciones referenciales.
select
  ns.nspname as table_schema,
  tbl.relname as table_name,
  con.conname as constraint_name,
  case con.contype
    when 'p' then 'PRIMARY KEY'
    when 'f' then 'FOREIGN KEY'
    when 'u' then 'UNIQUE'
    when 'c' then 'CHECK'
    when 'x' then 'EXCLUSION'
    else con.contype::text
  end as constraint_type,
  pg_get_constraintdef(con.oid, true) as definition
from pg_constraint con
join pg_class tbl on tbl.oid = con.conrelid
join pg_namespace ns on ns.oid = tbl.relnamespace
where ns.nspname = 'public'
  and tbl.relname in (
    'proveedores','proveedor_productos','productos','inventarios','compras','detalle_compras','pagos',
    'recepciones_compra','detalle_recepciones_compra','solicitudes_compra','solicitud_compra_lineas',
    'ofertas_compra','detalle_ofertas_compra','devoluciones_compra','detalle_devoluciones_compra',
    'movimientos_inventario','movimientos_tesoreria','aplicaciones_pago','usuarios','permisos','roles',
    'rol_permisos','usuario_permisos'
  )
order by tbl.relname, con.contype, con.conname;

-- 01c. Índices, definición y estado válido.
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'proveedores','proveedor_productos','productos','inventarios','compras','detalle_compras','pagos',
    'recepciones_compra','detalle_recepciones_compra','solicitudes_compra','solicitud_compra_lineas',
    'ofertas_compra','detalle_ofertas_compra','devoluciones_compra','detalle_devoluciones_compra',
    'movimientos_inventario','movimientos_tesoreria','aplicaciones_pago'
  )
order by tablename, indexname;

-- 01d. Estado de RLS por tabla y dueño.
select
  n.nspname as table_schema,
  c.relname as table_name,
  pg_get_userbyid(c.relowner) as owner_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p')
  and c.relname in (
    'proveedores','proveedor_productos','productos','inventarios','compras','detalle_compras','pagos',
    'recepciones_compra','detalle_recepciones_compra','solicitudes_compra','solicitud_compra_lineas',
    'ofertas_compra','detalle_ofertas_compra','devoluciones_compra','detalle_devoluciones_compra',
    'movimientos_inventario','movimientos_tesoreria','aplicaciones_pago'
  )
order by c.relname;

-- 02. Funciones relacionadas: firma, retorno, cuerpo, seguridad, config/search_path,
--     propietario y ACL declarada. Incluye públicas y helpers app_private.
select
  n.nspname as function_schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type,
  l.lanname as language,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  p.proconfig as function_settings,
  pg_get_userbyid(p.proowner) as owner_name,
  coalesce(p.proacl::text, '(default ACL)') as acl,
  pg_get_functiondef(p.oid) as full_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname in ('public','app_private')
  and p.proname in (
    'crear_orden_compra_operativa','_crear_orden_compra_operativa',
    'registrar_recepcion_compra','registrar_movimiento_inventario',
    'registrar_devolucion_compra','crear_solicitud_compra','abrir_solicitud_compra',
    'registrar_oferta_compra','seleccionar_oferta_compra',
    'obtener_saldos_cuentas','registrar_pago_parcial','registrar_pago_parcial_en_turno',
    'tiene_permiso','_tiene_permiso','usuario_activo','_usuario_activo','es_admin','_es_admin',
    'asignar_codigo','registrar_kardex','pagos_before_write'
  )
order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);

-- 02b. ACL efectiva de ejecución para funciones seleccionadas.
select
  n.nspname as function_schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  coalesce(grantee.rolname, 'PUBLIC') as grantee,
  acl.privilege_type,
  acl.is_grantable
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
left join pg_roles grantee on grantee.oid = acl.grantee
where n.nspname in ('public','app_private')
  and p.proname in (
    'crear_orden_compra_operativa','_crear_orden_compra_operativa',
    'registrar_recepcion_compra','registrar_movimiento_inventario',
    'registrar_devolucion_compra','crear_solicitud_compra','abrir_solicitud_compra',
    'registrar_oferta_compra','seleccionar_oferta_compra',
    'obtener_saldos_cuentas','registrar_pago_parcial','registrar_pago_parcial_en_turno',
    'tiene_permiso','_tiene_permiso','usuario_activo','_usuario_activo','es_admin','_es_admin'
  )
order by n.nspname, p.proname, identity_arguments, grantee.rolname nulls first, acl.privilege_type;

-- 03. Políticas RLS completas, incluidas USING/WITH CHECK.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual as using_expression,
  with_check as check_expression
from pg_policies
where schemaname = 'public'
  and tablename in (
    'proveedores','proveedor_productos','productos','inventarios','compras','detalle_compras','pagos',
    'recepciones_compra','detalle_recepciones_compra','solicitudes_compra','solicitud_compra_lineas',
    'ofertas_compra','detalle_ofertas_compra','devoluciones_compra','detalle_devoluciones_compra',
    'movimientos_inventario','movimientos_tesoreria','aplicaciones_pago'
  )
order by tablename, policyname;

-- 04. Privilegios efectivos de tablas/secuencias para roles de API.
-- has_* evalúa también privilegios heredados; resultado distinto de ACL declarada.
with targets as (
  select c.oid, n.nspname, c.relname, c.relkind
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'proveedores','proveedor_productos','productos','inventarios','compras','detalle_compras','pagos',
      'recepciones_compra','detalle_recepciones_compra','solicitudes_compra','solicitud_compra_lineas',
      'ofertas_compra','detalle_ofertas_compra','devoluciones_compra','detalle_devoluciones_compra',
      'movimientos_inventario','movimientos_tesoreria','aplicaciones_pago'
    )
), roles_to_check(role_name) as (values ('anon'),('authenticated'),('service_role'),('postgres'))
select
  t.nspname as object_schema,
  t.relname as object_name,
  r.role_name,
  has_table_privilege(r.role_name, t.oid, 'SELECT') as can_select,
  has_table_privilege(r.role_name, t.oid, 'INSERT') as can_insert,
  has_table_privilege(r.role_name, t.oid, 'UPDATE') as can_update,
  has_table_privilege(r.role_name, t.oid, 'DELETE') as can_delete,
  has_table_privilege(r.role_name, t.oid, 'TRUNCATE') as can_truncate,
  has_table_privilege(r.role_name, t.oid, 'REFERENCES') as can_references,
  has_table_privilege(r.role_name, t.oid, 'TRIGGER') as can_trigger
from targets t cross join roles_to_check r
where exists (select 1 from pg_roles where rolname = r.role_name)
order by t.relname, r.role_name;

-- 04b. Grants/defaults declarados en information_schema (cuando están visibles).
select table_schema, table_name, grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'proveedores','proveedor_productos','productos','inventarios','compras','detalle_compras','pagos',
    'recepciones_compra','detalle_recepciones_compra','solicitudes_compra','solicitud_compra_lineas',
    'ofertas_compra','detalle_ofertas_compra','devoluciones_compra','detalle_devoluciones_compra',
    'movimientos_inventario','movimientos_tesoreria','aplicaciones_pago'
  )
order by table_name, grantee, privilege_type;

-- 05. Historial registrado por Supabase (solo lectura).
-- Si falla por permisos/relación ausente, no sustituirlo con supuestos: usar
-- `npx supabase migration list --linked` y guardar salida fechada.
select version, name
from supabase_migrations.schema_migrations
order by version;

-- 05b. Confirmar qué migraciones locales recientes dejaron objetos característicos.
-- Esto es evidencia de objetos presentes, NO prueba de que un archivo se aplicó.
select
  to_regclass('public.solicitudes_compra') as solicitudes_compra,
  to_regclass('public.devoluciones_compra') as devoluciones_compra,
  to_regclass('public.recepciones_compra') as recepciones_compra,
  to_regprocedure('public.crear_orden_compra_operativa(uuid,text,date,numeric,jsonb,text)') as rpc_crear_orden,
  to_regprocedure('public.registrar_devolucion_compra(uuid,text,jsonb,text)') as rpc_devolucion,
  to_regprocedure('public.ec_registrar_ajuste_inventario(uuid,uuid,integer,text,text)') as rpc_ajuste_ec;

-- 05c. Descubrir cualquier sobrecarga por nombre, sin asumir argumentos.
-- En particular, no concluyas que registrar_ajuste_inventario no existe solo
-- porque no coincida con una firma candidata.
select
  n.nspname as function_schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  pg_get_userbyid(p.proowner) as owner_name,
  coalesce(p.proacl::text, '(default ACL)') as acl,
  pg_get_functiondef(p.oid) as full_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','app_private')
  and p.proname in ('registrar_ajuste_inventario','ec_registrar_ajuste_inventario')
order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);
