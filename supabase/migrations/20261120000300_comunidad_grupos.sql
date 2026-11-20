begin;

create table public.comunidad_grupos (
  id uuid primary key default gen_random_uuid(),
  rol_id uuid not null references public.roles(id) on delete restrict,
  nombre text not null check (char_length(btrim(nombre)) between 3 and 60),
  descripcion text not null default '' check (char_length(descripcion) <= 240),
  created_at timestamptz not null default now(),
  archivado_en timestamptz
);
create unique index comunidad_grupo_nombre_activo on public.comunidad_grupos (rol_id, lower(btrim(nombre))) where archivado_en is null;
create index comunidad_grupos_rol_idx on public.comunidad_grupos (rol_id);

create table public.comunidad_mensajes (
  id uuid primary key,
  grupo_id uuid not null references public.comunidad_grupos(id) on delete restrict,
  autor_id uuid references public.usuarios(id) on delete set null,
  autor_nombre text not null,
  cuerpo text not null check (char_length(btrim(cuerpo)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index comunidad_mensajes_grupo_fecha_idx on public.comunidad_mensajes (grupo_id, created_at desc, id desc);
create index comunidad_mensajes_autor_idx on public.comunidad_mensajes (autor_id);

alter table public.comunidad_grupos enable row level security;
alter table public.comunidad_mensajes enable row level security;
revoke all on public.comunidad_grupos, public.comunidad_mensajes from public, anon, authenticated;
grant select on public.comunidad_grupos, public.comunidad_mensajes to authenticated;

create function app_private._comunidad_rol_actual()
returns uuid language sql stable security definer set search_path = ''
as $$
  select u.rol_id from public.usuarios u where u.id = (select auth.uid()) and u.activo;
$$;
revoke all on function app_private._comunidad_rol_actual() from public, anon, authenticated;
grant execute on function app_private._comunidad_rol_actual() to authenticated;

create policy comunidad_grupos_lectura on public.comunidad_grupos for select to authenticated
using (archivado_en is null and (rol_id = (select app_private._comunidad_rol_actual()) or (select app_private._es_admin())));

-- Administrar el catálogo no concede acceso al contenido de otras conversaciones.
create policy comunidad_mensajes_mismo_rol on public.comunidad_mensajes for select to authenticated
using (exists (
  select 1 from public.comunidad_grupos g
  where g.id = grupo_id and g.archivado_en is null and g.rol_id = (select app_private._comunidad_rol_actual())
));

create function app_private._comunidad_roles()
returns table (id uuid, nombre text, grupo text, descripcion text) language sql stable set search_path = ''
as $$
  select r.id, r.nombre, mapa.grupo, mapa.descripcion
  from (values
    ('Usuarios', 'Espacio de conversación para el rol de usuarios.'),
    ('Vendedores', 'Coordinación comercial y consultas del equipo de ventas.'),
    ('Administradores', 'Conversación privada del equipo de administración.'),
    ('Supervisores', 'Seguimiento y coordinación del equipo de supervisión.')
  ) as mapa(grupo, descripcion)
  cross join lateral (
    select rol.id, rol.nombre from public.roles rol
    where (mapa.grupo = 'Usuarios' and rol.nombre in ('Usuario', 'Básico'))
       or (mapa.grupo = 'Vendedores' and rol.nombre = 'Vendedor')
       or (mapa.grupo = 'Administradores' and rol.nombre = 'Administrador')
       or (mapa.grupo = 'Supervisores' and rol.nombre = 'Supervisor')
    order by case when rol.nombre = 'Usuario' then 0 else 1 end
    limit 1
  ) r;
$$;
revoke all on function app_private._comunidad_roles() from public, anon, authenticated;

-- No se crean ni reasignan roles. Si falta un rol, se detiene la entrega completa.
do $$
begin
  if (select count(*) from app_private._comunidad_roles()) <> 4 then
    raise exception 'Comunidad requiere roles Usuario (o Básico), Vendedor, Administrador y Supervisor.';
  end if;
end;
$$;

insert into public.comunidad_grupos (rol_id, nombre, descripcion)
select id, grupo, descripcion from app_private._comunidad_roles();

-- Audita alta/baja administrativa, nunca el cuerpo de mensajes.
create trigger trg_auditoria after insert or update on public.comunidad_grupos
for each row execute function public.fn_auditar();

create function public.comunidad_listar_grupos()
returns table (id uuid, nombre text, descripcion text, rol text, puede_conversar boolean)
language sql stable security invoker set search_path = ''
as $$
  select g.id, g.nombre, g.descripcion, r.nombre, g.rol_id = (select app_private._comunidad_rol_actual())
  from public.comunidad_grupos g join public.roles r on r.id = g.rol_id
  where g.archivado_en is null
  order by (g.rol_id = (select app_private._comunidad_rol_actual())) desc, g.nombre, g.id;
$$;

create function public.comunidad_listar_roles()
returns table (id uuid, nombre text)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.nombre from app_private._comunidad_roles() r
  where (select app_private._es_admin())
  order by r.nombre;
$$;

create function public.comunidad_crear_grupo(p_rol_id uuid, p_nombre text, p_descripcion text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not app_private._es_admin() then
    raise exception 'Solo un administrador puede crear grupos.' using errcode = '42501';
  end if;
  if not exists (select 1 from app_private._comunidad_roles() r where r.id = p_rol_id) then
    raise exception 'Selecciona un rol habilitado para Comunidad.' using errcode = '22023';
  end if;
  if p_nombre is null or char_length(btrim(p_nombre)) not between 3 and 60 or char_length(coalesce(p_descripcion, '')) > 240 then
    raise exception 'El nombre debe tener entre 3 y 60 caracteres y la descripción hasta 240.' using errcode = '22023';
  end if;
  insert into public.comunidad_grupos (rol_id, nombre, descripcion)
  values (p_rol_id, btrim(p_nombre), btrim(coalesce(p_descripcion, '')))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.comunidad_eliminar_grupo(p_grupo_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not app_private._es_admin() then
    raise exception 'Solo un administrador puede eliminar grupos.' using errcode = '42501';
  end if;
  update public.comunidad_grupos set archivado_en = clock_timestamp()
  where id = p_grupo_id and archivado_en is null;
end;
$$;

create function public.comunidad_enviar_mensaje(p_grupo_id uuid, p_id uuid, p_cuerpo text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_autor uuid := (select auth.uid());
  v_rol uuid;
  v_nombre text;
  v_cuerpo text := btrim(p_cuerpo, E' \n\r\t');
begin
  select u.rol_id, u.nombre into v_rol, v_nombre
  from public.usuarios u where u.id = v_autor and u.activo for share;

  -- Bloqueo compatible entre mensajes, incompatible con archivar el grupo.
  perform 1 from public.comunidad_grupos g
  where g.id = p_grupo_id and g.archivado_en is null and g.rol_id = v_rol for share;
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

revoke all on function public.comunidad_listar_grupos(), public.comunidad_listar_roles(),
  public.comunidad_crear_grupo(uuid, text, text), public.comunidad_eliminar_grupo(uuid),
  public.comunidad_enviar_mensaje(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.comunidad_listar_grupos(), public.comunidad_listar_roles(),
  public.comunidad_crear_grupo(uuid, text, text), public.comunidad_eliminar_grupo(uuid),
  public.comunidad_enviar_mensaje(uuid, uuid, text) to authenticated;
commit;
