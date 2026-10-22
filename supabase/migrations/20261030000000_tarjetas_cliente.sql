-- =============================================================================
-- ERP EnterpriseCloud · Tarjetas en la cuenta del cliente
-- 1. Tabla tarjetas_cliente: solo datos NO sensibles (marca, últimos 4, titular,
--    vencimiento). Nunca el número completo ni el CVV.
-- 2. La venta guarda la tarjeta usada (id + marca/últimos 4 al momento de pagar).
-- 3. Retira el medio "Tarjeta (Culqi)" y las columnas de Culqi si se crearon antes.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar datos de negocio.
-- =============================================================================

create table if not exists public.tarjetas_cliente (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  marca      text not null check (marca in ('Visa','Mastercard','American Express','Diners Club','Otra')),
  ultimos4   text not null check (ultimos4 ~ '^[0-9]{4}$'),
  titular    text not null check (char_length(titular) >= 3),
  vence_mes  integer not null check (vence_mes between 1 and 12),
  vence_anio integer not null check (vence_anio between 2000 and 2999),
  activo     boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (cliente_id, ultimos4, marca, vence_mes, vence_anio)
);
create index if not exists tarjetas_cliente_cliente_idx on public.tarjetas_cliente (cliente_id) where activo;

alter table public.tarjetas_cliente enable row level security;
drop policy if exists tarjetas_cliente_select on public.tarjetas_cliente;
create policy tarjetas_cliente_select on public.tarjetas_cliente for select to authenticated
  using ((select public.tiene_permiso('ventas', 'ver')) or (select public.tiene_permiso('clientes', 'ver')));
drop policy if exists tarjetas_cliente_insert on public.tarjetas_cliente;
create policy tarjetas_cliente_insert on public.tarjetas_cliente for insert to authenticated
  with check ((select public.tiene_permiso('ventas', 'crear')) or (select public.tiene_permiso('clientes', 'crear')));
drop policy if exists tarjetas_cliente_update on public.tarjetas_cliente;
create policy tarjetas_cliente_update on public.tarjetas_cliente for update to authenticated
  using ((select public.tiene_permiso('ventas', 'crear')) or (select public.tiene_permiso('clientes', 'editar')))
  with check ((select public.tiene_permiso('ventas', 'crear')) or (select public.tiene_permiso('clientes', 'editar')));
grant select, insert, update on public.tarjetas_cliente to authenticated;

alter table public.ventas add column if not exists tarjeta_id uuid references public.tarjetas_cliente(id) on delete set null;
alter table public.ventas add column if not exists tarjeta_marca text;
alter table public.ventas add column if not exists tarjeta_ultimos4 text;

-- Limpieza de la versión anterior (Culqi), si llegó a ejecutarse.
drop index if exists public.ventas_culqi_charge_uidx;
alter table public.ventas drop column if exists culqi_charge_id;
update public.metodos_pago set activo = false where nombre = 'Tarjeta (Culqi)';
