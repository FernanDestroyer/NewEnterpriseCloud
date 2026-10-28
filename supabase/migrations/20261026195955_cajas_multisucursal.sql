begin;

create table public.cajas (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references public.sucursales(id) on delete restrict,
  codigo text not null,
  nombre text not null,
  ubicacion text,
  responsable_id uuid references public.usuarios(id) on delete set null,
  activo boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cajas_codigo_formato check (codigo = upper(trim(codigo)) and codigo ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'),
  constraint cajas_nombre_no_vacio check (length(trim(nombre)) between 2 and 120)
);

create unique index cajas_sucursal_codigo_uidx
  on public.cajas (sucursal_id, lower(codigo));
create index cajas_sucursal_activa_idx
  on public.cajas (sucursal_id, activo, nombre);

alter table public.caja_turnos
  add column caja_id uuid references public.cajas(id) on delete restrict;

drop index if exists public.caja_turnos_un_solo_abierto_uidx;

-- Cada caja operativa puede tener un turno abierto. La restricción separada
-- conserva la unicidad del turno legado que todavía no tenía caja asociada.
create unique index caja_turnos_un_abierto_por_caja_uidx
  on public.caja_turnos (caja_id)
  where estado = 'Abierto' and caja_id is not null;
create unique index caja_turnos_un_abierto_legado_uidx
  on public.caja_turnos ((estado))
  where estado = 'Abierto' and caja_id is null;
create index caja_turnos_caja_fecha_idx
  on public.caja_turnos (caja_id, abierto_en desc);

alter table public.cajas enable row level security;
revoke all on public.cajas from anon, service_role;
grant select, insert, update, delete on public.cajas to authenticated;

create policy cajas_select on public.cajas
  for select to authenticated
  using ((select public.tiene_permiso('finanzas', 'ver')));
create policy cajas_insert on public.cajas
  for insert to authenticated
  with check ((select public.tiene_permiso('finanzas', 'crear')));
create policy cajas_update on public.cajas
  for update to authenticated
  using ((select public.tiene_permiso('finanzas', 'editar')))
  with check ((select public.tiene_permiso('finanzas', 'editar')));
create policy cajas_delete on public.cajas
  for delete to authenticated
  using ((select public.tiene_permiso('finanzas', 'eliminar')));

-- El formulario de cajas necesita consultar nombres/códigos de sucursal.
-- El permiso de Finanzas solo amplía SELECT; la gestión de sucursales sigue
-- reservada al módulo de Configuración.
create policy sucursales_finanzas_read on public.sucursales
  for select to authenticated
  using ((select public.tiene_permiso('finanzas', 'ver')));

create trigger cajas_set_updated_at
  before update on public.cajas
  for each row execute function public.set_updated_at();
create trigger trg_auditoria
  after insert or update or delete on public.cajas
  for each row execute function public.fn_auditar();

notify pgrst, 'reload schema';
commit;
