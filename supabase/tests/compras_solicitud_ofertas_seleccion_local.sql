-- Prueba de integración A07 para una copia local/desechable ya restaurada.
-- Ejecutar en SQL Editor local con rol postgres. Nunca ejecutar en producción.
-- Antes de ejecutar, confirma visualmente que el host/conexión es el local:
-- la base local y Supabase remoto usan ambos el nombre de base `postgres`.
-- Crea una solicitud, la abre, registra 2 ofertas y selecciona una; al final
-- ROLLBACK elimina solicitud, ofertas y overrides temporales de permisos.
-- No crea órdenes, CxP, movimientos de inventario ni usuarios Auth.

begin;

do $test$
declare
  v_requester uuid;
  v_reviewer uuid;
  v_supplier_1 uuid;
  v_supplier_2 uuid;
  v_permission_view uuid;
  v_permission_create uuid;
  v_permission_edit uuid;
  v_request_id uuid;
  v_line_goods uuid;
  v_line_service uuid;
  v_offer_1 uuid;
  v_offer_2 uuid;
  v_purchase_count bigint;
  v_payment_count bigint;
  v_stock_movement_count bigint;
  v_after_purchase_count bigint;
  v_after_payment_count bigint;
  v_after_stock_movement_count bigint;
  v_selected uuid;
  v_state text;
begin
  if to_regclass('public.solicitudes_compra') is null
     or to_regclass('public.solicitud_compra_lineas') is null
     or to_regclass('public.ofertas_compra') is null
     or to_regclass('public.detalle_ofertas_compra') is null
     or to_regprocedure('public.crear_solicitud_compra(text,date,jsonb)') is null
     or to_regprocedure('public.abrir_solicitud_compra(uuid)') is null
     or to_regprocedure('public.registrar_oferta_compra(uuid,uuid,date,integer,text,jsonb)') is null
     or to_regprocedure('public.seleccionar_oferta_compra(uuid,uuid)') is null then
    raise exception 'Falta el esquema/RPC de solicitudes y comparativo; restaura y valida la copia antes de probar.';
  end if;

  if to_regclass('public.usuario_permisos') is null
     or to_regclass('public.permisos') is null
     or to_regclass('public.usuarios') is null
     or to_regclass('public.proveedores') is null then
    raise exception 'Faltan tablas de usuarios, permisos o proveedores para la prueba.';
  end if;

  select id into v_permission_view from public.permisos where modulo = 'compras' and accion = 'ver';
  select id into v_permission_create from public.permisos where modulo = 'compras' and accion = 'crear';
  select id into v_permission_edit from public.permisos where modulo = 'compras' and accion = 'editar';
  if v_permission_view is null or v_permission_create is null or v_permission_edit is null then
    raise exception 'No existen los permisos de Compras ver/crear/editar en la copia.';
  end if;

  select u.id into v_requester
  from public.usuarios u
  where u.activo
  order by u.id
  limit 1;

  select u.id into v_reviewer
  from public.usuarios u
  where u.activo and u.id <> v_requester
  order by u.id
  limit 1;

  if v_requester is null or v_reviewer is null then
    raise exception 'La prueba requiere dos perfiles Auth activos distintos en la copia restaurada.';
  end if;

  select id into v_supplier_1 from public.proveedores order by id limit 1;
  select id into v_supplier_2 from public.proveedores where id <> v_supplier_1 order by id limit 1;
  if v_supplier_1 is null or v_supplier_2 is null then
    raise exception 'La prueba requiere dos proveedores de fixture en la copia restaurada.';
  end if;

  select count(*) into v_purchase_count from public.compras;
  select count(*) into v_payment_count from public.pagos;
  select count(*) into v_stock_movement_count from public.movimientos_inventario;

  -- Sobrescribe temporalmente los permisos efectivos para comprobar actores
  -- distintos. Los cambios también quedan dentro de esta transacción y se revierten.
  insert into public.usuario_permisos (usuario_id, permiso_id, permitido)
  values
    (v_requester, v_permission_view, true),
    (v_requester, v_permission_create, true),
    (v_requester, v_permission_edit, false),
    (v_reviewer, v_permission_view, true),
    (v_reviewer, v_permission_create, false),
    (v_reviewer, v_permission_edit, true)
  on conflict (usuario_id, permiso_id) do update
    set permitido = excluded.permitido;

  -- Solicitante: bien y servicio se expresan como líneas libres, sin modificar
  -- el catálogo ni exigir inventario/almacén para una requisición.
  perform set_config('request.jwt.claim.sub', v_requester::text, true);
  v_request_id := public.crear_solicitud_compra(
    'Fixture A07 transaccional (rollback)',
    current_date + 14,
    jsonb_build_array(
      jsonb_build_object('descripcion', 'Bien de prueba A07', 'cantidad', 2, 'unidad', 'unidad'),
      jsonb_build_object('descripcion', 'Servicio de prueba A07', 'cantidad', 1, 'unidad', 'servicio')
    )
  );

  select id into v_line_goods
  from public.solicitud_compra_lineas
  where solicitud_id = v_request_id and descripcion = 'Bien de prueba A07';
  select id into v_line_service
  from public.solicitud_compra_lineas
  where solicitud_id = v_request_id and descripcion = 'Servicio de prueba A07';
  if v_line_goods is null or v_line_service is null then
    raise exception 'La RPC no persistió ambas líneas del bien/servicio.';
  end if;

  -- Revisor: apertura y selección requieren permiso de edición.
  perform set_config('request.jwt.claim.sub', v_reviewer::text, true);
  perform public.abrir_solicitud_compra(v_request_id);

  -- Solicitante: dos proveedores cotizan todas las líneas.
  perform set_config('request.jwt.claim.sub', v_requester::text, true);
  v_offer_1 := public.registrar_oferta_compra(
    v_request_id, v_supplier_1, current_date + 30, 5, 'Oferta A',
    jsonb_build_array(
      jsonb_build_object('linea_id', v_line_goods, 'precio_unitario', 10.00),
      jsonb_build_object('linea_id', v_line_service, 'precio_unitario', 25.00)
    )
  );
  v_offer_2 := public.registrar_oferta_compra(
    v_request_id, v_supplier_2, current_date + 30, 8, 'Oferta B',
    jsonb_build_array(
      jsonb_build_object('linea_id', v_line_goods, 'precio_unitario', 12.00),
      jsonb_build_object('linea_id', v_line_service, 'precio_unitario', 20.00)
    )
  );

  -- Selección de la oferta B; la RPC debe cerrar el comparativo sin crear OC/CxP/Kardex.
  perform set_config('request.jwt.claim.sub', v_reviewer::text, true);
  perform public.seleccionar_oferta_compra(v_request_id, v_offer_2);

  select estado, seleccion_oferta_id into v_state, v_selected
  from public.solicitudes_compra where id = v_request_id;
  if v_state <> 'Cerrada' or v_selected is distinct from v_offer_2 then
    raise exception 'La solicitud no quedó cerrada con la oferta elegida.';
  end if;

  if (select count(*) from public.ofertas_compra where solicitud_id = v_request_id) <> 2
     or (select count(*) from public.detalle_ofertas_compra where oferta_id in (v_offer_1, v_offer_2)) <> 4 then
    raise exception 'No se persistieron las dos ofertas completas (dos líneas por oferta).';
  end if;

  select count(*) into v_after_purchase_count from public.compras;
  select count(*) into v_after_payment_count from public.pagos;
  select count(*) into v_after_stock_movement_count from public.movimientos_inventario;
  if v_after_purchase_count <> v_purchase_count
     or v_after_payment_count <> v_payment_count
     or v_after_stock_movement_count <> v_stock_movement_count then
    raise exception 'Seleccionar oferta alteró órdenes, CxP o movimientos de inventario.';
  end if;

  raise notice 'A07 OK: solicitud %, 2 líneas (bien/servicio), 2 ofertas completas; selección cerró comparativo sin OC/CxP/Kardex. La transacción se revierte al finalizar.', v_request_id;
end
$test$;

rollback;
