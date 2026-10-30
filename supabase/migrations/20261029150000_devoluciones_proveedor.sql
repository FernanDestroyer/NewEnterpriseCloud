-- Devoluciones físicas de compras: descuenta stock y registra Kardex.
-- No modifica la cuenta por pagar; créditos del proveedor se concilian en Tesorería.
begin;

create table if not exists public.devoluciones_compra (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('DCP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  compra_id uuid not null references public.compras(id) on delete restrict,
  motivo text not null check (length(trim(motivo)) between 3 and 1000),
  idempotency_key text not null unique,
  payload_hash text not null,
  created_by uuid not null default auth.uid() references public.usuarios(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.detalle_devoluciones_compra (
  id uuid primary key default gen_random_uuid(),
  devolucion_id uuid not null references public.devoluciones_compra(id) on delete restrict,
  detalle_recepcion_id uuid not null references public.detalle_recepciones_compra(id) on delete restrict,
  producto_id uuid not null references public.productos(id) on delete restrict,
  almacen_id uuid not null references public.almacenes(id) on delete restrict,
  cantidad integer not null check (cantidad > 0),
  costo_unitario numeric(14,2) not null check (costo_unitario >= 0),
  created_at timestamptz not null default now(),
  unique (devolucion_id, detalle_recepcion_id)
);

create index if not exists devoluciones_compra_compra_fecha_idx
  on public.devoluciones_compra (compra_id, created_at desc);
create index if not exists detalle_devoluciones_compra_recepcion_idx
  on public.detalle_devoluciones_compra (detalle_recepcion_id);

alter table public.devoluciones_compra enable row level security;
alter table public.detalle_devoluciones_compra enable row level security;
grant select, insert, update, delete on public.devoluciones_compra to authenticated;
grant select, insert, update, delete on public.detalle_devoluciones_compra to authenticated;

drop policy if exists devoluciones_compra_select on public.devoluciones_compra;
create policy devoluciones_compra_select on public.devoluciones_compra for select to authenticated
  using ((select app_private._tiene_permiso('compras', 'ver')));
drop policy if exists devoluciones_compra_insert on public.devoluciones_compra;
create policy devoluciones_compra_insert on public.devoluciones_compra for insert to authenticated
  with check ((select app_private._tiene_permiso('compras', 'editar')) and created_by = (select auth.uid()));
drop policy if exists devoluciones_compra_update on public.devoluciones_compra;
create policy devoluciones_compra_update on public.devoluciones_compra for update to authenticated
  using (false) with check (false);
drop policy if exists devoluciones_compra_delete on public.devoluciones_compra;
create policy devoluciones_compra_delete on public.devoluciones_compra for delete to authenticated
  using (false);

drop policy if exists detalle_devoluciones_compra_select on public.detalle_devoluciones_compra;
create policy detalle_devoluciones_compra_select on public.detalle_devoluciones_compra for select to authenticated
  using ((select app_private._tiene_permiso('compras', 'ver')));
drop policy if exists detalle_devoluciones_compra_insert on public.detalle_devoluciones_compra;
create policy detalle_devoluciones_compra_insert on public.detalle_devoluciones_compra for insert to authenticated
  with check ((select app_private._tiene_permiso('compras', 'editar')));
drop policy if exists detalle_devoluciones_compra_update on public.detalle_devoluciones_compra;
create policy detalle_devoluciones_compra_update on public.detalle_devoluciones_compra for update to authenticated
  using (false) with check (false);
drop policy if exists detalle_devoluciones_compra_delete on public.detalle_devoluciones_compra;
create policy detalle_devoluciones_compra_delete on public.detalle_devoluciones_compra for delete to authenticated
  using (false);

create or replace function public.registrar_devolucion_compra(
  p_compra_id uuid,
  p_motivo text,
  p_lineas jsonb,
  p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid := (select auth.uid());
  v_hash text;
  v_id uuid;
  v_old public.devoluciones_compra%rowtype;
  v_line jsonb;
  v_detalle uuid;
  v_cantidad integer;
  v_recibido integer;
  v_devuelto integer;
  v_producto uuid;
  v_almacen uuid;
  v_costo numeric(14,2);
begin
  if v_uid is null
    or not (select app_private._tiene_permiso('compras', 'editar'))
    or not ((select app_private._tiene_permiso('inventario', 'crear'))
         or (select app_private._tiene_permiso('inventario', 'editar'))) then
    raise exception 'Se requiere permiso de edición de Compras y de Inventario.' using errcode = '42501';
  end if;
  if nullif(trim(p_motivo), '') is null or length(trim(p_motivo)) > 1000
    or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0
    or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'La devolución requiere motivo, líneas y clave de idempotencia.' using errcode = '22023';
  end if;
  if (select count(*) from (select value->>'detalle_recepcion_id' from jsonb_array_elements(p_lineas) group by value->>'detalle_recepcion_id') x)
      <> jsonb_array_length(p_lineas) then
    raise exception 'Una línea de recepción solo puede aparecer una vez en la devolución.' using errcode = '22023';
  end if;
  v_hash := md5(concat_ws('|', p_compra_id, trim(p_motivo), p_lineas::text));
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
  select * into v_old from public.devoluciones_compra where idempotency_key = p_idempotency_key;
  if found then
    if v_old.payload_hash <> v_hash then raise exception 'La clave ya fue usada con otros datos.' using errcode = '23505'; end if;
    return v_old.id;
  end if;

  perform 1 from public.compras where id = p_compra_id for update;
  if not found then raise exception 'La orden de compra no existe.' using errcode = '23503'; end if;
  insert into public.devoluciones_compra (compra_id, motivo, idempotency_key, payload_hash, created_by)
    values (p_compra_id, trim(p_motivo), p_idempotency_key, v_hash, v_uid)
    returning id into v_id;

  for v_line in select value from jsonb_array_elements(p_lineas) order by value->>'detalle_recepcion_id' loop
    v_detalle := (v_line->>'detalle_recepcion_id')::uuid;
    v_cantidad := (v_line->>'cantidad')::integer;
    if v_cantidad is null or v_cantidad <= 0 then raise exception 'La cantidad devuelta debe ser mayor que cero.' using errcode = '22023'; end if;
    select dr.producto_id, r.almacen_id, dr.costo_unitario, dr.cantidad
      into v_producto, v_almacen, v_costo, v_recibido
    from public.detalle_recepciones_compra dr
    join public.recepciones_compra r on r.id = dr.recepcion_id
    where dr.id = v_detalle and r.compra_id = p_compra_id
    for update of dr;
    if not found then raise exception 'La línea no pertenece a una recepción de esta compra.' using errcode = '23503'; end if;
    select coalesce(sum(d.cantidad), 0)::integer into v_devuelto
      from public.detalle_devoluciones_compra d
      join public.devoluciones_compra h on h.id = d.devolucion_id
      where d.detalle_recepcion_id = v_detalle and h.id <> v_id;
    if v_devuelto + v_cantidad > v_recibido then
      raise exception 'La devolución excede la cantidad recibida que queda disponible.' using errcode = '23514';
    end if;
    insert into public.detalle_devoluciones_compra
      (devolucion_id, detalle_recepcion_id, producto_id, almacen_id, cantidad, costo_unitario)
      values (v_id, v_detalle, v_producto, v_almacen, v_cantidad, v_costo);
    perform public.registrar_movimiento_inventario(
      v_producto, v_almacen, 'salida', v_cantidad,
      'Devolución a proveedor ' || v_id::text,
      p_idempotency_key || ':' || v_detalle::text,
      'devolucion_compra', v_id, trim(p_motivo)
    );
  end loop;
  return v_id;
end
$function$;

revoke all on function public.registrar_devolucion_compra(uuid, text, jsonb, text) from public, anon;
grant execute on function public.registrar_devolucion_compra(uuid, text, jsonb, text) to authenticated;

do $audit$
declare v_table text;
begin
  foreach v_table in array array['devoluciones_compra','detalle_devoluciones_compra'] loop
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
