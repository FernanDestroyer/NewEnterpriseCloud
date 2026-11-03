-- Modelo B (canónico): porta las capacidades del Modelo A retirado.
--   1. Versionado de la requisición (version + updated_by) e historial append-only.
--   2. Unidad maestra y cantidad fraccionaria en las líneas de requisición.
--   3. Cantidad fraccionaria coherente en las líneas de oferta.
--   4. Multi-moneda en la oferta (exchange_rate + moneda PEN/USD).
--   5. Índices de FK faltantes señalados por el asesor.
begin;

-- 1) Versionado + responsable de la última edición.
alter table public.requisiciones_compra
  add column if not exists version integer not null default 1,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.requisiciones_compra drop constraint if exists requisiciones_compra_version_ck;
alter table public.requisiciones_compra add constraint requisiciones_compra_version_ck check (version >= 1);

create table if not exists public.requisiciones_compra_historial (
  id uuid primary key default gen_random_uuid(),
  requisicion_id uuid not null references public.requisiciones_compra(id) on delete cascade,
  evento text not null,
  version_anterior integer,
  version_nueva integer,
  actor_id uuid default auth.uid() references auth.users(id) on delete set null,
  motivo text,
  datos_antes jsonb,
  datos_despues jsonb,
  idempotency_key text,
  created_at timestamptz not null default pg_catalog.now()
);
create unique index if not exists requisiciones_historial_idem_uidx
  on public.requisiciones_compra_historial (idempotency_key) where idempotency_key is not null;
create index if not exists requisiciones_historial_requisicion_idx
  on public.requisiciones_compra_historial (requisicion_id, created_at desc);
create index if not exists requisiciones_historial_actor_idx
  on public.requisiciones_compra_historial (actor_id);

-- Historial de solo lectura desde la API; los RPCs DEFINER insertan sin pasar por RLS.
revoke all on table public.requisiciones_compra_historial from anon;
revoke insert, update, delete on table public.requisiciones_compra_historial from authenticated;
grant select on table public.requisiciones_compra_historial to authenticated;
drop policy if exists requisiciones_historial_select on public.requisiciones_compra_historial;
create policy requisiciones_historial_select on public.requisiciones_compra_historial
  for select to authenticated using ((select app_private._tiene_permiso('compras', 'ver')));
drop trigger if exists trg_auditoria on public.requisiciones_compra_historial;
create trigger trg_auditoria after insert or update or delete on public.requisiciones_compra_historial
  for each row execute function public.fn_auditar();

-- 2) Unidad maestra y cantidad fraccionaria en las líneas.
alter table public.detalle_requisiciones_compra add column if not exists unidad text not null default 'unidad';
alter table public.detalle_requisiciones_compra add column if not exists unidad_medida_id uuid;
alter table public.detalle_requisiciones_compra alter column cantidad type numeric(14,3);
alter table public.detalle_requisiciones_compra drop constraint if exists detalle_requisiciones_compra_unidad_medida_id_fkey;
alter table public.detalle_requisiciones_compra
  add constraint detalle_requisiciones_compra_unidad_medida_id_fkey
    foreign key (unidad_medida_id) references public.unidades_medida(id) on delete restrict;
alter table public.detalle_requisiciones_compra drop constraint if exists detalle_requisiciones_cantidad_check;
alter table public.detalle_requisiciones_compra
  add constraint detalle_requisiciones_cantidad_check check (cantidad > 0);
create index if not exists detalle_requisiciones_unidad_medida_idx
  on public.detalle_requisiciones_compra (unidad_medida_id);

-- 3) Las ofertas cotizan la misma fracción que la línea solicitada.
-- subtotal es columna generada sobre cantidad; se reconstruye para poder ampliar el tipo.
alter table public.detalle_ofertas_proveedor drop column if exists subtotal;
alter table public.detalle_ofertas_proveedor alter column cantidad type numeric(14,3);
alter table public.detalle_ofertas_proveedor
  add column subtotal numeric(14,2) generated always as ((cantidad)::numeric * precio_unitario) stored;
alter table public.detalle_ofertas_proveedor drop constraint if exists detalle_ofertas_proveedor_cantidad_check;
alter table public.detalle_ofertas_proveedor
  add constraint detalle_ofertas_proveedor_cantidad_check check (cantidad > 0);

-- 4) Multi-moneda en la oferta del proveedor.
alter table public.ofertas_proveedor
  add column if not exists exchange_rate numeric(14,6) not null default 1;
alter table public.ofertas_proveedor drop constraint if exists ofertas_proveedor_exchange_rate_ck;
alter table public.ofertas_proveedor
  add constraint ofertas_proveedor_exchange_rate_ck check (exchange_rate > 0);
alter table public.ofertas_proveedor drop constraint if exists ofertas_proveedor_moneda_check;
alter table public.ofertas_proveedor
  add constraint ofertas_proveedor_moneda_check check (moneda in ('PEN', 'USD'));

-- 5) Índices de FK que faltaban.
create index if not exists requisiciones_compra_compra_idx on public.requisiciones_compra (compra_id);
create index if not exists ajustes_inventario_almacen_idx on public.ajustes_inventario (almacen_id);

commit;
