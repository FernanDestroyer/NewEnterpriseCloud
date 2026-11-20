begin;

-- Un rol fija la audiencia de todo el grupo; NULL usa membresías individuales.
alter table public.comunidad_grupos alter column rol_id drop not null;
create unique index comunidad_grupo_nombre_miembros_activo
  on public.comunidad_grupos (lower(btrim(nombre)))
  where rol_id is null and archivado_en is null;

create table public.comunidad_grupo_miembros (
  grupo_id uuid not null references public.comunidad_grupos(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  primary key (grupo_id, usuario_id)
);
create index comunidad_grupo_miembros_usuario_idx on public.comunidad_grupo_miembros (usuario_id);
alter table public.comunidad_grupo_miembros enable row level security;
revoke all on public.comunidad_grupo_miembros from public, anon, authenticated;

create function app_private._comunidad_puede_conversar(p_grupo_id uuid, p_rol_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios u
    where u.id = (select auth.uid()) and u.activo
      and (
        (select app_private._es_admin())
        or (p_rol_id is not null and u.rol_id = p_rol_id)
        or (p_rol_id is null and exists (
          select 1 from public.comunidad_grupo_miembros m
          where m.grupo_id = p_grupo_id and m.usuario_id = u.id
        ))
      )
  );
$$;
revoke all on function app_private._comunidad_puede_conversar(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private._comunidad_puede_conversar(uuid, uuid) to authenticated;

alter policy comunidad_grupos_lectura on public.comunidad_grupos
using (archivado_en is null and app_private._comunidad_puede_conversar(id, rol_id));

-- La existencia del grupo ya está filtrada por su política RLS.
alter policy comunidad_mensajes_mismo_rol on public.comunidad_mensajes
using (exists (
  select 1 from public.comunidad_grupos g where g.id = grupo_id and g.archivado_en is null
));

create or replace function public.comunidad_listar_grupos()
returns table (id uuid, nombre text, descripcion text, rol text, puede_conversar boolean)
language sql stable security invoker set search_path = ''
as $$
  select g.id, g.nombre, g.descripcion, r.nombre, true
  from public.comunidad_grupos g left join public.roles r on r.id = g.rol_id
  where g.archivado_en is null
  order by (g.rol_id = (select app_private._comunidad_rol_actual())) desc nulls last, g.nombre, g.id;
$$;

create function public.comunidad_buscar_usuarios(p_busqueda text default '', p_offset integer default 0)
returns table (id uuid, nombre text, correo text, rol text)
language sql stable security definer set search_path = ''
as $$
  select u.id, u.nombre, u.email, coalesce(r.nombre, 'Sin rol')
  from public.usuarios u left join public.roles r on r.id = u.rol_id
  where (select app_private._es_admin()) and u.activo
    and strpos(lower(concat_ws(' ', u.nombre, u.email, r.nombre)), lower(left(btrim(coalesce(p_busqueda, '')), 100))) > 0
  order by lower(u.nombre), u.id
  limit 25 offset greatest(0, coalesce(p_offset, 0));
$$;

create function public.comunidad_crear_grupo_miembros(p_nombre text, p_descripcion text, p_usuario_ids uuid[])
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not app_private._es_admin() then
    raise exception 'Solo un administrador puede crear grupos.' using errcode = '42501';
  end if;
  if p_nombre is null or char_length(btrim(p_nombre)) not between 3 and 60 or char_length(coalesce(p_descripcion, '')) > 240 then
    raise exception 'El nombre debe tener entre 3 y 60 caracteres y la descripción hasta 240.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_usuario_ids), 0) not between 1 and 100 then
    raise exception 'Selecciona entre 1 y 100 usuarios.' using errcode = '22023';
  end if;
  if (select count(*) from (
    select u.id from public.usuarios u
    where u.id = any(p_usuario_ids) and u.activo order by u.id for share
  ) cuentas) <> cardinality(p_usuario_ids) then
    raise exception 'La selección incluye cuentas no disponibles o repetidas.' using errcode = '22023';
  end if;
  insert into public.comunidad_grupos (nombre, descripcion)
  values (btrim(p_nombre), btrim(coalesce(p_descripcion, ''))) returning id into v_id;
  insert into public.comunidad_grupo_miembros (grupo_id, usuario_id)
  select v_id, usuario_id from unnest(p_usuario_ids) as miembros(usuario_id);
  return v_id;
end;
$$;

create or replace function public.comunidad_enviar_mensaje(p_grupo_id uuid, p_id uuid, p_cuerpo text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_autor uuid := (select auth.uid());
  v_nombre text;
  v_cuerpo text := btrim(p_cuerpo, E' \n\r\t');
begin
  select u.nombre into v_nombre
  from public.usuarios u where u.id = v_autor and u.activo for share;
  if not found then
    raise exception 'No puedes escribir en esta conversación.' using errcode = '42501';
  end if;
  perform 1 from public.comunidad_grupos g
  where g.id = p_grupo_id and g.archivado_en is null
    and app_private._comunidad_puede_conversar(g.id, g.rol_id)
  for share;
  if not found then
    raise exception 'No puedes escribir en esta conversación.' using errcode = '42501';
  end if;
  if p_id is null or v_cuerpo is null or char_length(v_cuerpo) not between 1 and 2000 then
    raise exception 'Escribe un mensaje de hasta 2000 caracteres.' using errcode = '22023';
  end if;
  insert into public.comunidad_mensajes (id, grupo_id, autor_id, autor_nombre, cuerpo)
  values (p_id, p_grupo_id, v_autor, v_nombre, v_cuerpo) on conflict (id) do nothing;
  if not found and not exists (
    select 1 from public.comunidad_mensajes m
    where m.id = p_id and m.grupo_id = p_grupo_id and m.autor_id = v_autor and m.cuerpo = v_cuerpo
  ) then
    raise exception 'No se pudo registrar este mensaje.' using errcode = '23505';
  end if;
  return p_id;
end;
$$;

revoke all on function public.comunidad_buscar_usuarios(text, integer),
  public.comunidad_crear_grupo_miembros(text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.comunidad_buscar_usuarios(text, integer),
  public.comunidad_crear_grupo_miembros(text, text, uuid[]) to authenticated;

commit;
