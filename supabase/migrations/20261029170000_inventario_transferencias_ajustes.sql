-- Transferencias y ajustes manuales con bloqueo de saldos, RLS y trazabilidad.
begin;

create table if not exists public.transferencias_inventario (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('TRF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  almacen_origen_id uuid not null references public.almacenes(id) on delete restrict,
  almacen_destino_id uuid not null references public.almacenes(id) on delete restrict,
  motivo text not null check (length(trim(motivo)) between 3 and 1000),
  idempotency_key text not null unique,
  payload_hash text not null,
  created_by uuid not null default auth.uid() references public.usuarios(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (almacen_origen_id <> almacen_destino_id)
);

create table if not exists public.detalle_transferencias_inventario (
  id uuid primary key default gen_random_uuid(),
  transferencia_id uuid not null references public.transferencias_inventario(id) on delete restrict,
  producto_id uuid not null references public.productos(id) on delete restrict,
  cantidad integer not null check (cantidad > 0),
  created_at timestamptz not null default now(),
  unique (transferencia_id, producto_id)
);

create table if not exists public.ajustes_inventario (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('AJU-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  producto_id uuid not null references public.productos(id) on delete restrict,
  almacen_id uuid not null references public.almacenes(id) on delete restrict,
  stock_anterior integer not null check (stock_anterior >= 0),
  stock_nuevo integer not null check (stock_nuevo >= 0),
  motivo text not null check (length(trim(motivo)) between 3 and 1000),
  idempotency_key text not null unique,
  payload_hash text not null,
  created_by uuid not null default auth.uid() references public.usuarios(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (stock_anterior <> stock_nuevo)
);

create index if not exists transferencias_inventario_fecha_idx on public.transferencias_inventario(created_at desc);
create index if not exists detalle_transferencias_producto_idx on public.detalle_transferencias_inventario(producto_id, transferencia_id);
create index if not exists ajustes_inventario_producto_fecha_idx on public.ajustes_inventario(producto_id, almacen_id, created_at desc);

alter table public.transferencias_inventario enable row level security;
alter table public.detalle_transferencias_inventario enable row level security;
alter table public.ajustes_inventario enable row level security;
grant select, insert, update, delete on public.transferencias_inventario to authenticated;
grant select, insert, update, delete on public.detalle_transferencias_inventario to authenticated;
grant select, insert, update, delete on public.ajustes_inventario to authenticated;

drop policy if exists transferencias_inventario_select on public.transferencias_inventario;
create policy transferencias_inventario_select on public.transferencias_inventario for select to authenticated
  using ((select app_private._tiene_permiso('inventario', 'ver')));
drop policy if exists transferencias_inventario_insert on public.transferencias_inventario;
create policy transferencias_inventario_insert on public.transferencias_inventario for insert to authenticated
  with check ((select app_private._tiene_permiso('inventario', 'editar')) and created_by = (select auth.uid()));
drop policy if exists transferencias_inventario_update on public.transferencias_inventario;
create policy transferencias_inventario_update on public.transferencias_inventario for update to authenticated using (false) with check (false);
drop policy if exists transferencias_inventario_delete on public.transferencias_inventario;
create policy transferencias_inventario_delete on public.transferencias_inventario for delete to authenticated using (false);

drop policy if exists detalle_transferencias_inventario_select on public.detalle_transferencias_inventario;
create policy detalle_transferencias_inventario_select on public.detalle_transferencias_inventario for select to authenticated
  using ((select app_private._tiene_permiso('inventario', 'ver')));
drop policy if exists detalle_transferencias_inventario_insert on public.detalle_transferencias_inventario;
create policy detalle_transferencias_inventario_insert on public.detalle_transferencias_inventario for insert to authenticated
  with check ((select app_private._tiene_permiso('inventario', 'editar')));
drop policy if exists detalle_transferencias_inventario_update on public.detalle_transferencias_inventario;
create policy detalle_transferencias_inventario_update on public.detalle_transferencias_inventario for update to authenticated using (false) with check (false);
drop policy if exists detalle_transferencias_inventario_delete on public.detalle_transferencias_inventario;
create policy detalle_transferencias_inventario_delete on public.detalle_transferencias_inventario for delete to authenticated using (false);

drop policy if exists ajustes_inventario_select on public.ajustes_inventario;
create policy ajustes_inventario_select on public.ajustes_inventario for select to authenticated
  using ((select app_private._tiene_permiso('inventario', 'ver')));
drop policy if exists ajustes_inventario_insert on public.ajustes_inventario;
create policy ajustes_inventario_insert on public.ajustes_inventario for insert to authenticated
  with check ((select app_private._tiene_permiso('inventario', 'editar')) and created_by = (select auth.uid()));
drop policy if exists ajustes_inventario_update on public.ajustes_inventario;
create policy ajustes_inventario_update on public.ajustes_inventario for update to authenticated using (false) with check (false);
drop policy if exists ajustes_inventario_delete on public.ajustes_inventario;
create policy ajustes_inventario_delete on public.ajustes_inventario for delete to authenticated using (false);

create or replace function public.transferir_stock_entre_almacenes(
  p_almacen_origen_id uuid,
  p_almacen_destino_id uuid,
  p_lineas jsonb,
  p_motivo text,
  p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_hash text;
  v_old public.transferencias_inventario%rowtype;
  v_line jsonb;
  v_producto uuid;
  v_cantidad integer;
begin
  if v_uid is null or not ((select app_private._tiene_permiso('inventario', 'crear')) or (select app_private._tiene_permiso('inventario', 'editar'))) then
    raise exception 'No tienes permiso para transferir inventario.' using errcode = '42501';
  end if;
  if p_almacen_origen_id is null or p_almacen_destino_id is null or p_almacen_origen_id = p_almacen_destino_id
    or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0
    or nullif(trim(p_motivo), '') is null or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'Indica almacenes distintos, motivo, líneas y clave de idempotencia.' using errcode = '22023';
  end if;
  if (select count(*) from (select value->>'producto_id' from jsonb_array_elements(p_lineas) group by value->>'producto_id') x) <> jsonb_array_length(p_lineas) then
    raise exception 'Cada producto solo puede aparecer una vez por transferencia.' using errcode = '22023';
  end if;
  v_hash := md5(concat_ws('|', p_almacen_origen_id, p_almacen_destino_id, p_lineas::text, trim(p_motivo)));
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
  select * into v_old from public.transferencias_inventario where idempotency_key = p_idempotency_key;
  if found then
    if v_old.payload_hash <> v_hash then raise exception 'La clave ya se usó con otros datos.' using errcode = '23505'; end if;
    return v_old.id;
  end if;
  if not exists (select 1 from public.almacenes where id = p_almacen_origen_id and activo)
    or not exists (select 1 from public.almacenes where id = p_almacen_destino_id and activo) then
    raise exception 'Ambos almacenes deben estar activos.' using errcode = '23503';
  end if;
  insert into public.transferencias_inventario
    (almacen_origen_id, almacen_destino_id, motivo, idempotency_key, payload_hash, created_by)
  values (p_almacen_origen_id, p_almacen_destino_id, trim(p_motivo), p_idempotency_key, v_hash, v_uid)
  returning id into v_id;

  for v_line in select value from jsonb_array_elements(p_lineas) order by value->>'producto_id' loop
    v_producto := (v_line->>'producto_id')::uuid;
    v_cantidad := (v_line->>'cantidad')::integer;
    if v_cantidad is null or v_cantidad <= 0 then raise exception 'Las cantidades deben ser enteros positivos.' using errcode = '22023'; end if;
    insert into public.detalle_transferencias_inventario (transferencia_id, producto_id, cantidad)
      values (v_id, v_producto, v_cantidad);
    perform public.registrar_movimiento_inventario(
      v_producto, p_almacen_origen_id, 'salida', v_cantidad,
      'Transferencia ' || v_id::text || ' · salida', p_idempotency_key || ':' || v_producto::text || ':salida',
      'transferencia', v_id, trim(p_motivo)
    );
    perform public.registrar_movimiento_inventario(
      v_producto, p_almacen_destino_id, 'entrada', v_cantidad,
      'Transferencia ' || v_id::text || ' · entrada', p_idempotency_key || ':' || v_producto::text || ':entrada',
      'transferencia', v_id, trim(p_motivo)
    );
  end loop;
  return v_id;
end
$function$;

create or replace function public.ec_registrar_ajuste_inventario(
  p_producto_id uuid,
  p_almacen_id uuid,
  p_stock_nuevo integer,
  p_motivo text,
  p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_hash text;
  v_old public.ajustes_inventario%rowtype;
  v_stock integer;
  v_tipo text;
  v_delta integer;
  v_mov_id uuid;
begin
  if v_uid is null or not ((select app_private._tiene_permiso('inventario', 'crear')) or (select app_private._tiene_permiso('inventario', 'editar'))) then
    raise exception 'No tienes permiso para ajustar inventario.' using errcode = '42501';
  end if;
  if p_producto_id is null or p_almacen_id is null or p_stock_nuevo is null or p_stock_nuevo < 0
    or nullif(trim(p_motivo), '') is null or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'Producto, almacén, stock no negativo, motivo y clave son obligatorios.' using errcode = '22023';
  end if;
  v_hash := md5(concat_ws('|', p_producto_id, p_almacen_id, p_stock_nuevo, trim(p_motivo)));
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
  select * into v_old from public.ajustes_inventario where idempotency_key = p_idempotency_key;
  if found then
    if v_old.payload_hash <> v_hash then raise exception 'La clave ya se usó con otros datos.' using errcode = '23505'; end if;
    return v_old.id;
  end if;
  if not exists (select 1 from public.productos where id = p_producto_id) then raise exception 'El producto no existe.' using errcode = '23503'; end if;
  if not exists (select 1 from public.almacenes where id = p_almacen_id and activo) then raise exception 'El almacén debe estar activo.' using errcode = '23503'; end if;
  insert into public.inventarios (producto_id, almacen_id, cantidad)
    values (p_producto_id, p_almacen_id, 0) on conflict (producto_id, almacen_id) do nothing;
  select cantidad into v_stock from public.inventarios
    where producto_id = p_producto_id and almacen_id = p_almacen_id for update;
  if v_stock = p_stock_nuevo then raise exception 'El stock indicado coincide con el saldo actual; no hay ajuste que registrar.' using errcode = '22023'; end if;
  insert into public.ajustes_inventario
    (producto_id, almacen_id, stock_anterior, stock_nuevo, motivo, idempotency_key, payload_hash, created_by)
  values (p_producto_id, p_almacen_id, v_stock, p_stock_nuevo, trim(p_motivo), p_idempotency_key, v_hash, v_uid)
  returning id into v_id;
  v_delta := abs(p_stock_nuevo - v_stock);
  update public.inventarios set cantidad = p_stock_nuevo, updated_at = now()
    where producto_id = p_producto_id and almacen_id = p_almacen_id;
  insert into public.movimientos_inventario
    (producto_id, almacen_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia, usuario_id,
     idempotency_key, origen_tipo, origen_id, motivo)
  values
    (p_producto_id, p_almacen_id, 'ajuste', v_delta, v_stock, p_stock_nuevo,
     'Ajuste ' || v_id::text, v_uid, p_idempotency_key, 'ajuste_inventario', v_id, trim(p_motivo))
  returning id into v_mov_id;
  perform set_config('app.ec_inventory_rpc', 'on', true);
  update public.productos p
    set stock = (select coalesce(sum(i.cantidad), 0)::integer from public.inventarios i where i.producto_id = p.id)
    where p.id = p_producto_id;
  return v_id;
end
$function$;

revoke all on function public.transferir_stock_entre_almacenes(uuid, uuid, jsonb, text, text) from public, anon;
revoke all on function public.ec_registrar_ajuste_inventario(uuid, uuid, integer, text, text) from public, anon;
grant execute on function public.transferir_stock_entre_almacenes(uuid, uuid, jsonb, text, text) to authenticated;
grant execute on function public.ec_registrar_ajuste_inventario(uuid, uuid, integer, text, text) to authenticated;

do $audit$
declare v_table text;
begin
  foreach v_table in array array['transferencias_inventario','detalle_transferencias_inventario','ajustes_inventario'] loop
    if to_regprocedure('public.fn_auditar()') is not null and not exists (
      select 1 from pg_trigger t where t.tgrelid = to_regclass(format('public.%I', v_table))
        and t.tgfoid = 'public.fn_auditar()'::regprocedure and not t.tgisinternal
    ) then
      execute format('create trigger trg_auditoria after insert or update or delete on public.%I for each row execute function public.fn_auditar()', v_table);
    end if;
  end loop;
end
$audit$;

commit;
