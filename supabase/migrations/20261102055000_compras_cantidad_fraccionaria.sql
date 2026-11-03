-- Cierre del fraccionado end-to-end del ciclo de compras del Modelo B.
-- La cantidad pedida (requisición) y cotizada (oferta) ya es numeric(14,3);
-- la orden de compra (detalle_compras) sigue siendo integer, con lo cual
-- _crear_orden_compra_operativa fallaba al parsear '3.250'.
--   1. detalle_compras.cantidad -> numeric(14,3), reconstruyendo la columna generada subtotal.
--   2. _crear_orden_compra_operativa / _v2 / _editar_orden_compra_operativa_v1
--      parsean y validan cantidades fraccionarias con el mismo techo que las reincidenciales.
-- La recepción y el stock siguen en enteros (movimientos_inventario/printeo entero);
-- sus comparaciones contra cantidades de compra son seguras por coerción de Postgres.
begin;

-- 1) detalle_compras.cantidad -> numeric(14,3). subtotal es generada sobre cantidad;
--    se reconstruye. Las filas existentes (enteras) pierden nada al ampliar el tipo.
-- Estos dos triggers referencian 'cantidad' en su cláusula OF: se retiran y se recrean igual.
drop trigger if exists trg_snapshot_fiscal_detalle_compra on public.detalle_compras;
drop trigger if exists trg_sincronizar_monto_compra_lineas on public.detalle_compras;

alter table public.detalle_compras drop column if exists subtotal;
alter table public.detalle_compras alter column cantidad type numeric(14,3);
alter table public.detalle_compras
  add column subtotal numeric(14,2) generated always as ((cantidad)::numeric * costo_unitario) stored;

create trigger trg_sincronizar_monto_compra_lineas
  after insert or delete or update of cantidad, costo_unitario, tratamiento_tributario,
  tasa_tributaria, base_imponible, impuesto, total_linea
  on public.detalle_compras
  for each row execute function app_private._sincronizar_monto_compra_desde_lineas_v1();

create trigger trg_snapshot_fiscal_detalle_compra
  before insert or update of cantidad, costo_unitario, tratamiento_tributario,
  tasa_tributaria, base_imponible, impuesto, total_linea
  on public.detalle_compras
  for each row execute function app_private._snapshot_fiscal_detalle_compra_v1();

-- 2) Orden operativa (líneas confirmadas): cantidad fraccionaria.
create or replace function app_private._crear_orden_compra_operativa(
  p_proveedor_id uuid, p_detalle text, p_fecha_limite date, p_monto_manual numeric,
  p_lineas jsonb, p_idempotency_key text)
returns uuid
language plpgsql security definer set search_path = ''
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
  v_cantidad numeric(14,3);
  v_costo numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_igv_total numeric(14,2) := 0;
  v_total_cxp numeric(14,2);
  v_requiere_recepcion boolean;
  v_tratamiento text;
  v_tasa numeric(5,2);
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
      v_cantidad := nullif(v_line->>'cantidad', '')::numeric;
      v_costo := nullif(v_line->>'precio', '')::numeric;
      if v_catalogo_id is null or v_cantidad is null or v_cantidad <= 0
         or v_cantidad <> round(v_cantidad, 3) or v_cantidad > 99999999999.999
         or v_costo is null or v_costo < 0 or v_costo::text in ('NaN', 'Infinity', '-Infinity') then
        raise exception 'Una línea tiene artículo, cantidad o costo no válido.' using errcode = '22023';
      end if;

      v_tratamiento := coalesce(nullif(btrim(v_line->>'tratamiento_fiscal'), ''), 'gravado');
      if v_tratamiento not in ('gravado', 'exonerado', 'inafecto') then
        raise exception 'El tratamiento fiscal de una línea no es válido.' using errcode = '22023';
      end if;
      if v_tratamiento in ('exonerado', 'inafecto') then
        -- El servidor decide la tasa: exonerado e inafecto no llevan IGV.
        v_tasa := 0;
      else
        begin
          v_tasa := nullif(btrim(coalesce(v_line->>'tasa_igv', '')), '')::numeric;
        exception
          when invalid_text_representation then
            raise exception 'La tasa de IGV de una línea no es un número entre 0 y 100.' using errcode = '22023';
        end;
        if v_tasa is null then
          v_tasa := 18;
        end if;
        if v_tasa::text in ('NaN', 'Infinity', '-Infinity') or v_tasa < 0 or v_tasa > 100 then
          raise exception 'La tasa de IGV debe estar entre 0 y 100.' using errcode = '22023';
        end if;
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
      if v_tasa > 0 then
        v_igv_total := v_igv_total + (v_cantidad * v_costo * v_tasa / 100);
      end if;
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
  -- Gravado uniforme al 18% reproduce el cálculo anterior: round(subtotal * 1.18).
  v_total_cxp := case
    when v_requiere_recepcion then round(v_subtotal + v_igv_total, 2)
    else round(v_subtotal * 1.18, 2)
  end;
  if v_total_cxp <= 0 then
    raise exception 'El total de la orden debe ser mayor que cero.' using errcode = '22023';
  end if;

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
    v_cantidad := round((v_line->>'cantidad')::numeric, 3);
    v_costo := round((v_line->>'precio')::numeric, 2);
    v_tratamiento := coalesce(nullif(btrim(v_line->>'tratamiento_fiscal'), ''), 'gravado');
    if v_tratamiento not in ('gravado', 'exonerado', 'inafecto') then
      raise exception 'El tratamiento fiscal de una línea no es válido.' using errcode = '22023';
    end if;
    if v_tratamiento in ('exonerado', 'inafecto') then
      v_tasa := 0;
    else
      begin
        v_tasa := nullif(btrim(coalesce(v_line->>'tasa_igv', '')), '')::numeric;
      exception
        when invalid_text_representation then
          raise exception 'La tasa de IGV de una línea no es un número entre 0 y 100.' using errcode = '22023';
      end;
      if v_tasa is null then
        v_tasa := 18;
      end if;
      if v_tasa::text in ('NaN', 'Infinity', '-Infinity') or v_tasa < 0 or v_tasa > 100 then
        raise exception 'La tasa de IGV debe estar entre 0 y 100.' using errcode = '22023';
      end if;
    end if;

    insert into public.detalle_compras
      (compra_id, proveedor_producto_id, cantidad, costo_unitario, tratamiento_fiscal, tasa_igv)
    values (v_compra_id, v_catalogo_id, v_cantidad, v_costo, v_tratamiento, round(v_tasa, 2));
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

-- 3) Orden operativa con soporte multi-moneda (la que exponen los wrappers v3/v4).
create or replace function app_private._crear_orden_compra_operativa_v2(
  p_proveedor_id uuid, p_detalle text, p_fecha_limite date, p_monto_manual numeric,
  p_lineas jsonb, p_idempotency_key text)
returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(trim(p_idempotency_key), '');
  v_hash text;
  v_compra_id uuid;
  v_payload_hash text;
  v_proveedor_nombre text;
  v_line jsonb;
  v_catalogo_id uuid;
  v_producto_id uuid;
  v_cantidad numeric(14,3);
  v_costo numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_requiere_recepcion boolean;
begin
  if v_uid is null or not (select public.tiene_permiso('compras', 'crear')) then
    raise exception 'Se requiere permiso para crear compras.' using errcode = '42501';
  end if;
  if v_key is null or p_proveedor_id is null then
    raise exception 'Falta la clave de idempotencia o el proveedor.' using errcode = '22023';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'Las líneas de compra deben enviarse como una lista.' using errcode = '22023';
  end if;
  v_requiere_recepcion := jsonb_array_length(p_lineas) > 0;
  if v_requiere_recepcion and (select count(*) from (
        select value->>'producto_id' from jsonb_array_elements(p_lineas)
        group by value->>'producto_id') x) <> jsonb_array_length(p_lineas) then
    raise exception 'Un artículo solo puede aparecer una vez en la orden.' using errcode = '22023';
  end if;
  v_hash := md5(concat_ws('|', p_proveedor_id::text, coalesce(trim(p_detalle), ''),
    coalesce(p_fecha_limite::text, ''), coalesce(p_monto_manual::text, ''), p_lineas::text));
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  select id, payload_hash into v_compra_id, v_payload_hash
  from public.compras where idempotency_key = v_key for update;
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
    for v_line in select value from jsonb_array_elements(p_lineas) order by value->>'producto_id' loop
      v_catalogo_id := nullif(v_line->>'producto_id', '')::uuid;
      v_cantidad := nullif(v_line->>'cantidad', '')::numeric;
      v_costo := nullif(v_line->>'precio', '')::numeric;
      if v_catalogo_id is null or v_cantidad is null or v_cantidad <= 0
         or v_cantidad <> round(v_cantidad, 3) or v_cantidad > 99999999999.999
         or v_costo is null or v_costo < 0 or v_costo::text in ('NaN', 'Infinity', '-Infinity') then
        raise exception 'Una línea tiene artículo, cantidad o costo no válido.' using errcode = '22023';
      end if;
      select producto_id into v_producto_id
      from public.proveedor_productos where id = v_catalogo_id and proveedor_id = p_proveedor_id for share;
      if not found then
        raise exception 'Un artículo no pertenece al proveedor seleccionado.' using errcode = '23503';
      end if;
      if v_producto_id is null then
        raise exception 'Vincula el artículo del proveedor con un producto maestro antes de comprarlo.' using errcode = '23514';
      end if;
      v_subtotal := v_subtotal + v_cantidad * v_costo;
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
  insert into public.compras(proveedor_id, proveedor_nombre, detalle, monto, estado, fecha_limite,
    estado_recepcion, requiere_recepcion, idempotency_key, payload_hash, created_by)
  values(p_proveedor_id, v_proveedor_nombre, coalesce(trim(p_detalle), ''), round(v_subtotal, 2),
    'Pendiente', p_fecha_limite,
    case when v_requiere_recepcion then 'pendiente' else 'completa' end,
    v_requiere_recepcion, v_key, v_hash, v_uid)
  returning id into v_compra_id;
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    insert into public.detalle_compras(compra_id, proveedor_producto_id, cantidad, costo_unitario)
    values(v_compra_id, (v_line->>'producto_id')::uuid, round((v_line->>'cantidad')::numeric, 3),
      round((v_line->>'precio')::numeric, 2));
  end loop;
  -- Intencionalmente no crea pagos/CxP. La obligación nace en recepción.
  return v_compra_id;
end
$function$;

-- 4) Edición de órdenes con líneas: misma tolerancia fraccional.
create or replace function app_private._editar_orden_compra_operativa_v1(
  p_compra_id uuid, p_expected_updated_at timestamp with time zone, p_proveedor_id uuid,
  p_detalle text, p_fecha_limite date, p_comprobante_tipo text, p_comprobante_numero text,
  p_lineas jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_compra public.compras%rowtype;
  v_line jsonb;
  v_line_id uuid;
  v_catalogo_id uuid;
  v_qty numeric(14,3);
  v_cost numeric(14,2);
  v_total numeric(14,2) := 0;
  v_proveedor_nombre text;
  v_count integer;
begin
  if v_uid is null or not (select public.tiene_permiso('compras', 'editar')) then
    raise exception 'Se requiere permiso para editar compras.' using errcode = '42501';
  end if;
  if p_compra_id is null or p_expected_updated_at is null or p_proveedor_id is null
     or p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'La solicitud de edición está incompleta o no es válida.' using errcode = '22023';
  end if;

  select * into v_compra from public.compras where id = p_compra_id for update;
  if not found then
    raise exception 'La orden no existe.' using errcode = '23503';
  end if;
  if v_compra.updated_at is distinct from p_expected_updated_at then
    raise exception 'La orden cambió desde que la abriste. Recarga antes de guardar.' using errcode = '40001';
  end if;
  if exists(select 1 from public.recepciones_compra where compra_id = p_compra_id) then
    raise exception 'La orden ya tiene una recepción. No se pueden editar sus líneas; registra una recepción adicional o devolución.' using errcode = '23514';
  end if;
  if v_compra.estado::text in ('Cancelada', 'Rechazada', 'Pagada') then
    raise exception 'No se puede editar una orden cancelada, rechazada o pagada.' using errcode = '23514';
  end if;

  select razon_social into v_proveedor_nombre
  from public.proveedores where id = p_proveedor_id for share;
  if not found then
    raise exception 'El proveedor ya no existe.' using errcode = '23503';
  end if;
  if (select count(*) from (
        select value->>'producto_id' from jsonb_array_elements(p_lineas)
        group by value->>'producto_id') x) <> jsonb_array_length(p_lineas) then
    raise exception 'Un artículo solo puede aparecer una vez en la orden.' using errcode = '22023';
  end if;

  -- Valida todo antes de persistir. Cualquier error revierte cabecera y líneas.
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    v_line_id := nullif(v_line->>'detalle_compra_id', '')::uuid;
    v_catalogo_id := nullif(v_line->>'producto_id', '')::uuid;
    v_qty := nullif(v_line->>'cantidad', '')::numeric;
    v_cost := nullif(v_line->>'precio', '')::numeric;
    if v_catalogo_id is null or v_qty is null or v_qty <= 0
       or v_qty <> round(v_qty, 3) or v_qty > 99999999999.999
       or v_cost is null or v_cost < 0
       or v_cost::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'Una línea tiene artículo, cantidad o costo no válido.' using errcode = '22023';
    end if;
    if not exists(select 1 from public.proveedor_productos
                  where id = v_catalogo_id and proveedor_id = p_proveedor_id and producto_id is not null) then
      raise exception 'Un artículo no pertenece al proveedor o no está vinculado al inventario.' using errcode = '23503';
    end if;
    if v_line_id is not null and not exists(
        select 1 from public.detalle_compras where id = v_line_id and compra_id = p_compra_id) then
      raise exception 'Una línea no pertenece a esta orden.' using errcode = '23503';
    end if;
    v_total := v_total + v_qty * v_cost;
  end loop;
  if jsonb_array_length(p_lineas) > 0 and v_total <= 0 then
    raise exception 'El total de las líneas debe ser mayor que cero.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lineas) = 0 and coalesce(v_compra.monto, 0) <= 0 then
    raise exception 'La orden debe conservar un importe mayor que cero.' using errcode = '22023';
  end if;

  update public.compras set proveedor_id = p_proveedor_id, proveedor_nombre = v_proveedor_nombre,
    detalle = coalesce(trim(p_detalle), ''),
    monto = case when jsonb_array_length(p_lineas) > 0 then round(v_total, 2) else monto end,
    fecha_limite = p_fecha_limite,
    comprobante_tipo = nullif(trim(p_comprobante_tipo), ''),
    comprobante_numero = nullif(trim(p_comprobante_numero), ''),
    updated_at = clock_timestamp()
  where id = p_compra_id returning * into v_compra;

  -- Reemplaza el conjunto solo en esta transacción; ninguna línea recibida existe aquí.
  delete from public.detalle_compras where compra_id = p_compra_id;
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    v_catalogo_id := (v_line->>'producto_id')::uuid;
    v_qty := round((v_line->>'cantidad')::numeric, 3);
    v_cost := round((v_line->>'precio')::numeric, 2);
    insert into public.detalle_compras(compra_id, proveedor_producto_id, cantidad, costo_unitario)
    values(p_compra_id, v_catalogo_id, v_qty, v_cost);
  end loop;

  return jsonb_build_object('compra_id', v_compra.id, 'codigo', v_compra.codigo,
    'updated_at', v_compra.updated_at, 'version', 1, 'monto', v_compra.monto);
end
$function$;

commit;
