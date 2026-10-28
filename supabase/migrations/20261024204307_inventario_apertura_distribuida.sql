-- Apertura de legado por producto y almacén, en una única operación atómica.
-- No adivina dónde está el stock: cada producto debe cuadrar con el legado.
begin;

create table public.aperturas_inventario (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  payload_hash text not null,
  cantidad_productos integer not null check (cantidad_productos >= 0),
  cantidad_unidades bigint not null check (cantidad_unidades >= 0),
  cantidad_asignaciones integer not null check (cantidad_asignaciones >= 0),
  realizado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.aperturas_inventario enable row level security;
revoke all on public.aperturas_inventario from public,anon;
grant select on public.aperturas_inventario to authenticated;
drop policy if exists aperturas_inventario_read on public.aperturas_inventario;
create policy aperturas_inventario_read on public.aperturas_inventario for select to authenticated
  using ((select public.tiene_permiso('inventario','ver')));

create or replace function app_private.registrar_apertura_inventario_distribuida(
  p_asignaciones jsonb,
  p_idempotency_key text
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(trim(p_idempotency_key),'');
  v_asignaciones jsonb;
  v_hash text;
  v_existente public.aperturas_inventario%rowtype;
  v_apertura uuid;
  v_producto record;
  v_line jsonb;
  v_producto_id uuid;
  v_almacen_id uuid;
  v_cantidad integer;
  v_suma bigint;
  v_producto_count integer;
  v_total bigint;
begin
  if v_uid is null or not (select public.tiene_permiso('inventario','editar')) then
    raise exception 'Se requiere permiso de edición de inventario para abrir existencias.' using errcode='42501';
  end if;
  if coalesce(jsonb_typeof(p_asignaciones),'') <> 'array' or v_key is null then
    raise exception 'Envía una asignación válida y una clave de idempotencia.' using errcode='22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'producto_id',(x.value->>'producto_id')::uuid,
    'almacen_id',(x.value->>'almacen_id')::uuid,
    'cantidad',(x.value->>'cantidad')::integer
  ) order by (x.value->>'producto_id')::uuid,(x.value->>'almacen_id')::uuid),'[]'::jsonb)
  into v_asignaciones
  from jsonb_array_elements(p_asignaciones) x(value);
  v_hash := md5(v_asignaciones::text);

  perform pg_advisory_xact_lock(hashtextextended('apertura-inventario:'||v_key,0));
  select * into v_existente from public.aperturas_inventario where idempotency_key=v_key for update;
  if found then
    if v_existente.payload_hash <> v_hash then raise exception 'La clave ya se usó con otra distribución.' using errcode='23505'; end if;
    return v_existente.id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('enterprisecloud:stock-legacy-opening',0));
  if exists(select 1 from public.aperturas_inventario) or exists(select 1 from public.inventarios) then
    raise exception 'La apertura inicial ya fue registrada y no puede repetirse.' using errcode='23514';
  end if;
  perform 1 from public.productos order by id for update;

  if exists(
    select 1 from jsonb_array_elements(v_asignaciones) x(value)
    group by x.value->>'producto_id',x.value->>'almacen_id' having count(*)>1
  ) then raise exception 'Cada producto y almacén debe aparecer una sola vez.' using errcode='22023'; end if;

  for v_line in select x.value from jsonb_array_elements(v_asignaciones) x(value) loop
    v_producto_id := (v_line->>'producto_id')::uuid;
    v_almacen_id := (v_line->>'almacen_id')::uuid;
    v_cantidad := (v_line->>'cantidad')::integer;
    if v_cantidad is null or v_cantidad <= 0 then raise exception 'Las cantidades asignadas deben ser enteros positivos.' using errcode='22023'; end if;
    if not exists(select 1 from public.productos where id=v_producto_id) then raise exception 'Un producto de la apertura no existe.' using errcode='23503'; end if;
    if not exists(select 1 from public.almacenes where id=v_almacen_id and activo) then raise exception 'Cada asignación debe usar un almacén activo.' using errcode='23503'; end if;
  end loop;

  for v_producto in select id,stock from public.productos order by id loop
    select coalesce(sum((x.value->>'cantidad')::integer),0)::bigint into v_suma
    from jsonb_array_elements(v_asignaciones) x(value)
    where (x.value->>'producto_id')::uuid=v_producto.id;
    if v_suma <> v_producto.stock then
      raise exception 'La asignación del producto % suma %, pero el stock legado es %. Ajusta la distribución antes de abrir.',v_producto.id,v_suma,v_producto.stock using errcode='23514';
    end if;
  end loop;

  select count(*)::integer,coalesce(sum(stock),0)::bigint into v_producto_count,v_total from public.productos;
  insert into public.aperturas_inventario(idempotency_key,payload_hash,cantidad_productos,cantidad_unidades,cantidad_asignaciones,realizado_por)
  values(v_key,v_hash,v_producto_count,v_total,jsonb_array_length(v_asignaciones),v_uid)
  returning id into v_apertura;

  for v_line in select x.value from jsonb_array_elements(v_asignaciones) x(value)
    order by (x.value->>'producto_id')::uuid,(x.value->>'almacen_id')::uuid loop
    v_producto_id := (v_line->>'producto_id')::uuid;
    v_almacen_id := (v_line->>'almacen_id')::uuid;
    v_cantidad := (v_line->>'cantidad')::integer;
    insert into public.inventarios(producto_id,almacen_id,cantidad)
      values(v_producto_id,v_almacen_id,v_cantidad);
    insert into public.movimientos_inventario(
      producto_id,almacen_id,tipo,cantidad,stock_anterior,stock_nuevo,referencia,usuario_id,
      idempotency_key,origen_tipo,origen_id,motivo
    ) values (
      v_producto_id,v_almacen_id,'entrada',v_cantidad,0,v_cantidad,'Apertura inicial '||v_apertura::text,v_uid,
      'apertura:'||v_key||':'||v_producto_id::text||':'||v_almacen_id::text,
      'apertura',v_apertura,'Distribución verificada del stock legado'
    );
  end loop;
  return v_apertura;
end;
$$;

revoke all on function app_private.registrar_apertura_inventario_distribuida(jsonb,text) from public,anon;
grant execute on function app_private.registrar_apertura_inventario_distribuida(jsonb,text) to authenticated;
revoke all on function app_private.inicializar_stock_legacy_a_almacen(uuid) from public,anon,authenticated;
drop function if exists public.inicializar_stock_legacy_a_almacen(uuid);

create function public.registrar_apertura_inventario(p_asignaciones jsonb,p_idempotency_key text)
returns uuid language sql security invoker set search_path = '' as $$
  select app_private.registrar_apertura_inventario_distribuida($1,$2)
$$;
revoke all on function public.registrar_apertura_inventario(jsonb,text) from public,anon;
grant execute on function public.registrar_apertura_inventario(jsonb,text) to authenticated;

commit;
