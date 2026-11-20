begin;

alter policy comunidad_mensajes_mismo_rol on public.comunidad_mensajes
using (exists (
  select 1 from public.comunidad_grupos g
  where g.id = grupo_id and g.archivado_en is null
    and (g.rol_id = (select app_private._comunidad_rol_actual()) or (select app_private._es_admin()))
));

create or replace function public.comunidad_listar_grupos()
returns table (id uuid, nombre text, descripcion text, rol text, puede_conversar boolean)
language sql stable security invoker set search_path = ''
as $$
  select g.id, g.nombre, g.descripcion, r.nombre,
    g.rol_id = (select app_private._comunidad_rol_actual()) or (select app_private._es_admin())
  from public.comunidad_grupos g join public.roles r on r.id = g.rol_id
  where g.archivado_en is null
  order by (g.rol_id = (select app_private._comunidad_rol_actual())) desc, g.nombre, g.id;
$$;

create or replace function public.comunidad_enviar_mensaje(p_grupo_id uuid, p_id uuid, p_cuerpo text)
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

  if not found then
    raise exception 'No puedes escribir en esta conversación.' using errcode = '42501';
  end if;

  perform 1 from public.comunidad_grupos g
  where g.id = p_grupo_id and g.archivado_en is null
    and (g.rol_id = v_rol or (select app_private._es_admin()))
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

revoke all on function public.comunidad_listar_grupos(),
  public.comunidad_enviar_mensaje(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.comunidad_listar_grupos(),
  public.comunidad_enviar_mensaje(uuid, uuid, text) to authenticated;

commit;
