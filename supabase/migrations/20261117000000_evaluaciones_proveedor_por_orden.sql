-- Fase H01-H05: evaluación única de proveedor por orden recibida.
begin;

create table if not exists public.evaluaciones_proveedor_orden (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null unique references public.compras(id) on delete restrict,
  proveedor_id uuid not null references public.proveedores(id) on delete restrict,
  calidad_producto smallint not null check (calidad_producto between 1 and 5),
  cumplimiento_plazos smallint not null check (cumplimiento_plazos between 1 and 5),
  nivel_servicio smallint not null check (nivel_servicio between 1 and 5),
  evaluado_por uuid not null references public.usuarios(id) on delete restrict default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists evaluaciones_proveedor_orden_proveedor_fecha_idx
  on public.evaluaciones_proveedor_orden(proveedor_id, creado_en desc, id);

alter table public.evaluaciones_proveedor_orden enable row level security;
revoke all on public.evaluaciones_proveedor_orden from public, anon, authenticated;
grant select on public.evaluaciones_proveedor_orden to authenticated;

drop policy if exists evaluaciones_proveedor_orden_select on public.evaluaciones_proveedor_orden;
create policy evaluaciones_proveedor_orden_select
  on public.evaluaciones_proveedor_orden for select to authenticated
  using ((select app_private._tiene_permiso('compras','ver')));

create or replace function public.registrar_evaluacion_proveedor_orden_v1(
  p_compra_id uuid,
  p_calidad_producto integer,
  p_cumplimiento_plazos integer,
  p_nivel_servicio integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_proveedor_id uuid;
  v_estado_recepcion text;
  v_id uuid;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar')) then
    raise exception 'Se requiere permiso de edición de Compras para evaluar proveedores.' using errcode='42501';
  end if;
  if p_compra_id is null
     or p_calidad_producto is null
     or p_cumplimiento_plazos is null
     or p_nivel_servicio is null
     or p_calidad_producto not between 1 and 5
     or p_cumplimiento_plazos not between 1 and 5
     or p_nivel_servicio not between 1 and 5 then
    raise exception 'La orden es obligatoria y cada criterio debe ser un entero entre 1 y 5.' using errcode='22023';
  end if;

  select c.proveedor_id, c.estado_recepcion
    into v_proveedor_id, v_estado_recepcion
    from public.compras c
    where c.id = p_compra_id
    for update;
  if not found then
    raise exception 'La orden de compra no existe.' using errcode='23503';
  end if;
  if v_proveedor_id is null
     or v_estado_recepcion not in ('parcial','completa')
     or not exists (select 1 from public.recepciones_compra r where r.compra_id = p_compra_id) then
    raise exception 'Solo se pueden evaluar órdenes con una recepción registrada (parcial o completa).' using errcode='23514';
  end if;

  insert into public.evaluaciones_proveedor_orden as existing (
    compra_id, proveedor_id, calidad_producto, cumplimiento_plazos,
    nivel_servicio, evaluado_por, actualizado_en
  ) values (
    p_compra_id, v_proveedor_id, p_calidad_producto, p_cumplimiento_plazos,
    p_nivel_servicio, v_uid, clock_timestamp()
  )
  on conflict (compra_id) do update set
    proveedor_id = excluded.proveedor_id,
    calidad_producto = excluded.calidad_producto,
    cumplimiento_plazos = excluded.cumplimiento_plazos,
    nivel_servicio = excluded.nivel_servicio,
    evaluado_por = excluded.evaluado_por,
    actualizado_en = clock_timestamp()
  returning existing.id into v_id;

  return v_id;
end
$function$;

create or replace function public.obtener_promedio_evaluacion_proveedor_v1(
  p_proveedor_id uuid
)
returns table (
  proveedor_id uuid,
  cantidad_evaluaciones bigint,
  promedio_calidad numeric,
  promedio_plazos numeric,
  promedio_servicio numeric,
  promedio_global numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null
     or not (select app_private._tiene_permiso('compras','ver')) then
    raise exception 'Se requiere permiso de lectura de Compras para consultar evaluaciones.' using errcode='42501';
  end if;
  if p_proveedor_id is null then
    raise exception 'El proveedor es obligatorio.' using errcode='22023';
  end if;
  if not exists (select 1 from public.proveedores p where p.id = p_proveedor_id) then
    raise exception 'El proveedor no existe.' using errcode='23503';
  end if;

  return query
  select p_proveedor_id,
    count(e.id)::bigint,
    round(avg(e.calidad_producto)::numeric, 2),
    round(avg(e.cumplimiento_plazos)::numeric, 2),
    round(avg(e.nivel_servicio)::numeric, 2),
    round(avg((e.calidad_producto + e.cumplimiento_plazos + e.nivel_servicio)::numeric / 3), 2)
  from public.evaluaciones_proveedor_orden e
  where e.proveedor_id = p_proveedor_id;
end
$function$;

revoke all on function public.registrar_evaluacion_proveedor_orden_v1(uuid,integer,integer,integer) from public, anon;
revoke all on function public.obtener_promedio_evaluacion_proveedor_v1(uuid) from public, anon;
grant execute on function public.registrar_evaluacion_proveedor_orden_v1(uuid,integer,integer,integer) to authenticated;
grant execute on function public.obtener_promedio_evaluacion_proveedor_v1(uuid) to authenticated;

do $audit$
begin
  if to_regprocedure('public.fn_auditar()') is not null
     and not exists (
       select 1 from pg_trigger t
       where t.tgrelid = 'public.evaluaciones_proveedor_orden'::regclass
         and t.tgfoid = 'public.fn_auditar()'::regprocedure
         and not t.tgisinternal
     ) then
    create trigger trg_auditoria_evaluaciones_proveedor_orden
      after insert or update or delete on public.evaluaciones_proveedor_orden
      for each row execute function public.fn_auditar();
  end if;
end
$audit$;

commit;
