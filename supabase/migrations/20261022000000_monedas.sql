-- =============================================================================
-- ERP EnterpriseCloud · Catálogo de tipos de moneda
-- La moneda base es el sol peruano (PEN). Se pueden agregar otras y
-- desactivar las que fallen, igual que los métodos de pago.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

create table if not exists public.monedas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  codigo     text not null unique,
  simbolo    text not null default 'S/',
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.monedas (nombre, codigo, simbolo)
values ('Sol peruano', 'PEN', 'S/')
on conflict (codigo) do nothing;
alter table public.monedas enable row level security;
drop policy if exists monedas_select on public.monedas;
create policy monedas_select on public.monedas for select to authenticated
  using ((select public.tiene_permiso('finanzas', 'ver')));
drop policy if exists monedas_insert on public.monedas;
create policy monedas_insert on public.monedas for insert to authenticated
  with check ((select public.tiene_permiso('finanzas', 'crear')));
drop policy if exists monedas_update on public.monedas;
create policy monedas_update on public.monedas for update to authenticated
  using ((select public.tiene_permiso('finanzas', 'editar')))
  with check ((select public.tiene_permiso('finanzas', 'editar')));

grant select, insert, update, delete on public.monedas to authenticated;
