-- Módulos de Maestros, Tesorería bancaria y Comisiones (Modelo B canónico).
-- Adaptación de la migración de Smith al proyecto actual:
--   * drop policy if exists en cada política (re-aplicable).
--   * revoke de arwd heredado al authenticated + concesiones explícitas mínimas.
--   * trg_auditoria en las 14 tablas, tg_updated_at en las mutables.
--   * índices de FK (~20, junto con los únicos de Smith).
--   * btree_gist + exclusión de períodos superpuestos (liquidaciones y excepciones).
--   * idempotencia por clave/hash en movimientos bancarios, líneas de extracto,
--     pagos y ajustes de comisión (parcial: activa solo cuando la clave existe).
--   * vendedores visible también con permiso de ventas (lectura para Comisiones).
begin;

create extension if not exists btree_gist;

-- ============================================================
-- MAESTROS
-- ============================================================
create table if not exists public.transportistas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  ruc text,
  telefono text,
  email text,
  direccion text,
  estado text not null default 'Activo' check (estado in ('Activo','Inactivo')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.vendedores (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  usuario_id uuid references public.usuarios(id) on delete set null,
  email text,
  telefono text,
  sucursal_id uuid references public.sucursales(id) on delete set null,
  estado text not null default 'Activo' check (estado in ('Activo','Inactivo')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vendedores_sucursal_id_idx on public.vendedores(sucursal_id);
create unique index if not exists vendedores_usuario_uidx on public.vendedores(usuario_id) where usuario_id is not null;
create unique index if not exists transportistas_ruc_uidx on public.transportistas(ruc) where ruc is not null and ruc <> '';

create table if not exists public.catalogos_negocio (
  id uuid primary key default gen_random_uuid(),
  categoria text not null check (categoria in ('documento_venta','documento_identidad','regimen_tributario','tipo_operacion','condicion_pago','motivo_traslado','tasa_impuesto')),
  codigo text not null,
  nombre text not null,
  tasa numeric(7,4) check (tasa is null or tasa between 0 and 100),
  descripcion text,
  activo boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (categoria, codigo)
);

-- ============================================================
-- TESORERÍA BANCARIA
-- ============================================================
create table if not exists public.cuentas_bancarias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  banco text not null,
  moneda text not null default 'PEN',
  numero_enmascarado text not null,
  titular text,
  saldo_inicial numeric(14,2) not null default 0,
  fecha_saldo date not null default current_date,
  activa boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(numero_enmascarado)) between 4 and 30)
);

create table if not exists public.movimientos_bancarios (
  id uuid primary key default gen_random_uuid(),
  cuenta_bancaria_id uuid not null references public.cuentas_bancarias(id) on delete restrict,
  tipo text not null check (tipo in ('ingreso','egreso','transferencia_entrada','transferencia_salida')),
  concepto text not null,
  monto numeric(14,2) not null check (monto > 0),
  fecha date not null default current_date,
  referencia text,
  nota text,
  transferencia_id uuid,
  idempotency_key text,
  payload_hash text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists movimientos_bancarios_cuenta_fecha_idx
  on public.movimientos_bancarios(cuenta_bancaria_id, fecha desc, created_at desc);
create index if not exists movimientos_bancarios_transferencia_id_idx
  on public.movimientos_bancarios(transferencia_id);
create unique index if not exists movimientos_bancarios_idem_uidx
  on public.movimientos_bancarios(idempotency_key) where idempotency_key is not null;

create table if not exists public.conciliaciones_bancarias (
  id uuid primary key default gen_random_uuid(),
  cuenta_bancaria_id uuid not null references public.cuentas_bancarias(id) on delete restrict,
  periodo_desde date not null,
  periodo_hasta date not null,
  saldo_extracto numeric(14,2) not null,
  estado text not null default 'abierta' check (estado in ('abierta','cerrada')),
  nota text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  cerrada_at timestamptz,
  check (periodo_hasta >= periodo_desde),
  unique (cuenta_bancaria_id, periodo_desde, periodo_hasta)
);
create index if not exists conciliaciones_bancarias_cuenta_id_idx
  on public.conciliaciones_bancarias(cuenta_bancaria_id);

create table if not exists public.lineas_extracto_bancario (
  id uuid primary key default gen_random_uuid(),
  conciliacion_id uuid not null references public.conciliaciones_bancarias(id) on delete cascade,
  fecha date not null,
  descripcion text not null,
  referencia text,
  monto_firmado numeric(14,2) not null check (monto_firmado <> 0),
  movimiento_bancario_id uuid unique references public.movimientos_bancarios(id) on delete restrict,
  idempotency_key text,
  payload_hash text,
  created_at timestamptz not null default now()
);
create index if not exists lineas_extracto_bancario_conciliacion_idx
  on public.lineas_extracto_bancario(conciliacion_id, fecha);
create unique index if not exists lineas_extracto_bancario_idem_uidx
  on public.lineas_extracto_bancario(idempotency_key) where idempotency_key is not null;

-- ============================================================
-- COMISIONES
-- ============================================================
create table if not exists public.reglas_comision (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  base_calculo text not null default 'venta_neta' check (base_calculo in ('venta_neta')),
  porcentaje numeric(7,4) not null check (porcentaje between 0 and 100),
  vigente_desde date not null default current_date,
  vigente_hasta date,
  activa boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (vigente_hasta is null or vigente_hasta >= vigente_desde)
);
create unique index if not exists reglas_comision_activa_uidx on public.reglas_comision(activa) where activa;

create table if not exists public.escalas_comision (
  id uuid primary key default gen_random_uuid(),
  regla_id uuid not null references public.reglas_comision(id) on delete cascade,
  desde_ventas numeric(14,2) not null check (desde_ventas >= 0),
  hasta_ventas numeric(14,2),
  porcentaje numeric(7,4) not null check (porcentaje between 0 and 100),
  created_at timestamptz not null default now(),
  check (hasta_ventas is null or hasta_ventas > desde_ventas),
  unique (regla_id, desde_ventas)
);
create index if not exists escalas_comision_regla_id_idx on public.escalas_comision(regla_id);

create table if not exists public.excepciones_comision (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references public.vendedores(id) on delete cascade,
  porcentaje numeric(7,4) not null check (porcentaje between 0 and 100),
  vigente_desde date not null default current_date,
  vigente_hasta date,
  motivo text not null,
  activa boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (vigente_hasta is null or vigente_hasta >= vigente_desde)
);
create index if not exists excepciones_comision_vendedor_id_idx
  on public.excepciones_comision(vendedor_id);
-- Un vendedor activo no puede tener dos excepciones de vigencia superpuesta.
alter table public.excepciones_comision
  add constraint excepciones_comision_periodo_exch
  exclude using gist (vendedor_id with =, daterange(vigente_desde, vigente_hasta, '[]') with &&)
  where (activa);

create table if not exists public.ventas_vendedor (
  venta_id uuid primary key references public.ventas(id) on delete restrict,
  vendedor_id uuid not null references public.vendedores(id) on delete restrict,
  asignado_por uuid default auth.uid() references auth.users(id) on delete set null,
  asignado_at timestamptz not null default now()
);
create index if not exists ventas_vendedor_vendedor_id_idx
  on public.ventas_vendedor(vendedor_id);

create table if not exists public.liquidaciones_comision (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references public.vendedores(id) on delete restrict,
  periodo_desde date not null,
  periodo_hasta date not null,
  ventas_netas numeric(14,2) not null default 0,
  comision_calculada numeric(14,2) not null default 0,
  estado text not null default 'calculada' check (estado in ('calculada','liquidada','pagada')),
  nota text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (periodo_hasta >= periodo_desde),
  unique (vendedor_id, periodo_desde, periodo_hasta)
);
create index if not exists liquidaciones_comision_periodo_idx
  on public.liquidaciones_comision(periodo_desde, periodo_hasta);
create index if not exists liquidaciones_comision_vendedor_id_idx
  on public.liquidaciones_comision(vendedor_id);
-- El período de liquidación de un vendedor no puede solaparse con otro ya registrado.
alter table public.liquidaciones_comision
  add constraint liquidaciones_comision_periodo_exch
  exclude using gist (vendedor_id with =, daterange(periodo_desde, periodo_hasta, '[]') with &&);

create table if not exists public.ajustes_comision (
  id uuid primary key default gen_random_uuid(),
  liquidacion_id uuid not null references public.liquidaciones_comision(id) on delete restrict,
  monto numeric(14,2) not null check (monto <> 0),
  motivo text not null,
  idempotency_key text,
  payload_hash text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ajustes_comision_liquidacion_id_idx
  on public.ajustes_comision(liquidacion_id);
create unique index if not exists ajustes_comision_idem_uidx
  on public.ajustes_comision(idempotency_key) where idempotency_key is not null;

create table if not exists public.pagos_comision (
  id uuid primary key default gen_random_uuid(),
  liquidacion_id uuid not null references public.liquidaciones_comision(id) on delete restrict,
  monto numeric(14,2) not null check (monto > 0),
  fecha date not null default current_date,
  medio text not null,
  referencia text,
  cuenta_bancaria_id uuid references public.cuentas_bancarias(id) on delete restrict,
  movimiento_bancario_id uuid references public.movimientos_bancarios(id) on delete restrict,
  idempotency_key text,
  payload_hash text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists pagos_comision_liquidacion_id_idx
  on public.pagos_comision(liquidacion_id);
create index if not exists pagos_comision_cuenta_bancaria_id_idx
  on public.pagos_comision(cuenta_bancaria_id);
create index if not exists pagos_comision_movimiento_bancario_id_idx
  on public.pagos_comision(movimiento_bancario_id);
create unique index if not exists pagos_comision_idem_uidx
  on public.pagos_comision(idempotency_key) where idempotency_key is not null;

-- ============================================================
-- Catálogos iniciales habituales; ON CONFLICT conserva ajustes existentes.
-- ============================================================
insert into public.catalogos_negocio(categoria,codigo,nombre,tasa,descripcion) values
 ('documento_venta','01','Factura',null,'Comprobante de pago'),
 ('documento_venta','03','Boleta de venta',null,'Comprobante de pago'),
 ('documento_venta','07','Nota de crédito',null,'Comprobante de ajuste'),
 ('documento_venta','08','Nota de débito',null,'Comprobante de ajuste'),
 ('documento_identidad','1','DNI',null,'Documento nacional de identidad'),
 ('documento_identidad','4','Carné de extranjería',null,'Documento de identidad'),
 ('documento_identidad','6','RUC',null,'Registro Único de Contribuyentes'),
 ('documento_identidad','7','Pasaporte',null,'Documento de identidad'),
 ('regimen_tributario','general','Régimen General',null,'Validar vigencia y aplicación con asesor tributario'),
 ('regimen_tributario','rmt','Régimen MYPE Tributario',null,'Validar elegibilidad con asesor tributario'),
 ('tipo_operacion','bienes','Venta de bienes',null,null),
 ('tipo_operacion','servicios','Prestación de servicios',null,null),
 ('condicion_pago','contado','Contado',null,'Pago al momento de la operación'),
 ('condicion_pago','credito_30','Crédito a 30 días',null,'Plazo referencial configurable'),
 ('motivo_traslado','venta','Venta',null,null),
 ('motivo_traslado','compra','Compra',null,null),
 ('motivo_traslado','consignacion','Consignación',null,null),
 ('tasa_impuesto','IGV18','IGV 18 %',18,'Tasa referencial; confirmar vigencia y tratamiento tributario')
on conflict(categoria,codigo) do nothing;

-- ============================================================
-- updated_at automático en las tablas mutables.
-- ============================================================
drop trigger if exists trg_updated_at on public.transportistas;
create trigger trg_updated_at before update on public.transportistas
  for each row execute function set_updated_at();
drop trigger if exists trg_updated_at on public.vendedores;
create trigger trg_updated_at before update on public.vendedores
  for each row execute function set_updated_at();
drop trigger if exists trg_updated_at on public.catalogos_negocio;
create trigger trg_updated_at before update on public.catalogos_negocio
  for each row execute function set_updated_at();
drop trigger if exists trg_updated_at on public.cuentas_bancarias;
create trigger trg_updated_at before update on public.cuentas_bancarias
  for each row execute function set_updated_at();
drop trigger if exists trg_updated_at on public.reglas_comision;
create trigger trg_updated_at before update on public.reglas_comision
  for each row execute function set_updated_at();
drop trigger if exists trg_updated_at on public.liquidaciones_comision;
create trigger trg_updated_at before update on public.liquidaciones_comision
  for each row execute function set_updated_at();

-- ============================================================
-- Auditoría en las 14 tablas.
-- ============================================================
drop trigger if exists trg_auditoria on public.transportistas;
create trigger trg_auditoria after insert or delete or update on public.transportistas
  for each row execute function fn_auditar();
drop trigger if exists trg_auditoria on public.vendedores;
create trigger trg_auditoria after insert or delete or update on public.vendedores
  for each row execute function fn_auditar();
drop trigger if exists trg_auditoria on public.catalogos_negocio;
create trigger trg_auditoria after insert or delete or update on public.catalogos_negocio
  for each row execute function fn_auditar();
drop trigger if exists trg_auditoria on public.cuentas_bancarias;
create trigger trg_auditoria after insert or delete or update on public.cuentas_bancarias
  for each row execute function fn_auditar();
drop trigger if exists trg_auditoria on public.movimientos_bancarios;
create trigger trg_auditoria after insert or delete or update on public.movimientos_bancarios
  for each row execute function fn_auditar();
drop trigger if exists trg_auditoria on public.conciliaciones_bancarias;
create trigger trg_auditoria after insert or delete or update on public.conciliaciones_bancarias
  for each row execute function fn_auditar();
drop trigger if exists trg_auditoria on public.lineas_extracto_bancario;
create trigger trg_auditoria after insert or delete or update on public.lineas_extracto_bancario
  for each row execute function fn_auditar();
drop trigger if exists trg_auditoria on public.reglas_comision;
create trigger trg_auditoria after insert or delete or update on public.reglas_comision
  for each row execute function fn_auditar();
drop trigger if exists trg_auditoria on public.escalas_comision;
create trigger trg_auditoria after insert or delete or update on public.escalas_comision
  for each row execute function fn_auditar();
drop trigger if exists trg_auditoria on public.excepciones_comision;
create trigger trg_auditoria after insert or delete or update on public.excepciones_comision
  for each row execute function fn_auditar();
drop trigger if exists trg_auditoria on public.ventas_vendedor;
create trigger trg_auditoria after insert or delete or update on public.ventas_vendedor
  for each row execute function fn_auditar();
drop trigger if exists trg_auditoria on public.liquidaciones_comision;
create trigger trg_auditoria after insert or delete or update on public.liquidaciones_comision
  for each row execute function fn_auditar();
drop trigger if exists trg_auditoria on public.ajustes_comision;
create trigger trg_auditoria after insert or delete or update on public.ajustes_comision
  for each row execute function fn_auditar();
drop trigger if exists trg_auditoria on public.pagos_comision;
create trigger trg_auditoria after insert or delete or update on public.pagos_comision
  for each row execute function fn_auditar();

-- ============================================================
-- Superficie de API: RLS (el event trigger ya la activa; se declara también),
-- revoca del arwd heredado y concesiones mínimas explícitas.
-- ============================================================
alter table public.transportistas enable row level security;
alter table public.vendedores enable row level security;
alter table public.catalogos_negocio enable row level security;
alter table public.cuentas_bancarias enable row level security;
alter table public.movimientos_bancarios enable row level security;
alter table public.conciliaciones_bancarias enable row level security;
alter table public.lineas_extracto_bancario enable row level security;
alter table public.reglas_comision enable row level security;
alter table public.escalas_comision enable row level security;
alter table public.excepciones_comision enable row level security;
alter table public.ventas_vendedor enable row level security;
alter table public.liquidaciones_comision enable row level security;
alter table public.ajustes_comision enable row level security;
alter table public.pagos_comision enable row level security;

revoke all on public.transportistas, public.vendedores, public.catalogos_negocio,
  public.cuentas_bancarias, public.movimientos_bancarios, public.conciliaciones_bancarias,
  public.lineas_extracto_bancario, public.reglas_comision, public.escalas_comision,
  public.excepciones_comision, public.ventas_vendedor, public.liquidaciones_comision,
  public.ajustes_comision, public.pagos_comision
from public, anon, authenticated;

grant select,insert,update on public.transportistas, public.vendedores, public.catalogos_negocio to authenticated;
grant select,insert on public.cuentas_bancarias to authenticated;
grant select,insert on public.movimientos_bancarios, public.conciliaciones_bancarias,
  public.lineas_extracto_bancario to authenticated;
grant select,insert,update on public.reglas_comision, public.escalas_comision,
  public.excepciones_comision, public.ventas_vendedor to authenticated;
grant delete on public.ventas_vendedor to authenticated;
grant select,insert on public.ajustes_comision to authenticated;
grant select on public.liquidaciones_comision, public.pagos_comision to authenticated;

-- ============================================================
-- Políticas RLS (re-aplicables).
-- ============================================================
drop policy if exists transportistas_read on public.transportistas;
create policy transportistas_read on public.transportistas for select to authenticated
  using ((select public.tiene_permiso('configuracion','ver')));
drop policy if exists transportistas_insert on public.transportistas;
create policy transportistas_insert on public.transportistas for insert to authenticated
  with check ((select public.tiene_permiso('configuracion','crear')));
drop policy if exists transportistas_update on public.transportistas;
create policy transportistas_update on public.transportistas for update to authenticated
  using ((select public.tiene_permiso('configuracion','editar')))
  with check ((select public.tiene_permiso('configuracion','editar')));

drop policy if exists vendedores_read on public.vendedores;
create policy vendedores_read on public.vendedores for select to authenticated
  using ((select public.tiene_permiso('configuracion','ver')) or (select public.tiene_permiso('ventas','ver')));
drop policy if exists vendedores_insert on public.vendedores;
create policy vendedores_insert on public.vendedores for insert to authenticated
  with check ((select public.tiene_permiso('configuracion','crear')));
drop policy if exists vendedores_update on public.vendedores;
create policy vendedores_update on public.vendedores for update to authenticated
  using ((select public.tiene_permiso('configuracion','editar')))
  with check ((select public.tiene_permiso('configuracion','editar')));

drop policy if exists catalogos_negocio_read on public.catalogos_negocio;
create policy catalogos_negocio_read on public.catalogos_negocio for select to authenticated
  using ((select public.tiene_permiso('configuracion','ver')));
drop policy if exists catalogos_negocio_insert on public.catalogos_negocio;
create policy catalogos_negocio_insert on public.catalogos_negocio for insert to authenticated
  with check ((select public.tiene_permiso('configuracion','crear')));
drop policy if exists catalogos_negocio_update on public.catalogos_negocio;
create policy catalogos_negocio_update on public.catalogos_negocio for update to authenticated
  using ((select public.tiene_permiso('configuracion','editar')))
  with check ((select public.tiene_permiso('configuracion','editar')));

drop policy if exists cuentas_bancarias_read on public.cuentas_bancarias;
create policy cuentas_bancarias_read on public.cuentas_bancarias for select to authenticated
  using ((select public.tiene_permiso('finanzas','ver')));
drop policy if exists cuentas_bancarias_insert on public.cuentas_bancarias;
create policy cuentas_bancarias_insert on public.cuentas_bancarias for insert to authenticated
  with check ((select public.tiene_permiso('finanzas','crear')));

drop policy if exists movimientos_bancarios_read on public.movimientos_bancarios;
create policy movimientos_bancarios_read on public.movimientos_bancarios for select to authenticated
  using ((select public.tiene_permiso('finanzas','ver')));
drop policy if exists movimientos_bancarios_insert on public.movimientos_bancarios;
create policy movimientos_bancarios_insert on public.movimientos_bancarios for insert to authenticated
  with check ((select public.tiene_permiso('finanzas','crear')));
drop policy if exists movimientos_bancarios_update on public.movimientos_bancarios;
create policy movimientos_bancarios_update on public.movimientos_bancarios for update to authenticated
  using ((select public.tiene_permiso('finanzas','editar')))
  with check ((select public.tiene_permiso('finanzas','editar')));

drop policy if exists conciliaciones_bancarias_read on public.conciliaciones_bancarias;
create policy conciliaciones_bancarias_read on public.conciliaciones_bancarias for select to authenticated
  using ((select public.tiene_permiso('finanzas','ver')));
drop policy if exists conciliaciones_bancarias_insert on public.conciliaciones_bancarias;
create policy conciliaciones_bancarias_insert on public.conciliaciones_bancarias for insert to authenticated
  with check ((select public.tiene_permiso('finanzas','crear')));

drop policy if exists lineas_extracto_bancario_read on public.lineas_extracto_bancario;
create policy lineas_extracto_bancario_read on public.lineas_extracto_bancario for select to authenticated
  using ((select public.tiene_permiso('finanzas','ver')));
drop policy if exists lineas_extracto_bancario_insert on public.lineas_extracto_bancario;
create policy lineas_extracto_bancario_insert on public.lineas_extracto_bancario for insert to authenticated
  with check ((select public.tiene_permiso('finanzas','editar'))
    and exists (select 1 from public.conciliaciones_bancarias c
                where c.id = conciliacion_id and c.estado = 'abierta'));

drop policy if exists reglas_comision_read on public.reglas_comision;
create policy reglas_comision_read on public.reglas_comision for select to authenticated
  using ((select public.tiene_permiso('ventas','ver')));
drop policy if exists reglas_comision_write on public.reglas_comision;
create policy reglas_comision_write on public.reglas_comision for all to authenticated
  using ((select public.tiene_permiso('ventas','editar')))
  with check ((select public.tiene_permiso('ventas','editar')));

drop policy if exists escalas_comision_read on public.escalas_comision;
create policy escalas_comision_read on public.escalas_comision for select to authenticated
  using ((select public.tiene_permiso('ventas','ver')));
drop policy if exists escalas_comision_write on public.escalas_comision;
create policy escalas_comision_write on public.escalas_comision for all to authenticated
  using ((select public.tiene_permiso('ventas','editar')))
  with check ((select public.tiene_permiso('ventas','editar')));

drop policy if exists excepciones_comision_read on public.excepciones_comision;
create policy excepciones_comision_read on public.excepciones_comision for select to authenticated
  using ((select public.tiene_permiso('ventas','ver')));
drop policy if exists excepciones_comision_write on public.excepciones_comision;
create policy excepciones_comision_write on public.excepciones_comision for all to authenticated
  using ((select public.tiene_permiso('ventas','editar')))
  with check ((select public.tiene_permiso('ventas','editar')));

drop policy if exists ventas_vendedor_read on public.ventas_vendedor;
create policy ventas_vendedor_read on public.ventas_vendedor for select to authenticated
  using ((select public.tiene_permiso('ventas','ver')));
drop policy if exists ventas_vendedor_write on public.ventas_vendedor;
create policy ventas_vendedor_write on public.ventas_vendedor for all to authenticated
  using ((select public.tiene_permiso('ventas','editar')))
  with check ((select public.tiene_permiso('ventas','editar')));

drop policy if exists liquidaciones_comision_read on public.liquidaciones_comision;
create policy liquidaciones_comision_read on public.liquidaciones_comision for select to authenticated
  using ((select public.tiene_permiso('ventas','ver')));

drop policy if exists ajustes_comision_read on public.ajustes_comision;
create policy ajustes_comision_read on public.ajustes_comision for select to authenticated
  using ((select public.tiene_permiso('ventas','ver')));
drop policy if exists ajustes_comision_insert on public.ajustes_comision;
create policy ajustes_comision_insert on public.ajustes_comision for insert to authenticated
  with check ((select public.tiene_permiso('ventas','editar')));

drop policy if exists pagos_comision_read on public.pagos_comision;
create policy pagos_comision_read on public.pagos_comision for select to authenticated
  using ((select public.tiene_permiso('finanzas','ver')));

commit;
