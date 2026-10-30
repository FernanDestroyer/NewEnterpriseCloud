-- Evidencia pendiente de Fase A (A01, A03, A04 y helper de ajuste) — SOLO LECTURA.
-- No contiene INSERT/UPDATE/DELETE/DDL ni lee filas de negocio.
-- Ejecutar en Supabase SQL Editor. Guardar cada resultado con su etiqueta.

-- Objetos de Compras y dependencias incluidas en este inventario.
-- Se repite la lista en las consultas para que cada SELECT sea ejecutable por separado.

-- A01. Columnas, tipos, nulabilidad y defaults.
with target_tables(table_name) as (
  values
    ('proveedores'), ('proveedor_productos'), ('productos'), ('almacenes'), ('inventarios'),
    ('compras'), ('detalle_compras'), ('pagos'),
    ('recepciones_compra'), ('detalle_recepciones_compra'),
    ('solicitudes_compra'), ('solicitud_compra_lineas'),
    ('ofertas_compra'), ('detalle_ofertas_compra'),
    ('devoluciones_compra'), ('detalle_devoluciones_compra'),
    ('movimientos_inventario'), ('movimientos_tesoreria'), ('aplicaciones_pago'),
    ('usuarios'), ('permisos'), ('roles'), ('rol_permisos'), ('usuario_permisos')
)
select c.table_schema, c.table_name, c.ordinal_position, c.column_name,
       c.data_type, c.udt_schema, c.udt_name, c.is_nullable, c.column_default,
       c.character_maximum_length, c.numeric_precision, c.numeric_scale
from information_schema.columns c
join target_tables t on t.table_name = c.table_name
where c.table_schema = 'public'
order by c.table_name, c.ordinal_position;

-- A01b. Constraints (incluye claves foráneas y acciones ON DELETE/UPDATE).
select ns.nspname as table_schema, tbl.relname as table_name, con.conname as constraint_name,
       case con.contype when 'p' then 'PRIMARY KEY' when 'f' then 'FOREIGN KEY'
         when 'u' then 'UNIQUE' when 'c' then 'CHECK' when 'x' then 'EXCLUSION'
         else con.contype::text end as constraint_type,
       pg_get_constraintdef(con.oid, true) as definition
from pg_constraint con
join pg_class tbl on tbl.oid = con.conrelid
join pg_namespace ns on ns.oid = tbl.relnamespace
where ns.nspname = 'public'
  and tbl.relname in (
    'proveedores','proveedor_productos','productos','almacenes','inventarios',
    'compras','detalle_compras','pagos','recepciones_compra','detalle_recepciones_compra',
    'solicitudes_compra','solicitud_compra_lineas','ofertas_compra','detalle_ofertas_compra',
    'devoluciones_compra','detalle_devoluciones_compra','movimientos_inventario',
    'movimientos_tesoreria','aplicaciones_pago','usuarios','permisos','roles',
    'rol_permisos','usuario_permisos'
  )
order by tbl.relname, con.contype, con.conname;

-- A01c. Índices de las tablas operativas.
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'proveedores','proveedor_productos','productos','almacenes','inventarios',
    'compras','detalle_compras','pagos','recepciones_compra','detalle_recepciones_compra',
    'solicitudes_compra','solicitud_compra_lineas','ofertas_compra','detalle_ofertas_compra',
    'devoluciones_compra','detalle_devoluciones_compra','movimientos_inventario',
    'movimientos_tesoreria','aplicaciones_pago'
  )
order by tablename, indexname;

-- A01d. Dueño y estado RLS de las tablas.
select n.nspname as table_schema, c.relname as table_name,
       pg_get_userbyid(c.relowner) as owner_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p')
  and c.relname in (
    'proveedores','proveedor_productos','productos','almacenes','inventarios',
    'compras','detalle_compras','pagos','recepciones_compra','detalle_recepciones_compra',
    'solicitudes_compra','solicitud_compra_lineas','ofertas_compra','detalle_ofertas_compra',
    'devoluciones_compra','detalle_devoluciones_compra','movimientos_inventario',
    'movimientos_tesoreria','aplicaciones_pago'
  )
order by c.relname;

-- A02 pendiente. Helper de la función registrar_ajuste_inventario y ACL.
-- También devuelve funciones aunque existan varias sobrecargas.
select n.nspname as function_schema, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as identity_arguments,
       pg_get_function_result(p.oid) as result_type, l.lanname as language,
       p.prosecdef as security_definer, p.proconfig as function_settings,
       pg_get_userbyid(p.proowner) as owner_name,
       coalesce(p.proacl::text, '(default ACL)') as acl,
       pg_get_functiondef(p.oid) as full_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname in ('public','app_private')
  and p.proname in (
    '_registrar_ajuste_inventario',
    'registrar_ajuste_inventario',
    'ec_registrar_ajuste_inventario'
  )
order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);

-- A02b. ACL efectiva de ejecución para esas funciones.
select n.nspname as function_schema, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as identity_arguments,
       coalesce(r.rolname, 'PUBLIC') as grantee,
       x.privilege_type, x.is_grantable
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
left join pg_roles r on r.oid = x.grantee
where n.nspname in ('public','app_private')
  and p.proname in (
    '_registrar_ajuste_inventario',
    'registrar_ajuste_inventario',
    'ec_registrar_ajuste_inventario'
  )
order by n.nspname, p.proname, identity_arguments, r.rolname nulls first, x.privilege_type;

-- A03. Todas las políticas RLS de las tablas de Compras/dependencias.
select schemaname, tablename, policyname, permissive, roles, cmd,
       qual as using_expression, with_check as check_expression
from pg_policies
where schemaname = 'public'
  and tablename in (
    'proveedores','proveedor_productos','productos','almacenes','inventarios',
    'compras','detalle_compras','pagos','recepciones_compra','detalle_recepciones_compra',
    'solicitudes_compra','solicitud_compra_lineas','ofertas_compra','detalle_ofertas_compra',
    'devoluciones_compra','detalle_devoluciones_compra','movimientos_inventario',
    'movimientos_tesoreria','aplicaciones_pago'
  )
order by tablename, policyname;

-- A03b. Privilegios efectivos por rol (incluye privilegios heredados).
with target_tables(table_name) as (
  values
    ('proveedores'), ('proveedor_productos'), ('productos'), ('almacenes'), ('inventarios'),
    ('compras'), ('detalle_compras'), ('pagos'),
    ('recepciones_compra'), ('detalle_recepciones_compra'),
    ('solicitudes_compra'), ('solicitud_compra_lineas'),
    ('ofertas_compra'), ('detalle_ofertas_compra'),
    ('devoluciones_compra'), ('detalle_devoluciones_compra'),
    ('movimientos_inventario'), ('movimientos_tesoreria'), ('aplicaciones_pago')
), roles_to_check(role_name) as (
  values ('anon'), ('authenticated'), ('service_role'), ('postgres')
), targets as (
  select c.oid, n.nspname, c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join target_tables t on t.table_name = c.relname
  where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
)
select t.nspname as object_schema, t.relname as object_name, r.role_name,
       has_table_privilege(r.role_name, t.oid, 'SELECT') as can_select,
       has_table_privilege(r.role_name, t.oid, 'INSERT') as can_insert,
       has_table_privilege(r.role_name, t.oid, 'UPDATE') as can_update,
       has_table_privilege(r.role_name, t.oid, 'DELETE') as can_delete,
       has_table_privilege(r.role_name, t.oid, 'TRUNCATE') as can_truncate,
       has_table_privilege(r.role_name, t.oid, 'REFERENCES') as can_references,
       has_table_privilege(r.role_name, t.oid, 'TRIGGER') as can_trigger
from targets t
cross join roles_to_check r
where exists (select 1 from pg_roles where rolname = r.role_name)
order by t.relname, r.role_name;

-- A03c. GRANTs declarados visibles en information_schema.
select table_schema, table_name, grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'proveedores','proveedor_productos','productos','almacenes','inventarios',
    'compras','detalle_compras','pagos','recepciones_compra','detalle_recepciones_compra',
    'solicitudes_compra','solicitud_compra_lineas','ofertas_compra','detalle_ofertas_compra',
    'devoluciones_compra','detalle_devoluciones_compra','movimientos_inventario',
    'movimientos_tesoreria','aplicaciones_pago'
  )
order by table_name, grantee, privilege_type;

-- A03d. Privilegios de uso de los schemas implicados.
select s.nspname as schema_name, r.rolname as role_name,
       has_schema_privilege(r.rolname, s.oid, 'USAGE') as can_use,
       has_schema_privilege(r.rolname, s.oid, 'CREATE') as can_create
from pg_namespace s
cross join pg_roles r
where s.nspname in ('public','app_private')
  and r.rolname in ('anon','authenticated','service_role','postgres')
order by s.nspname, r.rolname;

-- A04. Historial de migraciones. to_jsonb evita asumir que existe la columna
-- name; no exporta el contenido SQL de las migraciones. Si no es visible,
-- guardar el error.
select sm.version,
       to_jsonb(sm) ->> 'name' as migration_name,
       case when jsonb_typeof(to_jsonb(sm) -> 'statements') = 'array'
         then jsonb_array_length(to_jsonb(sm) -> 'statements')
         else null end as statement_count
from supabase_migrations.schema_migrations sm
order by sm.version;
