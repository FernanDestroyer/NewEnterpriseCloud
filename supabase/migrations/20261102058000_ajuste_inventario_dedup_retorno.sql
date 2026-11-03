-- Correccion menor de la Fase 3: en la ruta de repeticion identica,
-- _registrar_ajuste_inventario retornaba v_id sin haberlo poblado (NULL).
-- Ahora devuelve el asiento ya registrado en ajustes_inventario.
create or replace function app_private._registrar_ajuste_inventario(
  p_producto_id uuid, p_almacen_id uuid, p_cantidad integer, p_motivo text, p_idempotency_key text)
returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_motivo text := nullif(btrim(p_motivo), '');
  v_antes integer; v_nuevo integer; v_global integer; v_hash text; v_existing_hash text; v_id uuid;
begin
  if v_uid is null or not (
    (select app_private._tiene_permiso('inventario', 'crear'))
    or (select app_private._tiene_permiso('inventario', 'editar'))
  ) then
    raise exception 'No tienes permiso para ajustar inventario.' using errcode = '42501';
  end if;

  if p_producto_id is null or p_almacen_id is null or p_cantidad is null or p_cantidad = 0
     or v_motivo is null or v_key is null then
    raise exception 'Indica producto, almacén, cantidad distinta de cero, motivo y clave de solicitud.'
      using errcode = '22023';
  end if;

  v_hash := md5(concat_ws('|', p_producto_id, p_almacen_id, p_cantidad, v_motivo));
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  select payload_hash into v_existing_hash from public.movimientos_inventario
  where idempotency_key = v_key;
  if found then
    if v_existing_hash is not distinct from v_hash then
      -- Repetición idéntica: devolver el asiento ya registrado.
      select id into v_id from public.ajustes_inventario where idempotency_key = v_key;
      return v_id;
    end if;
    raise exception 'La clave ya se utilizó para otro ajuste.' using errcode = '23505';
  end if;

  if not exists (select 1 from public.productos where id = p_producto_id) then
    raise exception 'El producto no existe.' using errcode = '23503';
  end if;
  if not exists (select 1 from public.almacenes where id = p_almacen_id and activo) then
    raise exception 'El almacén debe estar activo.' using errcode = '23503';
  end if;

  insert into public.inventarios (producto_id, almacen_id, cantidad)
  values (p_producto_id, p_almacen_id, 0)
  on conflict (producto_id, almacen_id) do nothing;

  select cantidad into v_antes from public.inventarios
  where producto_id = p_producto_id and almacen_id = p_almacen_id for update;
  v_nuevo := coalesce(v_antes, 0) + p_cantidad;
  if v_nuevo < 0 then
    raise exception 'El ajuste dejaría el stock del almacén en negativo.' using errcode = '23514';
  end if;

  select stock into v_global from public.productos where id = p_producto_id for update;
  if not found or coalesce(v_global, 0) + p_cantidad < 0 then
    raise exception 'El ajuste no puede dejar el stock global en negativo.' using errcode = '23514';
  end if;

  insert into public.ajustes_inventario
    (producto_id, almacen_id, stock_anterior, stock_nuevo, motivo, idempotency_key, payload_hash, created_by)
  values
    (p_producto_id, p_almacen_id, coalesce(v_antes, 0), v_nuevo, v_motivo, v_key, v_hash, v_uid)
  returning id into v_id;

  -- La bandera evita que trg_kardex duplique el movimiento.
  perform set_config('app.ec_inventory_rpc', 'on', true);

  update public.inventarios set cantidad = v_nuevo, updated_at = now()
  where producto_id = p_producto_id and almacen_id = p_almacen_id;

  update public.productos set stock = coalesce(v_global, 0) + p_cantidad, updated_at = now()
  where id = p_producto_id;

  insert into public.movimientos_inventario
    (producto_id, almacen_id, tipo, cantidad, stock_anterior, stock_nuevo,
     referencia, usuario_id, idempotency_key, payload_hash, origen_tipo, origen_id, motivo)
  values
    (p_producto_id, p_almacen_id, 'ajuste', p_cantidad, coalesce(v_antes, 0), v_nuevo,
     'Ajuste ' || v_id::text, v_uid, v_key, v_hash, 'ajuste_inventario', v_id, v_motivo);

  return v_id;
end;
$function$;
