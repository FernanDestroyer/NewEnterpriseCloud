-- =============================================================================
-- ERP EnterpriseCloud · Centro de Mantenimiento (fase 1)
-- 1. Turnos de caja para apertura y cierre con descuadre (Tesorería -> Caja).
-- 2. Medio de pago en cuentas (Efectivo, Yape, Plin, Tarjeta, Transferencia).
-- 3. Descuento % en ventas (solo roles con acceso a finanzas).
-- 4. Catálogo de métodos de pago gestionable.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

-- 1. Turnos de caja.
create table if not exists public.caja_turnos (
  id                uuid primary key default gen_random_uuid(),
  abierto_por_email text,
  abierto_en        timestamptz not null default now(),
  monto_inicial     numeric(14,2) not null default 0 check (monto_inicial >= 0),
  estado            text not null default 'Abierto' check (estado in ('Abierto', 'Cerrado')),
  cerrado_en        timestamptz,
  conteo            jsonb not null default '{}',
  notas             text not null default ''
);
alter table public.caja_turnos enable row level security;
drop policy if exists caja_turnos_select on public.caja_turnos;
create policy caja_turnos_select on public.caja_turnos for select to authenticated
  using ((select public.tiene_permiso('finanzas', 'ver')));
drop policy if exists caja_turnos_insert on public.caja_turnos;
create policy caja_turnos_insert on public.caja_turnos for insert to authenticated
  with check ((select public.tiene_permiso('finanzas', 'crear')));
drop policy if exists caja_turnos_update on public.caja_turnos;
create policy caja_turnos_update on public.caja_turnos for update to authenticated
  using ((select public.tiene_permiso('finanzas', 'editar')))
  with check ((select public.tiene_permiso('finanzas', 'editar')));

-- 2. Medio de pago en la cuenta (nulo = Efectivo / registro antiguo).
alter table public.pagos add column if not exists medio_pago text;

-- 3. Descuento % en la venta (0-100, se aplica al subtotal de productos).
alter table public.ventas add column if not exists descuento numeric(6,2) not null default 0
  check (descuento >= 0 and descuento <= 100);

-- 4. Catálogo de métodos de pago.
create table if not exists public.metodos_pago (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.metodos_pago (nombre)
values ('Efectivo'), ('Yape'), ('Plin'), ('Tarjeta'), ('Transferencia bancaria')
on conflict (nombre) do nothing;
alter table public.metodos_pago enable row level security;
drop policy if exists metodos_pago_select on public.metodos_pago;
create policy metodos_pago_select on public.metodos_pago for select to authenticated
  using ((select public.tiene_permiso('finanzas', 'ver')));
drop policy if exists metodos_pago_insert on public.metodos_pago;
create policy metodos_pago_insert on public.metodos_pago for insert to authenticated
  with check ((select public.tiene_permiso('finanzas', 'crear')));
drop policy if exists metodos_pago_update on public.metodos_pago;
create policy metodos_pago_update on public.metodos_pago for update to authenticated
  using ((select public.tiene_permiso('finanzas', 'editar')))
  with check ((select public.tiene_permiso('finanzas', 'editar')));

-- 5. Privilegios para las tablas nuevas (y futuras) del esquema público.
grant select, insert, update, delete on public.caja_turnos to authenticated;
grant select, insert, update, delete on public.metodos_pago to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
