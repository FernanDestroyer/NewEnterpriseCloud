-- Permisos individuales: cada fila sobreescribe un permiso del rol para una cuenta.
alter table public.permisos drop constraint if exists permisos_accion_check;
alter table public.permisos
  add constraint permisos_accion_check
  check (accion in ('ver', 'crear', 'editar', 'eliminar', 'importar'));

create table if not exists public.usuario_permisos (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  permiso_id uuid not null references public.permisos(id) on delete cascade,
  permitido boolean not null,
  actualizado_por uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (usuario_id, permiso_id)
);

alter table public.usuario_permisos enable row level security;
revoke all on public.usuario_permisos from anon;
grant select on public.usuario_permisos to authenticated;

drop policy if exists usuario_permisos_select on public.usuario_permisos;
create policy usuario_permisos_select on public.usuario_permisos for select to authenticated
  using (usuario_id = (select auth.uid()) or (select public.es_admin()));

-- Las escrituras pasan por guardar_permisos_usuario para validar administrador,
-- cuenta objetivo y reemplazar la matriz en una sola transacción.
drop policy if exists usuario_permisos_admin on public.usuario_permisos;
create policy usuario_permisos_admin on public.usuario_permisos for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

create or replace function public.tiene_permiso(p_modulo text, p_accion text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.usuarios u
    where u.id = (select auth.uid()) and u.activo
      and coalesce(
        (
          select up.permitido
          from public.usuario_permisos up
          join public.permisos p on p.id = up.permiso_id
          where up.usuario_id = u.id and p.modulo = p_modulo and p.accion = p_accion
        ),
        exists (
          select 1
          from public.rol_permisos rp
          join public.permisos p on p.id = rp.permiso_id
          where rp.rol_id = u.rol_id and p.modulo = p_modulo and p.accion = p_accion
        )
      )
  );
$$;
revoke execute on function public.tiene_permiso(text, text) from public, anon;
grant execute on function public.tiene_permiso(text, text) to authenticated;

-- RPC transaccional. SECURITY DEFINER es necesario para reemplazar permisos de
-- otro usuario bajo RLS; auth.uid(), el rol administrador y la cuenta destino
-- se validan aquí, con search_path fijo y EXECUTE solo para authenticated.
create or replace function public.guardar_permisos_usuario(p_usuario_id uuid, p_overrides jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  target_role text;
  target_role_id uuid;
begin
  if (select auth.uid()) is null or not public.es_admin() then
    raise exception 'Solo un administrador puede modificar permisos personalizados.' using errcode = '42501';
  end if;
  if p_usuario_id = (select auth.uid()) then
    raise exception 'No puedes modificar tus propios permisos.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_overrides, '[]'::jsonb)) <> 'array' then
    raise exception 'La lista de permisos no es válida.' using errcode = '22023';
  end if;
  select r.nombre, u.rol_id into target_role, target_role_id
  from public.usuarios u left join public.roles r on r.id = u.rol_id
  where u.id = p_usuario_id;
  if not found then
    raise exception 'No existe la cuenta seleccionada.' using errcode = 'P0002';
  end if;
  if target_role = 'Administrador' then
    raise exception 'No se pueden personalizar cuentas administradoras.' using errcode = '42501';
  end if;

  delete from public.usuario_permisos where usuario_id = p_usuario_id;
  insert into public.usuario_permisos (usuario_id, permiso_id, permitido, actualizado_por, updated_at)
  select p_usuario_id, x.permiso_id, x.permitido, (select auth.uid()), now()
  from jsonb_to_recordset(coalesce(p_overrides, '[]'::jsonb)) as x(permiso_id uuid, permitido boolean);

  if exists (
    with effective as (
      select p.modulo, p.accion,
        coalesce(up.permitido, exists (
          select 1 from public.rol_permisos rp
          where rp.rol_id = target_role_id and rp.permiso_id = p.id
        )) as permitido
      from public.permisos p
      left join public.usuario_permisos up on up.usuario_id = p_usuario_id and up.permiso_id = p.id
    )
    select 1 from effective action
    left join effective view_permission on view_permission.modulo = action.modulo and view_permission.accion = 'ver'
    where action.accion <> 'ver' and action.permitido and not coalesce(view_permission.permitido, false)
  ) then
    raise exception 'Para conceder acciones de un módulo, también debe permitirse Consultar.' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.guardar_permisos_usuario(uuid, jsonb) from public, anon;
grant execute on function public.guardar_permisos_usuario(uuid, jsonb) to authenticated;

-- Permisos de importación para los CSV disponibles en la aplicación.
insert into public.permisos (modulo, accion)
values ('clientes', 'importar'), ('proveedores', 'importar')
on conflict (modulo, accion) do nothing;

-- La política inicial de importación permitía importar clientes a todos salvo
-- Vendedor. Se reemplaza por los valores predeterminados acordados: Admin en
-- clientes y proveedores; Vendedor solo en proveedores. El resto se personaliza.
delete from public.rol_permisos rp
using public.roles r, public.permisos p
where rp.rol_id = r.id and rp.permiso_id = p.id and p.accion = 'importar';

insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id
from public.roles r cross join public.permisos p
where p.accion = 'importar'
  and ((r.nombre = 'Administrador' and p.modulo in ('clientes', 'proveedores'))
    or (r.nombre = 'Vendedor' and p.modulo = 'proveedores'))
on conflict do nothing;

-- La importación inserta registros y el catálogo asociado a proveedores.
drop policy if exists clientes_import_insert on public.clientes;
create policy clientes_import_insert on public.clientes for insert to authenticated
  with check ((select public.tiene_permiso('clientes', 'importar')));

drop policy if exists proveedores_import_insert on public.proveedores;
create policy proveedores_import_insert on public.proveedores for insert to authenticated
  with check ((select public.tiene_permiso('proveedores', 'importar')));

drop policy if exists proveedor_productos_import_insert on public.proveedor_productos;
create policy proveedor_productos_import_insert on public.proveedor_productos for insert to authenticated
  with check ((select public.tiene_permiso('proveedores', 'importar')));

drop policy if exists proveedor_productos_import_select on public.proveedor_productos;
create policy proveedor_productos_import_select on public.proveedor_productos for select to authenticated
  using ((select public.tiene_permiso('proveedores', 'importar')));
