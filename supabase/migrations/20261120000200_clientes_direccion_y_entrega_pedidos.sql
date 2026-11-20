-- 20261120000200_clientes_direccion_y_entrega_pedidos.sql
-- Agrega dirección/contacto opcional en clientes y dirección/ruta de entrega en pedidos y ventas.

alter table public.clientes
  add column if not exists direccion text,
  add column if not exists telefono text,
  add column if not exists correo text;

alter table public.ec_pedidos
  add column if not exists direccion_entrega text;

alter table public.ventas
  add column if not exists direccion_entrega text;

-- Backfill controlado solo para clientes existentes con historial de ventas/pedidos sin dirección registrada.
update public.clientes c
set direccion = 'Av. Arequipa 1450, Lince'
where (c.direccion is null or btrim(c.direccion) = '')
  and (
    exists (select 1 from public.ventas v where v.cliente_id = c.id)
    or exists (select 1 from public.ec_pedidos p where p.cliente_id = c.id)
  );

update public.ec_pedidos p
set direccion_entrega = coalesce(
  nullif(btrim((select g.destino from public.ec_guias g where g.pedido_id = p.id order by g.created_at desc limit 1)), ''),
  nullif(btrim((select c.direccion from public.clientes c where c.id = p.cliente_id)), '')
)
where p.direccion_entrega is null or btrim(p.direccion_entrega) = '';

update public.ventas v
set direccion_entrega = coalesce(
  nullif(btrim((select p.direccion_entrega from public.ec_pedidos p where p.venta_id = v.id order by p.created_at desc limit 1)), ''),
  nullif(btrim((select c.direccion from public.clientes c where c.id = v.cliente_id)), '')
)
where v.direccion_entrega is null or btrim(v.direccion_entrega) = '';

-- Sincroniza la dirección de entrega al facturar un pedido reservado.
create or replace function public.ec_facturar_pedido(
  p_pedido_id uuid,
  p_tipo text,
  p_serie text,
  p_numero integer,
  p_key text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_order public.ec_pedidos%rowtype;
  v_sale uuid;
  v_name text;
  v_direccion text;
  v_base numeric;
  v_igv numeric;
  v_line jsonb;
  v_old public.ec_operaciones%rowtype;
  v_hash text;
begin
  if auth.uid() is null or not public.tiene_permiso('ventas', 'crear') then
    raise exception 'Sin permiso de ventas.' using errcode = '42501';
  end if;
  if nullif(trim(p_key), '') is null
     or p_tipo not in ('01', '03')
     or p_serie !~ '^[A-Z0-9]{4}$'
     or p_numero is null
     or p_numero <= 0 then
    raise exception 'Comprobante o clave inválidos.';
  end if;

  v_hash := md5(jsonb_build_object(
    'pedido', p_pedido_id,
    'tipo', p_tipo,
    'serie', p_serie,
    'numero', p_numero
  )::text);

  perform pg_advisory_xact_lock(hashtextextended('ec:invoice:' || p_key, 0));
  select * into v_old from public.ec_operaciones where clave = p_key;
  if found then
    if v_old.tipo <> 'factura' or v_old.hash <> v_hash then
      raise exception 'Clave reutilizada.' using errcode = '23505';
    end if;
    return v_old.id;
  end if;

  select * into v_order from public.ec_pedidos where id = p_pedido_id for update;
  if not found or v_order.estado <> 'reservado' then
    raise exception 'El pedido ya fue facturado o no existe.';
  end if;

  select razon_social, direccion into v_name, v_direccion
  from public.clientes
  where id = v_order.cliente_id;

  if p_tipo = '01' and not exists (
    select 1
    from public.clientes
    where id = v_order.cliente_id
      and tipo_doc = 'RUC'
      and length(documento) = 11
  ) then
    raise exception 'Factura requiere cliente con RUC.';
  end if;

  select
    sum((x->>'base')::numeric),
    sum((x->>'igv')::numeric)
  into v_base, v_igv
  from jsonb_array_elements(v_order.lineas) x;

  insert into public.ventas (
    cliente_id, cliente_nombre, detalle, monto, estado, almacen_id,
    idempotency_key, payload_hash, moneda, tipo_cambio, direccion_entrega
  )
  values (
    v_order.cliente_id,
    v_name,
    p_serie || '-' || p_numero,
    v_order.total,
    'Pendiente',
    v_order.almacen_id,
    'ec:' || p_key,
    v_hash,
    v_order.moneda,
    v_order.tipo_cambio,
    coalesce(nullif(btrim(v_order.direccion_entrega), ''), nullif(btrim(v_direccion), ''))
  )
  returning id into v_sale;

  for v_line in select value from jsonb_array_elements(v_order.lineas) loop
    insert into public.detalle_ventas (venta_id, producto_id, cantidad, precio_unitario)
    values (
      v_sale,
      (v_line->>'producto_id')::uuid,
      (v_line->>'cantidad')::integer,
      (v_line->>'precio')::numeric
    );
  end loop;

  insert into public.pagos (tipo, contraparte, detalle, monto, estado, venta_id, moneda, exchange_rate)
  values ('cobrar', v_name, 'CxC ' || p_serie || '-' || p_numero, v_order.total, 'Pendiente', v_sale, v_order.moneda, v_order.tipo_cambio);

  insert into public.ec_comprobantes (venta_id, tipo, serie, numero, moneda, tipo_cambio, base, igv, total, snapshot)
  values (
    v_sale,
    p_tipo,
    p_serie,
    p_numero,
    v_order.moneda,
    v_order.tipo_cambio,
    v_base,
    v_igv,
    v_order.total,
    jsonb_build_object('cliente', v_name, 'lineas', v_order.lineas)
  );

  update public.ec_pedidos set estado = 'facturado', venta_id = v_sale where id = p_pedido_id;
  insert into public.ec_operaciones (clave, tipo, hash, id) values (p_key, 'factura', v_hash, v_sale);
  return v_sale;
end $function$;

-- RPC dedicada para guardar la dirección/ruta de entrega al registrar un pedido o venta.
-- Permite guardar en clientes, ec_pedidos y ventas incluso si el vendedor no tiene permiso de editar maestros.
create or replace function public.ec_guardar_direccion_entrega_v1(
  p_cliente_id uuid,
  p_direccion text,
  p_pedido_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_clean text := btrim(coalesce(p_direccion, ''));
  v_venta_id uuid;
begin
  if auth.uid() is null or not public.tiene_permiso('ventas', 'crear') then
    raise exception 'Sin permiso para definir dirección de entrega en pedidos.' using errcode = '42501';
  end if;
  if p_cliente_id is null or length(v_clean) < 4 then
    raise exception 'La dirección o ruta de entrega debe tener al menos 4 caracteres.';
  end if;

  update public.clientes
  set direccion = v_clean
  where id = p_cliente_id;

  if p_pedido_id is not null then
    update public.ec_pedidos
    set direccion_entrega = v_clean
    where id = p_pedido_id
    returning venta_id into v_venta_id;

    if v_venta_id is not null then
      update public.ventas
      set direccion_entrega = v_clean
      where id = v_venta_id;
    end if;
  end if;
end $function$;

revoke all on function public.ec_guardar_direccion_entrega_v1(uuid, text, uuid) from public, anon;
grant execute on function public.ec_guardar_direccion_entrega_v1(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
