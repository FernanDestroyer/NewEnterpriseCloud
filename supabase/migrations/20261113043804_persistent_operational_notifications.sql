-- Persist current operational alerts per user. These are refreshed snapshots,
-- not an audit log or approval workflow; event delivery remains a later phase.
create table public.notificaciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  fuente text not null check (fuente in ('inventory', 'finance', 'purchases')),
  clave_fuente text not null check (length(btrim(clave_fuente)) between 1 and 180),
  referencia text not null check (length(btrim(referencia)) between 1 and 120),
  titulo text not null check (length(btrim(titulo)) between 1 and 180),
  detalle text not null default '' check (length(detalle) <= 500),
  severidad text not null check (severidad in ('critical', 'warning', 'info')),
  estado text not null default 'active' check (estado in ('active', 'resolved')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  archived_at timestamptz,
  resolved_at timestamptz,
  unique (usuario_id, fuente, clave_fuente)
);

create index notificaciones_usuario_estado_fecha_idx
  on public.notificaciones (usuario_id, estado, archived_at, created_at desc);

alter table public.notificaciones enable row level security;
revoke all on table public.notificaciones from public, anon, authenticated;
grant select, insert, update on table public.notificaciones to authenticated;

create policy notificaciones_select_propias
  on public.notificaciones for select to authenticated
  using (
    usuario_id = (select auth.uid())
    and case fuente
      when 'inventory' then (select public.tiene_permiso('inventario', 'ver'))
      when 'finance' then (select public.tiene_permiso('finanzas', 'ver'))
      when 'purchases' then (select public.tiene_permiso('compras', 'ver'))
      else false
    end
  );

create policy notificaciones_insert_propias
  on public.notificaciones for insert to authenticated
  with check (
    usuario_id = (select auth.uid())
    and case fuente
      when 'inventory' then (select public.tiene_permiso('inventario', 'ver'))
      when 'finance' then (select public.tiene_permiso('finanzas', 'ver'))
      when 'purchases' then (select public.tiene_permiso('compras', 'ver'))
      else false
    end
  );

create policy notificaciones_update_propias
  on public.notificaciones for update to authenticated
  using (
    usuario_id = (select auth.uid())
    and case fuente
      when 'inventory' then (select public.tiene_permiso('inventario', 'ver'))
      when 'finance' then (select public.tiene_permiso('finanzas', 'ver'))
      when 'purchases' then (select public.tiene_permiso('compras', 'ver'))
      else false
    end
  )
  with check (
    usuario_id = (select auth.uid())
    and case fuente
      when 'inventory' then (select public.tiene_permiso('inventario', 'ver'))
      when 'finance' then (select public.tiene_permiso('finanzas', 'ver'))
      when 'purchases' then (select public.tiene_permiso('compras', 'ver'))
      else false
    end
  );

create or replace function public.ec_sincronizar_alertas_operativas_v1(
  p_fuentes text[],
  p_alertas jsonb
)
returns integer
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_usuario_id uuid := auth.uid();
  v_fuente text;
  v_alerta jsonb;
  v_clave text;
  v_referencia text;
  v_titulo text;
  v_detalle text;
  v_severidad text;
  v_total integer := 0;
begin
  if v_usuario_id is null then
    raise exception 'Se requiere una sesión activa.' using errcode = '42501';
  end if;
  if p_fuentes is null or cardinality(p_fuentes) > 3 then
    raise exception 'La lista de módulos consultados no es válida.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_fuentes) f
    where f is null or f not in ('inventory', 'finance', 'purchases')
  ) then
    raise exception 'La lista incluye un módulo no admitido.' using errcode = '22023';
  end if;
  if cardinality(p_fuentes) <> (select count(distinct f) from unnest(p_fuentes) f) then
    raise exception 'La lista de módulos no puede tener duplicados.' using errcode = '22023';
  end if;
  if p_alertas is null then
    raise exception 'La lista de alertas debe ser un arreglo de hasta 1800 elementos.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_alertas) <> 'array' then
    raise exception 'La lista de alertas debe ser un arreglo de hasta 1800 elementos.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_alertas) > 1800 then
    raise exception 'La lista de alertas debe ser un arreglo de hasta 1800 elementos.' using errcode = '22023';
  end if;

  -- Serialize refreshes from multiple tabs so an older snapshot cannot resolve
  -- a notice created by a newer refresh for the same user.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ec_notificaciones:' || v_usuario_id::text, 0)
  );

  foreach v_fuente in array p_fuentes loop
    if (v_fuente = 'inventory' and not public.tiene_permiso('inventario', 'ver'))
      or (v_fuente = 'finance' and not public.tiene_permiso('finanzas', 'ver'))
      or (v_fuente = 'purchases' and not public.tiene_permiso('compras', 'ver')) then
      raise exception 'No tienes permiso para sincronizar alertas de este módulo.' using errcode = '42501';
    end if;
  end loop;

  for v_alerta in select value from jsonb_array_elements(p_alertas) loop
    if jsonb_typeof(v_alerta) <> 'object'
      or jsonb_typeof(v_alerta->'clave_fuente') <> 'string'
      or jsonb_typeof(v_alerta->'referencia') <> 'string'
      or jsonb_typeof(v_alerta->'titulo') <> 'string'
      or jsonb_typeof(v_alerta->'severidad') <> 'string'
      or (v_alerta ? 'detalle' and jsonb_typeof(v_alerta->'detalle') <> 'string') then
      raise exception 'Una alerta no cumple el formato permitido.' using errcode = '22023';
    end if;

    v_fuente := v_alerta->>'fuente';
    v_clave := btrim(coalesce(v_alerta->>'clave_fuente', ''));
    v_referencia := btrim(coalesce(v_alerta->>'referencia', ''));
    v_titulo := btrim(coalesce(v_alerta->>'titulo', ''));
    v_detalle := coalesce(v_alerta->>'detalle', '');
    v_severidad := v_alerta->>'severidad';

    if v_fuente is null or not (v_fuente = any(p_fuentes))
      or length(v_clave) not between 1 and 180
      or length(v_referencia) not between 1 and 120
      or length(v_titulo) not between 1 and 180
      or length(v_detalle) > 500
      or v_severidad is null
      or v_severidad not in ('critical', 'warning', 'info') then
      raise exception 'Una alerta no cumple el formato permitido.' using errcode = '22023';
    end if;

    insert into public.notificaciones as existente (
      usuario_id, fuente, clave_fuente, referencia, titulo, detalle, severidad,
      estado, created_at, updated_at, last_seen_at
    ) values (
      v_usuario_id, v_fuente, v_clave, v_referencia, v_titulo, v_detalle, v_severidad,
      'active', clock_timestamp(), clock_timestamp(), clock_timestamp()
    )
    on conflict (usuario_id, fuente, clave_fuente) do update set
      referencia = excluded.referencia,
      titulo = excluded.titulo,
      detalle = excluded.detalle,
      severidad = excluded.severidad,
      estado = 'active',
      read_at = case when existente.estado = 'resolved' then null else existente.read_at end,
      archived_at = case when existente.estado = 'resolved' then null else existente.archived_at end,
      resolved_at = null,
      updated_at = clock_timestamp(),
      last_seen_at = clock_timestamp();

    v_total := v_total + 1;
  end loop;

  update public.notificaciones n
  set estado = 'resolved', resolved_at = clock_timestamp(), updated_at = clock_timestamp()
  where n.usuario_id = v_usuario_id
    and n.fuente = any(p_fuentes)
    and n.estado = 'active'
    and not exists (
      select 1
      from jsonb_array_elements(p_alertas) a
      where a->>'fuente' = n.fuente
        and a->>'clave_fuente' = n.clave_fuente
    );

  return v_total;
end
$function$;

comment on table public.notificaciones is
  'Bandeja personal de alertas operativas derivadas de registros visibles. No reemplaza auditoría ni conserva eventos de aprobación.';
comment on function public.ec_sincronizar_alertas_operativas_v1(text[], jsonb) is
  'Sincroniza alertas de hasta tres módulos para el usuario actual. RLS y permisos del módulo restringen lectura, escritura y resolución.';

revoke all on function public.ec_sincronizar_alertas_operativas_v1(text[], jsonb) from public, anon;
grant execute on function public.ec_sincronizar_alertas_operativas_v1(text[], jsonb) to authenticated;
