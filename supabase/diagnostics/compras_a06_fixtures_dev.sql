-- A06: fixtures persistentes para entorno remoto EXCLUSIVO de desarrollo/pruebas.
-- Ejecutar manualmente en Supabase SQL Editor solo después de confirmar el proyecto.
-- Re-ejecutable: crea solo objetos etiquetados A06 QA; no borra ni cambia permisos.
-- No ejecutar en producción. La orden histórica se crea como cabecera cerrada sin
-- alterar stock; las solicitudes/ofertas del A07 se crearán desde el frontend.

begin;

do $fixtures$
declare
  v_empresa_id uuid;
  v_sucursal_id uuid;
  v_almacen_1 uuid;
  v_almacen_2 uuid;
  v_proveedor_1 uuid;
  v_proveedor_2 uuid;
  v_producto_id uuid;
  v_creator_id uuid;
  v_reviewer_id uuid;
  v_producto_nombre constant text := 'A06 QA BIEN - no contabilizar';
  v_proveedor_1_nombre constant text := 'A06 QA Proveedor Alpha';
  v_proveedor_2_nombre constant text := 'A06 QA Proveedor Beta';
  v_orden_detalle constant text := 'A06 QA orden histórica - fixture de pruebas';
begin
  -- Preflight: requiere el esquema operativo actual y el flujo de sourcing.
  if to_regclass('public.empresas') is null
     or to_regclass('public.sucursales') is null
     or to_regclass('public.almacenes') is null
     or to_regclass('public.productos') is null
     or to_regclass('public.inventarios') is null
     or to_regclass('public.proveedores') is null
     or to_regclass('public.proveedor_productos') is null
     or to_regclass('public.compras') is null
     or to_regclass('public.usuarios') is null
     or to_regclass('public.permisos') is null
     or to_regclass('public.rol_permisos') is null
     or to_regclass('public.usuario_permisos') is null then
    raise exception 'Falta una tabla requerida por A06; no se insertaron fixtures. Verifica el esquema remoto antes de ejecutar.';
  end if;

  if to_regclass('public.solicitudes_compra') is null
     or to_regprocedure('public.crear_solicitud_compra(text,date,jsonb)') is null
     or to_regprocedure('public.seleccionar_oferta_compra(uuid,uuid)') is null then
    raise exception 'No está instalado el esquema/RPC de solicitudes y comparativo; no se insertaron fixtures.';
  end if;

  -- No se crean cuentas Auth ni se conceden permisos. Se exigen dos perfiles
  -- activos distintos: uno apto para crear y otro apto para editar.
  select u.id into v_creator_id
  from public.usuarios u
  join public.permisos pv on pv.modulo = 'compras' and pv.accion = 'ver'
  join public.permisos pc on pc.modulo = 'compras' and pc.accion = 'crear'
  where u.activo
    and coalesce(
      (select up.permitido from public.usuario_permisos up
       where up.usuario_id = u.id and up.permiso_id = pv.id),
      exists (select 1 from public.rol_permisos rp
              where rp.rol_id = u.rol_id and rp.permiso_id = pv.id)
    )
    and coalesce(
      (select up.permitido from public.usuario_permisos up
       where up.usuario_id = u.id and up.permiso_id = pc.id),
      exists (select 1 from public.rol_permisos rp
              where rp.rol_id = u.rol_id and rp.permiso_id = pc.id)
    )
  order by u.id
  limit 1;

  select u.id into v_reviewer_id
  from public.usuarios u
  join public.permisos pv on pv.modulo = 'compras' and pv.accion = 'ver'
  join public.permisos pe on pe.modulo = 'compras' and pe.accion = 'editar'
  where u.activo and u.id <> v_creator_id
    and coalesce(
      (select up.permitido from public.usuario_permisos up
       where up.usuario_id = u.id and up.permiso_id = pv.id),
      exists (select 1 from public.rol_permisos rp
              where rp.rol_id = u.rol_id and rp.permiso_id = pv.id)
    )
    and coalesce(
      (select up.permitido from public.usuario_permisos up
       where up.usuario_id = u.id and up.permiso_id = pe.id),
      exists (select 1 from public.rol_permisos rp
              where rp.rol_id = u.rol_id and rp.permiso_id = pe.id)
    )
  order by u.id
  limit 1;

  if v_creator_id is null or v_reviewer_id is null then
    raise exception 'A06 requiere dos perfiles activos distintos: uno con Compras ver/crear y otro con Compras ver/editar. No se modificaron usuarios ni permisos.';
  end if;

  -- Serializa re-ejecuciones de este conjunto de fixtures.
  perform pg_advisory_xact_lock(hashtextextended('enterprisecloud:A06:fixtures', 0));

  insert into public.empresas (codigo, razon_social, nombre_comercial, es_principal, estado)
  values ('A06-QA', 'A06 QA - Empresa de pruebas', 'A06 QA', false, 'Activo')
  on conflict (codigo) do nothing;
  select id into strict v_empresa_id from public.empresas where codigo = 'A06-QA';

  insert into public.sucursales (empresa_id, codigo, nombre, estado)
  values (v_empresa_id, 'A06-QA', 'A06 QA - Sucursal de pruebas', 'Activo')
  on conflict (empresa_id, codigo) do nothing;
  select id into strict v_sucursal_id
  from public.sucursales where empresa_id = v_empresa_id and codigo = 'A06-QA';

  select id into v_almacen_1 from public.almacenes
  where sucursal_id = v_sucursal_id and lower(btrim(nombre)) = lower('A06 QA Almacén Norte');
  if v_almacen_1 is null then
    insert into public.almacenes (nombre, sucursal_id, activo)
    values ('A06 QA Almacén Norte', v_sucursal_id, true)
    returning id into v_almacen_1;
  end if;

  select id into v_almacen_2 from public.almacenes
  where sucursal_id = v_sucursal_id and lower(btrim(nombre)) = lower('A06 QA Almacén Sur');
  if v_almacen_2 is null then
    insert into public.almacenes (nombre, sucursal_id, activo)
    values ('A06 QA Almacén Sur', v_sucursal_id, true)
    returning id into v_almacen_2;
  end if;

  select id into v_proveedor_1 from public.proveedores where razon_social = v_proveedor_1_nombre order by id limit 1;
  if v_proveedor_1 is null then
    insert into public.proveedores (codigo, razon_social, detalle, estado, created_by)
    values ('A06-QA-P1', v_proveedor_1_nombre, 'Fixture A06; no usar en operaciones reales.', 'Activo', v_creator_id)
    returning id into v_proveedor_1;
  end if;

  select id into v_proveedor_2 from public.proveedores where razon_social = v_proveedor_2_nombre order by id limit 1;
  if v_proveedor_2 is null then
    insert into public.proveedores (codigo, razon_social, detalle, estado, created_by)
    values ('A06-QA-P2', v_proveedor_2_nombre, 'Fixture A06; no usar en operaciones reales.', 'Activo', v_creator_id)
    returning id into v_proveedor_2;
  end if;

  select id into v_producto_id from public.productos where nombre = v_producto_nombre order by id limit 1;
  if v_producto_id is null then
    insert into public.productos (codigo, nombre, detalle, stock, estado, created_by)
    values ('A06-QA', v_producto_nombre, 'Bien fixture A06; stock inicial cero.', 0, 'Estable', v_creator_id)
    returning id into v_producto_id;
  end if;

  -- Aperturas en cero para demostrar existencia en ambos almacenes sin mover stock.
  insert into public.inventarios (producto_id, almacen_id, cantidad)
  values (v_producto_id, v_almacen_1, 0), (v_producto_id, v_almacen_2, 0)
  on conflict (producto_id, almacen_id) do nothing;

  -- Catálogo de proveedor: bien vinculado al maestro y servicio sin producto/stock.
  insert into public.proveedor_productos (proveedor_id, nombre, detalle, costo, producto_id, created_by)
  values
    (v_proveedor_1, v_producto_nombre, 'Fixture A06 bien', 10.00, v_producto_id, v_creator_id),
    (v_proveedor_2, v_producto_nombre, 'Fixture A06 bien', 12.00, v_producto_id, v_creator_id),
    (v_proveedor_1, 'A06 QA Servicio de mantenimiento', 'Fixture A06 servicio; no genera inventario.', 25.00, null, v_creator_id),
    (v_proveedor_2, 'A06 QA Servicio de mantenimiento', 'Fixture A06 servicio; no genera inventario.', 20.00, null, v_creator_id)
  on conflict (proveedor_id, nombre) do nothing;

  -- Orden histórica sintética: cabecera pagada/completa, no crea recepción ni Kardex.
  if not exists (select 1 from public.compras where detalle = v_orden_detalle) then
    insert into public.compras (
      proveedor_id, proveedor_nombre, detalle, monto, estado,
      estado_recepcion, requiere_recepcion, created_by
    )
    values (
      v_proveedor_1, v_proveedor_1_nombre, v_orden_detalle, 42.00, 'Pagada',
      'completa', false, v_creator_id
    );
  end if;

  raise notice 'Fixtures A06 listos. Empresa %, sucursal %, almacenes % y %, bien %, proveedores % y %. Actor creador %; actor revisor %. El script no alteró permisos.',
    v_empresa_id, v_sucursal_id, v_almacen_1, v_almacen_2,
    v_producto_id, v_proveedor_1, v_proveedor_2, v_creator_id, v_reviewer_id;
end
$fixtures$;

commit;

-- Resultado de control para copiar junto al resultado del script.
select 'empresas' as fixture, id::text as id, codigo as referencia
from public.empresas where codigo = 'A06-QA'
union all
select 'sucursales', id::text, codigo
from public.sucursales where codigo = 'A06-QA'
union all
select 'almacenes', id::text, nombre
from public.almacenes where nombre in ('A06 QA Almacén Norte', 'A06 QA Almacén Sur')
union all
select 'proveedores', id::text, razon_social
from public.proveedores where razon_social in ('A06 QA Proveedor Alpha', 'A06 QA Proveedor Beta')
union all
select 'producto', id::text, nombre
from public.productos where nombre = 'A06 QA BIEN - no contabilizar'
union all
select 'orden_historica', id::text, detalle
from public.compras where detalle = 'A06 QA orden histórica - fixture de pruebas'
order by fixture, referencia;

-- Mapea los IDs reportados en NOTICE con el email/rol para entrar al frontend.
select u.id, u.email, r.nombre as rol, u.activo
from public.usuarios u
left join public.roles r on r.id = u.rol_id
where u.activo
order by r.nombre, u.email;
