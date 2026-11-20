begin;
set local role authenticated;
select set_config('test.user_id', '10000000-0000-0000-0000-000000000003', true);
do $$
declare
  vendedor uuid := '10000000-0000-0000-0000-000000000002';
  supervisor uuid := '10000000-0000-0000-0000-000000000004';
  inactivo uuid := '10000000-0000-0000-0000-000000000007';
  grupo uuid;
begin
  if (select count(*) from public.comunidad_buscar_usuarios('vendedor', 0)) <> 2 then raise exception 'Búsqueda por rol incorrecta'; end if;
  if exists (select 1 from public.comunidad_buscar_usuarios('inactivo', 0)) then raise exception 'El selector listó inactivos'; end if;
  begin perform public.comunidad_crear_grupo_miembros('Vacio', '', '{}'); raise exception 'Grupo sin miembros'; exception when invalid_parameter_value then null; end;
  begin perform public.comunidad_crear_grupo_miembros('Dato inválido', '', array[vendedor, inactivo]); raise exception 'Aceptó inactivo'; exception when invalid_parameter_value then null; end;
  begin perform public.comunidad_crear_grupo_miembros('Dato inválido', '', array[vendedor, vendedor]); raise exception 'Aceptó duplicados'; exception when invalid_parameter_value then null; end;
  grupo := public.comunidad_crear_grupo_miembros('Coordinadores', '', array[vendedor, supervisor]);
  perform set_config('test.members_group', grupo::text, true);
  if not exists (select 1 from public.comunidad_listar_grupos() where id = grupo and rol is null and puede_conversar) then raise exception 'El administrador no puede abrir Coordinadores'; end if;
  perform public.comunidad_enviar_mensaje(grupo, gen_random_uuid(), 'Mensaje inicial del administrador');
end;
$$;

select set_config('test.user_id', '10000000-0000-0000-0000-000000000002', true);
do $$
declare grupo uuid := current_setting('test.members_group')::uuid;
begin
  if exists (select 1 from public.comunidad_buscar_usuarios('', 0)) then raise exception 'Un no administrador accedió al directorio'; end if;
  begin perform public.comunidad_crear_grupo_miembros('Intento', '', array[auth.uid()]); raise exception 'Vendedor creó un grupo'; exception when insufficient_privilege then null; end;
  if not exists (select 1 from public.comunidad_listar_grupos() where id = grupo) then raise exception 'Vendedor seleccionado no ve el grupo'; end if;
  if (select count(*) from public.comunidad_mensajes where grupo_id = grupo) <> 1 then raise exception 'Vendedor seleccionado no ve los mensajes'; end if;
  perform public.comunidad_enviar_mensaje(grupo, gen_random_uuid(), 'Respuesta desde ventas');
end;
$$;

select set_config('test.user_id', '10000000-0000-0000-0000-000000000004', true);
do $$
declare grupo uuid := current_setting('test.members_group')::uuid;
begin
  if (select count(*) from public.comunidad_mensajes where grupo_id = grupo) <> 2 then raise exception 'Supervisor seleccionado no ve el chat mixto'; end if;
  perform public.comunidad_enviar_mensaje(grupo, gen_random_uuid(), 'Respuesta desde supervisión');
end;
$$;

select set_config('test.user_id', '10000000-0000-0000-0000-000000000006', true);
do $$
declare grupo uuid := current_setting('test.members_group')::uuid;
begin
  if exists (select 1 from public.comunidad_listar_grupos() where id = grupo)
    or exists (select 1 from public.comunidad_mensajes where grupo_id = grupo) then raise exception 'Una cuenta no seleccionada del mismo rol vio el chat mixto'; end if;
  begin perform public.comunidad_enviar_mensaje(grupo, gen_random_uuid(), 'Intento'); raise exception 'No invitado escribió'; exception when insufficient_privilege then null; end;
  begin insert into public.comunidad_grupo_miembros values (grupo, auth.uid()); raise exception 'El usuario se añadió directamente'; exception when insufficient_privilege then null; end;
end;
$$;

reset role;
update public.usuarios set rol_id = null where id = '10000000-0000-0000-0000-000000000002';
update public.usuarios set activo = false where id = '10000000-0000-0000-0000-000000000004';
set local role authenticated;
select set_config('test.user_id', '10000000-0000-0000-0000-000000000002', true);
do $$ begin
  if (select count(*) from public.comunidad_mensajes where grupo_id = current_setting('test.members_group')::uuid) <> 3 then raise exception 'Cambiar de rol no debe revocar la membresía individual'; end if;
end $$;
select set_config('test.user_id', '10000000-0000-0000-0000-000000000004', true);
do $$ begin
  if exists (select 1 from public.comunidad_listar_grupos()) then raise exception 'Invitado inactivo conserva acceso'; end if;
end $$;
rollback;
