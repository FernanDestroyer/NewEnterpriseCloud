-- =============================================================================
-- ERP EnterpriseCloud · Módulo de Cotizaciones
-- Cotizar productos con precio fijo, hacer seguimiento por estados y convertir
-- la cotización aprobada en venta (descuenta stock y genera la cobranza).
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

-- 1. Nuevos estados para el ciclo de la cotización. Amplía el dominio existente
--    (superset: no afecta ningún dato ya guardado).
do $$
declare v_constraint name;
begin
  select conname into v_constraint
    from pg_constraint
   where contypid = 'public.estado_registro'::regtype and contype = 'c'
   limit 1;
  if v_constraint is not null then
    execute format('alter domain public.estado_registro drop constraint %I', v_constraint);
  end if;
  alter domain public.estado_registro add check (value in (
    'Activo','Bajo stock','Completada','Crítico','En curso','En tránsito',
    'Estable','Pendiente','Vigente','Aprobada','Rechazada','Vencida'));
end $$;

-- 2. Secuencia para los códigos legibles (COT-0001, COT-0002, ...).
create sequence if not exists public.seq_cotizaciones as bigint;

-- 3. Cabecera y líneas. La cotización NO mueve stock: solo lo hace su venta.
create table if not exists public.cotizaciones (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  cliente_id     uuid references public.clientes(id) on delete set null,
  cliente_nombre text not null,
  detalle        text not null default '',
  monto          numeric(14,2) not null default 0 check (monto >= 0),
  estado         public.estado_registro not null default 'Pendiente',
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists cotizaciones_cliente_idx on public.cotizaciones (cliente_id);
create index if not exists cotizaciones_created_idx on public.cotizaciones (created_at desc);

create table if not exists public.detalle_cotizaciones (
  id              uuid primary key default gen_random_uuid(),
  cotizacion_id   uuid not null references public.cotizaciones(id) on delete cascade,
  producto_id     uuid references public.productos(id) on delete set null,
  descripcion     text,
  cantidad        integer not null default 1 check (cantidad > 0),
  precio_unitario numeric(14,2) not null default 0 check (precio_unitario >= 0),
  subtotal        numeric(14,2) generated always as (cantidad * precio_unitario) stored
);
create index if not exists detalle_cotizaciones_cotizacion_idx on public.detalle_cotizaciones (cotizacion_id);

-- 4. Triggers de utilidad (misma convención que el resto de módulos).
drop trigger if exists trg_updated_at on public.cotizaciones;
create trigger trg_updated_at before update on public.cotizaciones
  for each row execute function public.set_updated_at();

drop trigger if exists trg_codigo on public.cotizaciones;
create trigger trg_codigo before insert on public.cotizaciones
  for each row execute function public.asignar_codigo('COT', 'public.seq_cotizaciones', 4);

drop trigger if exists trg_vincular on public.cotizaciones;
create trigger trg_vincular before insert or update of cliente_nombre on public.cotizaciones
  for each row execute function public.vincular_cliente();

drop trigger if exists trg_auditoria on public.cotizaciones;
create trigger trg_auditoria after insert or update or delete on public.cotizaciones
  for each row execute function public.fn_auditar();

-- 5. Seguridad: RLS con una política por acción, ligada al permiso del módulo.
alter table public.cotizaciones         enable row level security;
alter table public.detalle_cotizaciones enable row level security;

drop policy if exists cotizaciones_select on public.cotizaciones;
create policy cotizaciones_select on public.cotizaciones for select to authenticated
  using ((select public.tiene_permiso('cotizaciones', 'ver')));
drop policy if exists cotizaciones_insert on public.cotizaciones;
create policy cotizaciones_insert on public.cotizaciones for insert to authenticated
  with check ((select public.tiene_permiso('cotizaciones', 'crear')));
drop policy if exists cotizaciones_update on public.cotizaciones;
create policy cotizaciones_update on public.cotizaciones for update to authenticated
  using ((select public.tiene_permiso('cotizaciones', 'editar')))
  with check ((select public.tiene_permiso('cotizaciones', 'editar')));
drop policy if exists cotizaciones_delete on public.cotizaciones;
create policy cotizaciones_delete on public.cotizaciones for delete to authenticated
  using ((select public.tiene_permiso('cotizaciones', 'eliminar')));

drop policy if exists detalle_cotizaciones_select on public.detalle_cotizaciones;
create policy detalle_cotizaciones_select on public.detalle_cotizaciones for select to authenticated
  using ((select public.tiene_permiso('cotizaciones', 'ver')));
drop policy if exists detalle_cotizaciones_insert on public.detalle_cotizaciones;
create policy detalle_cotizaciones_insert on public.detalle_cotizaciones for insert to authenticated
  with check ((select public.tiene_permiso('cotizaciones', 'crear')));
drop policy if exists detalle_cotizaciones_update on public.detalle_cotizaciones;
create policy detalle_cotizaciones_update on public.detalle_cotizaciones for update to authenticated
  using ((select public.tiene_permiso('cotizaciones', 'editar')))
  with check ((select public.tiene_permiso('cotizaciones', 'editar')));
drop policy if exists detalle_cotizaciones_delete on public.detalle_cotizaciones;
create policy detalle_cotizaciones_delete on public.detalle_cotizaciones for delete to authenticated
  using ((select public.tiene_permiso('cotizaciones', 'eliminar')));

-- El rol anónimo (visitante sin sesión) no toca estas tablas.
revoke all on public.cotizaciones, public.detalle_cotizaciones from anon;
revoke all on sequence public.seq_cotizaciones from anon;

-- 6. Permisos del módulo y matriz por rol.
insert into public.permisos (modulo, accion)
select 'cotizaciones', a from unnest(array['ver','crear','editar','eliminar']) as a
on conflict (modulo, accion) do nothing;

with matriz(rol, modulo, acciones) as (values
  ('Administrador','cotizaciones', array['ver','crear','editar','eliminar']),
  ('Gerente',      'cotizaciones', array['ver','crear','editar','eliminar']),
  ('Operador',     'cotizaciones', array['ver','crear','editar','eliminar']),
  ('Vendedor',     'cotizaciones', array['ver','crear','editar']),
  ('Contador',     'cotizaciones', array['ver']),
  ('Auditor',      'cotizaciones', array['ver'])
)
insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id
from matriz m
join public.roles r on r.nombre = m.rol
join public.permisos p on p.modulo = m.modulo and p.accion = any (m.acciones)
on conflict do nothing;
