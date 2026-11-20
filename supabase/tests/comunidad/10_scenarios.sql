begin;
select set_config('test.sales_group', id::text, true) from public.comunidad_grupos where nombre = 'Vendedores';
select set_config('test.admin_group', id::text, true) from public.comunidad_grupos where nombre = 'Administradores';
set local role authenticated;

select set_config('test.user_id', '10000000-0000-0000-0000-000000000002', true);
do $$
declare
  sales uuid := current_setting('test.sales_group')::uuid;
  admin uuid := current_setting('test.admin_group')::uuid;
  msg uuid := '20000000-0000-0000-0000-000000000001';
begin
  if (select array_agg(nombre) from public.comunidad_listar_grupos()) is distinct from array['Vendedores'] then raise exception 'Vendedor no ve su grupo o ve grupos de otro rol'; end if;
  if exists (select 1 from public.comunidad_listar_roles()) then raise exception 'Vendedor ve roles de gestión'; end if;
  begin perform public.comunidad_crear_grupo('00000000-0000-0000-0000-000000000002', 'No autorizado', ''); raise exception 'Vendedor creó grupo'; exception when insufficient_privilege then null; end;
  begin perform public.comunidad_eliminar_grupo(sales); raise exception 'Vendedor eliminó grupo'; exception when insufficient_privilege then null; end;
  begin perform public.comunidad_enviar_mensaje(admin, msg, 'No permitido'); raise exception 'Vendedor escribió al administrador'; exception when insufficient_privilege then null; end;
  begin perform public.comunidad_enviar_mensaje(sales, msg, E' \n\t '); raise exception 'Aceptó mensaje en blanco'; exception when invalid_parameter_value then null; end;
  begin insert into public.comunidad_mensajes (id, grupo_id, autor_nombre, cuerpo) values (msg, sales, 'Otro autor', 'Intento'); raise exception 'Aceptó inserción directa'; exception when insufficient_privilege then null; end;
  perform public.comunidad_enviar_mensaje(sales, msg, 'Hola equipo de ventas');
  perform public.comunidad_enviar_mensaje(sales, msg, 'Hola equipo de ventas');
  if (select count(*) from public.comunidad_mensajes where id = msg and autor_nombre = 'Vendedor A') <> 1 then raise exception 'Autor incorrecto o duplicación'; end if;
  begin perform public.comunidad_enviar_mensaje(sales, msg, 'Diferente'); raise exception 'Aceptó reutilizar una clave con otro texto'; exception when unique_violation then null; end;
end;
$$;

select set_config('test.user_id', '10000000-0000-0000-0000-000000000006', true);
do $$ begin
  if (select count(*) from public.comunidad_mensajes) <> 1 then raise exception 'Los vendedores no comparten el historial'; end if;
end $$;

select set_config('test.user_id', '10000000-0000-0000-0000-000000000003', true);
do $$
declare sales uuid := current_setting('test.sales_group')::uuid;
begin
  if (select count(*) from public.comunidad_listar_grupos()) <> 4 then raise exception 'Faltan los cuatro chats iniciales'; end if;
  if (select count(*) from public.comunidad_listar_grupos() where puede_conversar) <> 4 then raise exception 'Administrador no puede abrir todos los chats'; end if;
  if (select count(*) from public.comunidad_mensajes where grupo_id = sales and autor_nombre = 'Vendedor A') <> 1 then raise exception 'Administrador no pudo leer ventas'; end if;
  perform public.comunidad_enviar_mensaje(sales, gen_random_uuid(), 'Mensaje de administración a ventas');
  begin update public.comunidad_grupos set nombre = 'Intento directo' where id = sales; raise exception 'Aceptó escritura directa'; exception when insufficient_privilege then null; end;
  perform public.comunidad_crear_grupo('00000000-0000-0000-0000-000000000004', 'Seguimiento', 'Grupo de prueba');
  perform public.comunidad_enviar_mensaje(current_setting('test.admin_group')::uuid, gen_random_uuid(), 'Mensaje de administración');
end;
$$;

select set_config('test.user_id', '10000000-0000-0000-0000-000000000006', true);
do $$ begin
  if (select count(*) from public.comunidad_mensajes) <> 2
    or (select count(*) from public.comunidad_mensajes where autor_nombre = 'Admin') <> 1
    then raise exception 'El vendedor debe ver al administrador solo en el chat de ventas'; end if;
end $$;

select set_config('test.user_id', '10000000-0000-0000-0000-000000000008', true);
do $$ begin
  if exists (select 1 from public.comunidad_listar_grupos()) or exists (select 1 from public.comunidad_mensajes) then raise exception 'Administrador inactivo obtuvo acceso'; end if;
  begin perform public.comunidad_enviar_mensaje(current_setting('test.sales_group')::uuid, gen_random_uuid(), 'No permitido'); raise exception 'Administrador inactivo escribió'; exception when insufficient_privilege then null; end;
end $$;

select set_config('test.user_id', '10000000-0000-0000-0000-000000000003', true);
do $$
declare sales uuid := current_setting('test.sales_group')::uuid;
begin
  perform public.comunidad_eliminar_grupo(sales);
  if exists (select 1 from public.comunidad_listar_grupos() where id = sales)
    or exists (select 1 from public.comunidad_mensajes where grupo_id = sales) then raise exception 'Grupo archivado visible al administrador'; end if;
  begin perform public.comunidad_enviar_mensaje(sales, gen_random_uuid(), 'No permitido'); raise exception 'Administrador escribió en grupo archivado'; exception when insufficient_privilege then null; end;
end;
$$;

select set_config('test.user_id', '10000000-0000-0000-0000-000000000001', true);
do $$ begin
  if (select count(*) from public.comunidad_listar_grupos() where nombre = 'Usuarios' and rol = 'Básico' and puede_conversar) <> 1
    or (select count(*) from public.comunidad_listar_grupos()) <> 1 then raise exception 'Usuarios no se vincula de forma exclusiva a Básico'; end if;
end $$;

select set_config('test.user_id', '10000000-0000-0000-0000-000000000004', true);
do $$ begin
  if (select count(*) from public.comunidad_listar_grupos() where rol = 'Supervisor' and puede_conversar) <> 2
    or (select count(*) from public.comunidad_listar_grupos()) <> 2 then raise exception 'Fallo de aislamiento de Supervisores'; end if;
  if exists (select 1 from public.comunidad_mensajes) then raise exception 'Supervisor leyó mensajes ajenos'; end if;
end $$;

select set_config('test.user_id', '10000000-0000-0000-0000-000000000005', true);
do $$ begin
  if exists (select 1 from public.comunidad_listar_grupos()) then raise exception 'Gerente obtuvo acceso'; end if;
end $$;

select set_config('test.user_id', '10000000-0000-0000-0000-000000000007', true);
do $$ begin
  if exists (select 1 from public.comunidad_listar_grupos()) or exists (select 1 from public.comunidad_mensajes) then raise exception 'Una cuenta inactiva obtuvo acceso'; end if;
end $$;

select set_config('test.user_id', '10000000-0000-0000-0000-000000000002', true);
do $$ begin
  if exists (select 1 from public.comunidad_listar_grupos()) or exists (select 1 from public.comunidad_mensajes) then raise exception 'El grupo archivado sigue accesible'; end if;
  begin perform public.comunidad_enviar_mensaje(current_setting('test.sales_group')::uuid, gen_random_uuid(), 'Archivado'); raise exception 'Escritura tras archivar'; exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$ begin
  if (select count(*) from public.comunidad_mensajes) <> 3 then raise exception 'El archivo eliminó el historial'; end if;
  if (select count(*) from public.audit_fixture) <> 2 or exists (select 1 from public.audit_fixture where datos ? 'cuerpo') then raise exception 'Auditoría faltante o contiene mensajes'; end if;
  if has_function_privilege('anon', 'public.comunidad_enviar_mensaje(uuid,uuid,text)', 'EXECUTE')
    or has_table_privilege('anon', 'public.comunidad_mensajes', 'SELECT') then raise exception 'Acceso anónimo a Comunidad'; end if;
end $$;
rollback;
