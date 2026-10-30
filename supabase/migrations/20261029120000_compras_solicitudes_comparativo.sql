-- Compras: requisiciones internas y comparativo de ofertas.
-- No genera órdenes, cuentas por pagar ni movimientos de inventario.
-- Los importes se capturan en PEN antes de impuestos; el flujo existente de
-- órdenes conserva la responsabilidad de IGV/recepción hasta definir reglas fiscales.

begin;

create table if not exists public.solicitudes_compra (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('REQ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  solicitante_id uuid not null references public.usuarios(id) on delete restrict default auth.uid(),
  estado text not null default 'Borrador'
    check (estado in ('Borrador', 'Abierta', 'Cerrada', 'Cancelada')),
  fecha_necesidad date,
  detalle text not null default '',
  moneda char(3) not null default 'PEN' check (moneda = 'PEN'),
  seleccion_oferta_id uuid,
  created_by uuid not null default auth.uid() references public.usuarios(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.solicitud_compra_lineas (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references public.solicitudes_compra(id) on delete cascade,
  producto_id uuid references public.productos(id) on delete restrict,
  descripcion text not null check (length(trim(descripcion)) between 2 and 240),
  cantidad numeric(14,3) not null check (cantidad > 0),
  unidad text not null check (length(trim(unidad)) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (solicitud_id, id)
);

create table if not exists public.ofertas_compra (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('OFE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  solicitud_id uuid not null references public.solicitudes_compra(id) on delete restrict,
  proveedor_id uuid not null references public.proveedores(id) on delete restrict,
  vigencia_hasta date,
  plazo_entrega_dias integer check (plazo_entrega_dias is null or plazo_entrega_dias >= 0),
  condiciones text not null default '',
  estado text not null default 'Vigente' check (estado in ('Vigente', 'Retirada')),
  created_by uuid not null default auth.uid() references public.usuarios(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (solicitud_id, proveedor_id),
  unique (solicitud_id, id)
);

create table if not exists public.detalle_ofertas_compra (
  id uuid primary key default gen_random_uuid(),
  oferta_id uuid not null references public.ofertas_compra(id) on delete cascade,
  solicitud_linea_id uuid not null references public.solicitud_compra_lineas(id) on delete restrict,
  precio_unitario numeric(14,4) not null check (precio_unitario >= 0),
  created_at timestamptz not null default now(),
  unique (oferta_id, solicitud_linea_id)
);

do $constraint$
begin
  if not exists (select 1 from pg_constraint where conname = 'solicitudes_compra_seleccion_fk') then
    alter table public.solicitudes_compra add constraint solicitudes_compra_seleccion_fk
      foreign key (seleccion_oferta_id) references public.ofertas_compra(id) on delete restrict;
  end if;
end
$constraint$;

create index if not exists solicitudes_compra_estado_fecha_idx on public.solicitudes_compra (estado, created_at desc);
create index if not exists solicitud_compra_lineas_solicitud_idx on public.solicitud_compra_lineas (solicitud_id);
create index if not exists ofertas_compra_solicitud_idx on public.ofertas_compra (solicitud_id, estado);
create index if not exists detalle_ofertas_compra_oferta_idx on public.detalle_ofertas_compra (oferta_id);

alter table public.solicitudes_compra enable row level security;
alter table public.solicitud_compra_lineas enable row level security;
alter table public.ofertas_compra enable row level security;
alter table public.detalle_ofertas_compra enable row level security;

grant select, insert, update, delete on public.solicitudes_compra to authenticated;
grant select, insert, update, delete on public.solicitud_compra_lineas to authenticated;
grant select, insert, update, delete on public.ofertas_compra to authenticated;
grant select, insert, update, delete on public.detalle_ofertas_compra to authenticated;

drop policy if exists solicitudes_compra_select on public.solicitudes_compra;
create policy solicitudes_compra_select on public.solicitudes_compra for select to authenticated
  using ((select app_private._tiene_permiso('compras', 'ver')));
drop policy if exists solicitudes_compra_insert on public.solicitudes_compra;
create policy solicitudes_compra_insert on public.solicitudes_compra for insert to authenticated
  with check ((select app_private._tiene_permiso('compras', 'crear')) and created_by = (select auth.uid()) and solicitante_id = (select auth.uid()));
drop policy if exists solicitudes_compra_update on public.solicitudes_compra;
create policy solicitudes_compra_update on public.solicitudes_compra for update to authenticated
  using ((select app_private._tiene_permiso('compras', 'editar')))
  with check ((select app_private._tiene_permiso('compras', 'editar')));
drop policy if exists solicitudes_compra_delete on public.solicitudes_compra;
create policy solicitudes_compra_delete on public.solicitudes_compra for delete to authenticated
  using ((select app_private._tiene_permiso('compras', 'eliminar')) and estado = 'Borrador');

drop policy if exists solicitud_compra_lineas_select on public.solicitud_compra_lineas;
create policy solicitud_compra_lineas_select on public.solicitud_compra_lineas for select to authenticated
  using ((select app_private._tiene_permiso('compras', 'ver')));
drop policy if exists solicitud_compra_lineas_insert on public.solicitud_compra_lineas;
create policy solicitud_compra_lineas_insert on public.solicitud_compra_lineas for insert to authenticated
  with check ((select app_private._tiene_permiso('compras', 'crear')) and exists (
    select 1 from public.solicitudes_compra s where s.id = solicitud_id and s.estado in ('Borrador', 'Abierta')
  ));
drop policy if exists solicitud_compra_lineas_update on public.solicitud_compra_lineas;
create policy solicitud_compra_lineas_update on public.solicitud_compra_lineas for update to authenticated
  using ((select app_private._tiene_permiso('compras', 'editar')))
  with check ((select app_private._tiene_permiso('compras', 'editar')));
drop policy if exists solicitud_compra_lineas_delete on public.solicitud_compra_lineas;
create policy solicitud_compra_lineas_delete on public.solicitud_compra_lineas for delete to authenticated
  using ((select app_private._tiene_permiso('compras', 'editar')));

drop policy if exists ofertas_compra_select on public.ofertas_compra;
create policy ofertas_compra_select on public.ofertas_compra for select to authenticated
  using ((select app_private._tiene_permiso('compras', 'ver')));
drop policy if exists ofertas_compra_insert on public.ofertas_compra;
create policy ofertas_compra_insert on public.ofertas_compra for insert to authenticated
  with check ((select app_private._tiene_permiso('compras', 'crear')) and created_by = (select auth.uid()) and exists (
    select 1 from public.solicitudes_compra s where s.id = solicitud_id and s.estado = 'Abierta'
  ));
drop policy if exists ofertas_compra_update on public.ofertas_compra;
create policy ofertas_compra_update on public.ofertas_compra for update to authenticated
  using ((select app_private._tiene_permiso('compras', 'editar')))
  with check ((select app_private._tiene_permiso('compras', 'editar')));
drop policy if exists ofertas_compra_delete on public.ofertas_compra;
create policy ofertas_compra_delete on public.ofertas_compra for delete to authenticated
  using ((select app_private._tiene_permiso('compras', 'eliminar')) and estado = 'Retirada');

drop policy if exists detalle_ofertas_compra_select on public.detalle_ofertas_compra;
create policy detalle_ofertas_compra_select on public.detalle_ofertas_compra for select to authenticated
  using ((select app_private._tiene_permiso('compras', 'ver')));
drop policy if exists detalle_ofertas_compra_insert on public.detalle_ofertas_compra;
create policy detalle_ofertas_compra_insert on public.detalle_ofertas_compra for insert to authenticated
  with check ((select app_private._tiene_permiso('compras', 'crear')) and exists (
    select 1 from public.ofertas_compra o join public.solicitud_compra_lineas l on l.solicitud_id = o.solicitud_id
    where o.id = oferta_id and o.estado = 'Vigente' and l.id = solicitud_linea_id
  ));
drop policy if exists detalle_ofertas_compra_update on public.detalle_ofertas_compra;
create policy detalle_ofertas_compra_update on public.detalle_ofertas_compra for update to authenticated
  using ((select app_private._tiene_permiso('compras', 'editar')))
  with check ((select app_private._tiene_permiso('compras', 'editar')));
drop policy if exists detalle_ofertas_compra_delete on public.detalle_ofertas_compra;
create policy detalle_ofertas_compra_delete on public.detalle_ofertas_compra for delete to authenticated
  using ((select app_private._tiene_permiso('compras', 'editar')));

-- Guarda cabecera y líneas en una sola transacción; no crea orden ni stock.
create or replace function public.crear_solicitud_compra(p_detalle text, p_fecha_necesidad date, p_lineas jsonb)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := (select auth.uid()); v_id uuid; v_line jsonb; v_count integer := 0;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras', 'crear')) then
    raise exception 'No tienes permiso para crear solicitudes de compra' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 or jsonb_array_length(p_lineas) > 100 then
    raise exception 'La solicitud debe tener entre 1 y 100 líneas';
  end if;
  insert into public.solicitudes_compra (solicitante_id, created_by, estado, fecha_necesidad, detalle)
  values (v_uid, v_uid, 'Borrador', p_fecha_necesidad, trim(coalesce(p_detalle, '')))
  returning id into v_id;
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    if length(trim(coalesce(v_line->>'descripcion',''))) < 2 or length(trim(coalesce(v_line->>'unidad',''))) < 1
       or coalesce((v_line->>'cantidad')::numeric, 0) <= 0 then
      raise exception 'Revisa descripción, unidad y cantidad de cada línea';
    end if;
    insert into public.solicitud_compra_lineas (solicitud_id, producto_id, descripcion, cantidad, unidad)
    values (v_id, nullif(v_line->>'producto_id','')::uuid, trim(v_line->>'descripcion'), (v_line->>'cantidad')::numeric, trim(v_line->>'unidad'));
    v_count := v_count + 1;
  end loop;
  return v_id;
end
$function$;

-- Abre una solicitud para recepción de propuestas.
create or replace function public.abrir_solicitud_compra(p_solicitud_id uuid)
returns void language plpgsql security definer set search_path = '' as $function$
begin
  if not (select app_private._tiene_permiso('compras', 'editar')) then
    raise exception 'No tienes permiso para abrir solicitudes' using errcode = '42501';
  end if;
  update public.solicitudes_compra s set estado = 'Abierta', updated_at = now()
  where s.id = p_solicitud_id and s.estado = 'Borrador'
    and exists (select 1 from public.solicitud_compra_lineas l where l.solicitud_id = s.id);
  if not found then raise exception 'La solicitud no existe, no tiene líneas o ya cambió de estado'; end if;
end
$function$;

-- Registra todos los precios de una oferta a la vez, limitados a las líneas solicitadas.
create or replace function public.registrar_oferta_compra(
  p_solicitud_id uuid, p_proveedor_id uuid, p_vigencia_hasta date,
  p_plazo_entrega_dias integer, p_condiciones text, p_precios jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := (select auth.uid()); v_oferta uuid; v_expected integer; v_actual integer;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras', 'crear')) then
    raise exception 'No tienes permiso para registrar ofertas' using errcode = '42501';
  end if;
  perform 1 from public.solicitudes_compra s where s.id = p_solicitud_id and s.estado = 'Abierta' for update;
  if not found then raise exception 'La solicitud no está abierta'; end if;
  select count(*) into v_expected from public.solicitud_compra_lineas l where l.solicitud_id = p_solicitud_id;
  if jsonb_typeof(p_precios) <> 'array' then raise exception 'Formato de precios inválido'; end if;
  select count(*) into v_actual from jsonb_array_elements(p_precios);
  if v_actual <> v_expected then raise exception 'Debe cotizarse cada línea de la solicitud'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_precios) as x(linea_id uuid, precio_unitario numeric)
    left join public.solicitud_compra_lineas l on l.id = x.linea_id and l.solicitud_id = p_solicitud_id
    where l.id is null or x.precio_unitario is null or x.precio_unitario < 0
  ) then raise exception 'Hay precios inválidos o líneas que no pertenecen a la solicitud'; end if;
  if exists (select 1 from public.ofertas_compra o where o.solicitud_id = p_solicitud_id and o.proveedor_id = p_proveedor_id) then
    raise exception 'Este proveedor ya tiene una oferta registrada para la solicitud';
  end if;
  insert into public.ofertas_compra (solicitud_id, proveedor_id, vigencia_hasta, plazo_entrega_dias, condiciones, created_by)
  values (p_solicitud_id, p_proveedor_id, p_vigencia_hasta, p_plazo_entrega_dias, trim(coalesce(p_condiciones,'')), v_uid)
  returning id into v_oferta;
  insert into public.detalle_ofertas_compra (oferta_id, solicitud_linea_id, precio_unitario)
  select v_oferta, x.linea_id, x.precio_unitario
  from jsonb_to_recordset(p_precios) as x(linea_id uuid, precio_unitario numeric);
  return v_oferta;
end
$function$;

-- Seleccionar una oferta solo cierra el comparativo: no compromete una compra.
create or replace function public.seleccionar_oferta_compra(p_solicitud_id uuid, p_oferta_id uuid)
returns void language plpgsql security definer set search_path = '' as $function$
begin
  if not (select app_private._tiene_permiso('compras', 'editar')) then
    raise exception 'No tienes permiso para seleccionar una oferta' using errcode = '42501';
  end if;
  update public.solicitudes_compra s set seleccion_oferta_id = p_oferta_id, estado = 'Cerrada', updated_at = now()
  where s.id = p_solicitud_id and s.estado = 'Abierta'
    and exists (select 1 from public.ofertas_compra o where o.id = p_oferta_id and o.solicitud_id = s.id and o.estado = 'Vigente');
  if not found then raise exception 'La oferta no corresponde a una solicitud abierta'; end if;
end
$function$;

revoke all on function public.crear_solicitud_compra(text,date,jsonb) from public, anon;
revoke all on function public.abrir_solicitud_compra(uuid) from public, anon;
revoke all on function public.registrar_oferta_compra(uuid,uuid,date,integer,text,jsonb) from public, anon;
revoke all on function public.seleccionar_oferta_compra(uuid,uuid) from public, anon;
grant execute on function public.crear_solicitud_compra(text,date,jsonb) to authenticated;
grant execute on function public.abrir_solicitud_compra(uuid) to authenticated;
grant execute on function public.registrar_oferta_compra(uuid,uuid,date,integer,text,jsonb) to authenticated;
grant execute on function public.seleccionar_oferta_compra(uuid,uuid) to authenticated;

do $audit$
declare v_table text;
begin
  foreach v_table in array array['solicitudes_compra','solicitud_compra_lineas','ofertas_compra','detalle_ofertas_compra'] loop
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
