-- Restaura las tablas del Modelo A de compras (solicitudes / ofertas) que la
-- migración 20261102030000 retiró. El módulo de Compras de Erick (pantallas de
-- solicitud interna, comparativo de ofertas y conversión a orden) consume este
-- modelo; el Modelo B (requisiciones_compra / ofertas_proveedor) permanece en la
-- base como backend alternativo, sin pantallas activas.
--
-- Solo se recrean tablas, índices, RLS y políticas. Las funciones del ciclo se
-- crean/actualizan en las migraciones 20261104000000 y siguientes, para no
-- sobrescribir las versiones idempotentes más recientes.
--
-- Es idempotente: en la base remota las tablas ya existen (fueron restauradas
-- manualmente durante la integración de Erick) y este script no las altera.

begin;

create table if not exists public.solicitudes_compra (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('REQ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  solicitante_id uuid not null references public.usuarios(id) on delete restrict default auth.uid(),
  estado text not null default 'Borrador'
    check (estado in ('Borrador', 'Abierta', 'Cerrada', 'Cancelada')),
  fecha_necesidad date,
  detalle text not null default '',
  moneda char(3) not null default 'PEN' check (moneda = 'PEN'),
  seleccion_oferta_id uuid,
  created_by uuid not null default auth.uid() references public.usuarios(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.solicitud_compra_lineas (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references public.solicitudes_compra(id) on delete cascade,
  producto_id uuid references public.productos(id) on delete restrict,
  descripcion text not null check (length(trim(descripcion)) between 2 and 240),
  cantidad numeric(14,3) not null check (cantidad > 0),
  unidad text not null check (length(trim(unidad)) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (solicitud_id, id)
);

create table if not exists public.ofertas_compra (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('OFE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  solicitud_id uuid not null references public.solicitudes_compra(id) on delete restrict,
  proveedor_id uuid not null references public.proveedores(id) on delete restrict,
  vigencia_hasta date,
  plazo_entrega_dias integer check (plazo_entrega_dias is null or plazo_entrega_dias >= 0),
  condiciones text not null default '',
  estado text not null default 'Vigente' check (estado in ('Vigente', 'Retirada')),
  created_by uuid not null default auth.uid() references public.usuarios(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (solicitud_id, proveedor_id),
  unique (solicitud_id, id)
);

create table if not exists public.detalle_ofertas_compra (
  id uuid primary key default gen_random_uuid(),
  oferta_id uuid not null references public.ofertas_compra(id) on delete cascade,
  solicitud_linea_id uuid not null references public.solicitud_compra_lineas(id) on delete restrict,
  precio_unitario numeric(14,4) not null check (precio_unitario >= 0),
  created_at timestamptz not null default now(),
  unique (oferta_id, solicitud_linea_id)
);

do $constraint$
begin
  if not exists (select 1 from pg_constraint where conname = 'solicitudes_compra_seleccion_fk') then
    alter table public.solicitudes_compra add constraint solicitudes_compra_seleccion_fk
      foreign key (seleccion_oferta_id) references public.ofertas_compra(id) on delete restrict;
  end if;
end
$constraint$;

create index if not exists solicitudes_compra_estado_fecha_idx on public.solicitudes_compra (estado, created_at desc);
create index if not exists solicitud_compra_lineas_solicitud_idx on public.solicitud_compra_lineas (solicitud_id);
create index if not exists ofertas_compra_solicitud_idx on public.ofertas_compra (solicitud_id, estado);
create index if not exists detalle_ofertas_compra_oferta_idx on public.detalle_ofertas_compra (oferta_id);

alter table public.solicitudes_compra enable row level security;
alter table public.solicitud_compra_lineas enable row level security;
alter table public.ofertas_compra enable row level security;
alter table public.detalle_ofertas_compra enable row level security;

grant select, insert, update, delete on public.solicitudes_compra to authenticated;
grant select, insert, update, delete on public.solicitud_compra_lineas to authenticated;
grant select, insert, update, delete on public.ofertas_compra to authenticated;
grant select, insert, update, delete on public.detalle_ofertas_compra to authenticated;

drop policy if exists solicitudes_compra_select on public.solicitudes_compra;
create policy solicitudes_compra_select on public.solicitudes_compra for select to authenticated
  using ((select app_private._tiene_permiso('compras', 'ver')));
drop policy if exists solicitudes_compra_insert on public.solicitudes_compra;
create policy solicitudes_compra_insert on public.solicitudes_compra for insert to authenticated
  with check ((select app_private._tiene_permiso('compras', 'crear')) and created_by = (select auth.uid()) and solicitante_id = (select auth.uid()));
drop policy if exists solicitudes_compra_update on public.solicitudes_compra;
create policy solicitudes_compra_update on public.solicitudes_compra for update to authenticated
  using ((select app_private._tiene_permiso('compras', 'editar')))
  with check ((select app_private._tiene_permiso('compras', 'editar')));
drop policy if exists solicitudes_compra_delete on public.solicitudes_compra;
create policy solicitudes_compra_delete on public.solicitudes_compra for delete to authenticated
  using ((select app_private._tiene_permiso('compras', 'eliminar')) and estado = 'Borrador');

drop policy if exists solicitud_compra_lineas_select on public.solicitud_compra_lineas;
create policy solicitud_compra_lineas_select on public.solicitud_compra_lineas for select to authenticated
  using ((select app_private._tiene_permiso('compras', 'ver')));
drop policy if exists solicitud_compra_lineas_insert on public.solicitud_compra_lineas;
create policy solicitud_compra_lineas_insert on public.solicitud_compra_lineas for insert to authenticated
  with check ((select app_private._tiene_permiso('compras', 'crear')) and exists (
    select 1 from public.solicitudes_compra s where s.id = solicitud_id and s.estado in ('Borrador', 'Abierta')
  ));
drop policy if exists solicitud_compra_lineas_update on public.solicitud_compra_lineas;
create policy solicitud_compra_lineas_update on public.solicitud_compra_lineas for update to authenticated
  using ((select app_private._tiene_permiso('compras', 'editar')))
  with check ((select app_private._tiene_permiso('compras', 'editar')));
drop policy if exists solicitud_compra_lineas_delete on public.solicitud_compra_lineas;
create policy solicitud_compra_lineas_delete on public.solicitud_compra_lineas for delete to authenticated
  using ((select app_private._tiene_permiso('compras', 'editar')));

drop policy if exists ofertas_compra_select on public.ofertas_compra;
create policy ofertas_compra_select on public.ofertas_compra for select to authenticated
  using ((select app_private._tiene_permiso('compras', 'ver')));
drop policy if exists ofertas_compra_insert on public.ofertas_compra;
create policy ofertas_compra_insert on public.ofertas_compra for insert to authenticated
  with check ((select app_private._tiene_permiso('compras', 'crear')) and created_by = (select auth.uid()) and exists (
    select 1 from public.solicitudes_compra s where s.id = solicitud_id and s.estado = 'Abierta'
  ));
drop policy if exists ofertas_compra_update on public.ofertas_compra;
create policy ofertas_compra_update on public.ofertas_compra for update to authenticated
  using ((select app_private._tiene_permiso('compras', 'editar')))
  with check ((select app_private._tiene_permiso('compras', 'editar')));
drop policy if exists ofertas_compra_delete on public.ofertas_compra;
create policy ofertas_compra_delete on public.ofertas_compra for delete to authenticated
  using ((select app_private._tiene_permiso('compras', 'eliminar')) and estado = 'Retirada');

drop policy if exists detalle_ofertas_compra_select on public.detalle_ofertas_compra;
create policy detalle_ofertas_compra_select on public.detalle_ofertas_compra for select to authenticated
  using ((select app_private._tiene_permiso('compras', 'ver')));
drop policy if exists detalle_ofertas_compra_insert on public.detalle_ofertas_compra;
create policy detalle_ofertas_compra_insert on public.detalle_ofertas_compra for insert to authenticated
  with check ((select app_private._tiene_permiso('compras', 'crear')) and exists (
    select 1 from public.ofertas_compra o join public.solicitud_compra_lineas l on l.solicitud_id = o.solicitud_id
    where o.id = oferta_id and o.estado = 'Vigente' and l.id = solicitud_linea_id
  ));
drop policy if exists detalle_ofertas_compra_update on public.detalle_ofertas_compra;
create policy detalle_ofertas_compra_update on public.detalle_ofertas_compra for update to authenticated
  using ((select app_private._tiene_permiso('compras', 'editar')))
  with check ((select app_private._tiene_permiso('compras', 'editar')));
drop policy if exists detalle_ofertas_compra_delete on public.detalle_ofertas_compra;
create policy detalle_ofertas_compra_delete on public.detalle_ofertas_compra for delete to authenticated
  using ((select app_private._tiene_permiso('compras', 'editar')));

do $audit$
declare v_table text;
begin
  foreach v_table in array array['solicitudes_compra','solicitud_compra_lineas','ofertas_compra','detalle_ofertas_compra'] loop
    if to_regprocedure('public.fn_auditar()') is not null and not exists (
      select 1 from pg_trigger t where t.tgrelid = to_regclass(format('public.%I', v_table))
        and t.tgfoid = 'public.fn_auditar()'::regprocedure and not t.tgisinternal
    ) then
      execute format('create trigger trg_auditoria after insert or update or delete on public.%I for each row execute function public.fn_auditar()', v_table);
    end if;
  end loop;
end
$audit$;

commit;
