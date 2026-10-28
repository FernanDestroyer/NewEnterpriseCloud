-- Crea orden, líneas y obligación en una sola transacción.
-- El cliente nunca compensa una escritura parcial borrando datos.
-- Alcance funcional provisional: solo comprobantes gravados con IGV estándar del 18%.

begin;

alter table public.compras
  add column if not exists idempotency_key text,
  add column if not exists payload_hash text,
  add column if not exists requiere_recepcion boolean not null default true;

create unique index if not exists compras_idempotency_uidx
  on public.compras (idempotency_key)
  where idempotency_key is not null;

create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

create or replace function app_private._crear_orden_compra_operativa(
  p_proveedor_id uuid,
  p_detalle text,
  p_fecha_limite date,
  p_monto_manual numeric,
  p_lineas jsonb,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(trim(p_idempotency_key), '');
  v_hash text;
  v_compra_id uuid;
  v_codigo text;
  v_payload_hash text;
  v_proveedor_nombre text;
  v_line jsonb;
  v_catalogo_id uuid;
  v_producto_id uuid;
  v_cantidad integer;
  v_costo numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_total_cxp numeric(14,2);
  v_requiere_recepcion boolean;
begin
  if v_uid is null
     or not (select public.tiene_permiso('compras', 'crear')) then
    raise exception 'Se requiere permiso para crear compras.'
      using errcode = '42501';
  end if;
  if v_key is null then
    raise exception 'Falta la clave de idempotencia de la orden.' using errcode = '22023';
  end if;
  if p_proveedor_id is null then
    raise exception 'Selecciona un proveedor registrado.' using errcode = '22023';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'Las líneas de compra deben enviarse como una lista.' using errcode = '22023';
  end if;
  v_requiere_recepcion := jsonb_array_length(p_lineas) > 0;
  if v_requiere_recepcion and (select count(*) from (
        select value->>'producto_id'
        from jsonb_array_elements(p_lineas)
        group by value->>'producto_id'
      ) as lineas_distintas) <> jsonb_array_length(p_lineas) then
    raise exception 'Un artículo solo puede aparecer una vez en la orden.' using errcode = '22023';
  end if;

  v_hash := md5(concat_ws('|', p_proveedor_id::text,
    coalesce(trim(p_detalle), ''), coalesce(p_fecha_limite::text, ''),
    coalesce(p_monto_manual::text, ''), p_lineas::text));
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  select id, payload_hash into v_compra_id, v_payload_hash
  from public.compras
  where idempotency_key = v_key
  for update;
  if found then
    if v_payload_hash is distinct from v_hash then
      raise exception 'La clave de solicitud ya fue usada para otra orden.' using errcode = '23505';
    end if;
    return v_compra_id;
  end if;

  select razon_social into v_proveedor_nombre
  from public.proveedores where id = p_proveedor_id for share;
  if not found then
    raise exception 'El proveedor ya no existe. Recarga y vuelve a seleccionarlo.' using errcode = '23503';
  end if;

  if v_requiere_recepcion then
    for v_line in
      select value from jsonb_array_elements(p_lineas) order by value->>'producto_id'
    loop
      v_catalogo_id := nullif(v_line->>'producto_id', '')::uuid;
      v_cantidad := nullif(v_line->>'cantidad', '')::integer;
      v_costo := nullif(v_line->>'precio', '')::numeric;
      if v_catalogo_id is null or v_cantidad is null or v_cantidad <= 0
         or v_costo is null or v_costo < 0 or v_costo::text in ('NaN', 'Infinity', '-Infinity') then
        raise exception 'Una línea tiene artículo, cantidad o costo no válido.' using errcode = '22023';
      end if;

      select producto_id into v_producto_id
      from public.proveedor_productos
      where id = v_catalogo_id and proveedor_id = p_proveedor_id
      for share;
      if not found then
        raise exception 'Un artículo no pertenece al proveedor seleccionado.' using errcode = '23503';
      end if;
      if v_producto_id is null then
        raise exception 'Vincula el artículo del proveedor con un producto maestro antes de comprarlo.' using errcode = '23514';
      end if;
      v_subtotal := v_subtotal + (v_cantidad * v_costo);
    end loop;
  else
    if p_monto_manual is null or p_monto_manual <= 0
       or p_monto_manual::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'Indica un importe mayor que cero para el servicio o gasto.' using errcode = '22023';
    end if;
    v_subtotal := round(p_monto_manual, 2);
  end if;

  if v_subtotal <= 0 then
    raise exception 'El total de la orden debe ser mayor que cero.' using errcode = '22023';
  end if;
  v_total_cxp := round(v_subtotal * 1.18, 2);

  insert into public.compras (
    proveedor_id, proveedor_nombre, detalle, monto, estado, fecha_limite,
    estado_recepcion, requiere_recepcion, idempotency_key, payload_hash, created_by
  ) values (
    p_proveedor_id, v_proveedor_nombre, coalesce(trim(p_detalle), ''),
    round(v_subtotal, 2), 'Pendiente', p_fecha_limite,
    case when v_requiere_recepcion then 'pendiente' else 'completa' end,
    v_requiere_recepcion, v_key, v_hash, v_uid
  ) returning id, codigo into v_compra_id, v_codigo;

  for v_line in select value from jsonb_array_elements(p_lineas) loop
    v_catalogo_id := (v_line->>'producto_id')::uuid;
    v_cantidad := (v_line->>'cantidad')::integer;
    v_costo := round((v_line->>'precio')::numeric, 2);
    insert into public.detalle_compras (compra_id, proveedor_producto_id, cantidad, costo_unitario)
    values (v_compra_id, v_catalogo_id, v_cantidad, v_costo);
  end loop;

  insert into public.pagos (
    contraparte, detalle, monto, estado, tipo, compra_id,
    fecha_vencimiento, estado_cobro, created_by
  ) values (
    v_proveedor_nombre, 'Cuenta por pagar · ' || v_codigo,
    v_total_cxp, 'Pendiente', 'pagar', v_compra_id,
    p_fecha_limite, 'pendiente', v_uid
  );

  return v_compra_id;
end
$function$;

revoke all on function app_private._crear_orden_compra_operativa(uuid, text, date, numeric, jsonb, text)
  from public, anon;
grant execute on function app_private._crear_orden_compra_operativa(uuid, text, date, numeric, jsonb, text)
  to authenticated;

-- El endpoint REST vive en public como SECURITY INVOKER; la escritura privilegiada
-- queda aislada en app_private y vuelve a validar usuario/permisos dentro del RPC.
create or replace function public.crear_orden_compra_operativa(
  p_proveedor_id uuid,
  p_detalle text,
  p_fecha_limite date,
  p_monto_manual numeric,
  p_lineas jsonb,
  p_idempotency_key text
)
returns uuid
language sql
security invoker
set search_path = ''
as $wrapper$
  select app_private._crear_orden_compra_operativa(
    p_proveedor_id, p_detalle, p_fecha_limite, p_monto_manual, p_lineas, p_idempotency_key
  );
$wrapper$;

revoke all on function public.crear_orden_compra_operativa(uuid, text, date, numeric, jsonb, text)
  from public, anon;
grant execute on function public.crear_orden_compra_operativa(uuid, text, date, numeric, jsonb, text)
  to authenticated;

commit;
