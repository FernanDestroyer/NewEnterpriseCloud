-- Módulos de Maestros, Tesorería bancaria y Comisiones.
-- Migración forward-only: conserva las entidades y registros operativos existentes.
begin;

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
create unique index if not exists vendedores_usuario_uidx on public.vendedores(usuario_id) where usuario_id is not null;
create unique index if not exists transportistas_ruc_uidx on public.transportistas(ruc) where ruc is not null and ruc<>'';
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
  unique (categoria,codigo)
);

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
  check (length(trim(numero_enmascarado)) between 4 and 30)
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
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists movimientos_bancarios_cuenta_fecha_idx on public.movimientos_bancarios(cuenta_bancaria_id,fecha desc,created_at desc);
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
  unique (cuenta_bancaria_id,periodo_desde,periodo_hasta)
);
create table if not exists public.lineas_extracto_bancario (
  id uuid primary key default gen_random_uuid(),
  conciliacion_id uuid not null references public.conciliaciones_bancarias(id) on delete cascade,
  fecha date not null,
  descripcion text not null,
  referencia text,
  monto_firmado numeric(14,2) not null check (monto_firmado <> 0),
  movimiento_bancario_id uuid unique references public.movimientos_bancarios(id) on delete restrict,
  created_at timestamptz not null default now()
);

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
  unique (regla_id,desde_ventas)
);
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
create table if not exists public.ventas_vendedor (
  venta_id uuid primary key references public.ventas(id) on delete restrict,
  vendedor_id uuid not null references public.vendedores(id) on delete restrict,
  asignado_por uuid default auth.uid() references auth.users(id) on delete set null,
  asignado_at timestamptz not null default now()
);
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
  unique (vendedor_id,periodo_desde,periodo_hasta)
);
create table if not exists public.ajustes_comision (
  id uuid primary key default gen_random_uuid(),
  liquidacion_id uuid not null references public.liquidaciones_comision(id) on delete restrict,
  monto numeric(14,2) not null check (monto <> 0),
  motivo text not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.pagos_comision (
  id uuid primary key default gen_random_uuid(),
  liquidacion_id uuid not null references public.liquidaciones_comision(id) on delete restrict,
  monto numeric(14,2) not null check (monto > 0),
  fecha date not null default current_date,
  medio text not null,
  referencia text,
  cuenta_bancaria_id uuid references public.cuentas_bancarias(id) on delete restrict,
  movimiento_bancario_id uuid references public.movimientos_bancarios(id) on delete restrict,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists liquidaciones_comision_periodo_idx on public.liquidaciones_comision(periodo_desde,periodo_hasta);

-- Catálogos iniciales habituales; ON CONFLICT conserva cualquier ajuste existente.
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
-- Marcas de modificación para mantener consistentes los campos updated_at.
drop trigger if exists transportistas_set_updated_at on public.transportistas;
create trigger transportistas_set_updated_at before update on public.transportistas for each row execute function public.set_updated_at();
drop trigger if exists vendedores_set_updated_at on public.vendedores;
create trigger vendedores_set_updated_at before update on public.vendedores for each row execute function public.set_updated_at();
drop trigger if exists catalogos_negocio_set_updated_at on public.catalogos_negocio;
create trigger catalogos_negocio_set_updated_at before update on public.catalogos_negocio for each row execute function public.set_updated_at();
drop trigger if exists cuentas_bancarias_set_updated_at on public.cuentas_bancarias;
create trigger cuentas_bancarias_set_updated_at before update on public.cuentas_bancarias for each row execute function public.set_updated_at();
drop trigger if exists reglas_comision_set_updated_at on public.reglas_comision;
create trigger reglas_comision_set_updated_at before update on public.reglas_comision for each row execute function public.set_updated_at();
drop trigger if exists liquidaciones_comision_set_updated_at on public.liquidaciones_comision;
create trigger liquidaciones_comision_set_updated_at before update on public.liquidaciones_comision for each row execute function public.set_updated_at();

-- RLS automático está activo en la instalación actual; se declara también para instalaciones anteriores.
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
revoke all on public.transportistas,public.vendedores,public.catalogos_negocio,public.cuentas_bancarias,public.movimientos_bancarios,public.conciliaciones_bancarias,public.lineas_extracto_bancario,public.reglas_comision,public.escalas_comision,public.excepciones_comision,public.ventas_vendedor,public.liquidaciones_comision,public.ajustes_comision,public.pagos_comision from public,anon;
grant select,insert,update on public.transportistas,public.vendedores,public.catalogos_negocio to authenticated;
grant select,insert on public.cuentas_bancarias to authenticated;
grant select,insert on public.movimientos_bancarios,public.conciliaciones_bancarias,public.lineas_extracto_bancario to authenticated;
grant select,insert,update on public.reglas_comision,public.escalas_comision,public.excepciones_comision,public.ventas_vendedor to authenticated;
grant delete on public.ventas_vendedor to authenticated;
grant select on public.liquidaciones_comision,public.pagos_comision to authenticated;
grant select,insert on public.ajustes_comision to authenticated;

create policy transportistas_read on public.transportistas for select to authenticated using ((select public.tiene_permiso('configuracion','ver')));
create policy transportistas_insert on public.transportistas for insert to authenticated with check ((select public.tiene_permiso('configuracion','crear')));
create policy transportistas_update on public.transportistas for update to authenticated using ((select public.tiene_permiso('configuracion','editar'))) with check ((select public.tiene_permiso('configuracion','editar')));
create policy vendedores_read on public.vendedores for select to authenticated using ((select public.tiene_permiso('configuracion','ver')));
create policy vendedores_insert on public.vendedores for insert to authenticated with check ((select public.tiene_permiso('configuracion','crear')));
create policy vendedores_update on public.vendedores for update to authenticated using ((select public.tiene_permiso('configuracion','editar'))) with check ((select public.tiene_permiso('configuracion','editar')));
create policy catalogos_negocio_read on public.catalogos_negocio for select to authenticated using ((select public.tiene_permiso('configuracion','ver')));
create policy catalogos_negocio_insert on public.catalogos_negocio for insert to authenticated with check ((select public.tiene_permiso('configuracion','crear')));
create policy catalogos_negocio_update on public.catalogos_negocio for update to authenticated using ((select public.tiene_permiso('configuracion','editar'))) with check ((select public.tiene_permiso('configuracion','editar')));
create policy cuentas_bancarias_read on public.cuentas_bancarias for select to authenticated using ((select public.tiene_permiso('finanzas','ver')));
create policy cuentas_bancarias_insert on public.cuentas_bancarias for insert to authenticated with check ((select public.tiene_permiso('finanzas','crear')));
create policy movimientos_bancarios_read on public.movimientos_bancarios for select to authenticated using ((select public.tiene_permiso('finanzas','ver')));
create policy movimientos_bancarios_insert on public.movimientos_bancarios for insert to authenticated with check ((select public.tiene_permiso('finanzas','crear')));
create policy movimientos_bancarios_update on public.movimientos_bancarios for update to authenticated using ((select public.tiene_permiso('finanzas','editar'))) with check ((select public.tiene_permiso('finanzas','editar')));
create policy conciliaciones_bancarias_read on public.conciliaciones_bancarias for select to authenticated using ((select public.tiene_permiso('finanzas','ver')));
create policy conciliaciones_bancarias_insert on public.conciliaciones_bancarias for insert to authenticated with check ((select public.tiene_permiso('finanzas','crear')));
create policy lineas_extracto_bancario_read on public.lineas_extracto_bancario for select to authenticated using ((select public.tiene_permiso('finanzas','ver')));
create policy lineas_extracto_bancario_insert on public.lineas_extracto_bancario for insert to authenticated with check ((select public.tiene_permiso('finanzas','editar')) and exists(select 1 from public.conciliaciones_bancarias c where c.id=conciliacion_id and c.estado='abierta'));
create policy reglas_comision_read on public.reglas_comision for select to authenticated using ((select public.tiene_permiso('ventas','ver')));
create policy reglas_comision_write on public.reglas_comision for all to authenticated using ((select public.tiene_permiso('ventas','editar'))) with check ((select public.tiene_permiso('ventas','editar')));
create policy escalas_comision_read on public.escalas_comision for select to authenticated using ((select public.tiene_permiso('ventas','ver')));
create policy escalas_comision_write on public.escalas_comision for all to authenticated using ((select public.tiene_permiso('ventas','editar'))) with check ((select public.tiene_permiso('ventas','editar')));
create policy excepciones_comision_read on public.excepciones_comision for select to authenticated using ((select public.tiene_permiso('ventas','ver')));
create policy excepciones_comision_write on public.excepciones_comision for all to authenticated using ((select public.tiene_permiso('ventas','editar'))) with check ((select public.tiene_permiso('ventas','editar')));
create policy ventas_vendedor_read on public.ventas_vendedor for select to authenticated using ((select public.tiene_permiso('ventas','ver')));
create policy ventas_vendedor_write on public.ventas_vendedor for all to authenticated using ((select public.tiene_permiso('ventas','editar'))) with check ((select public.tiene_permiso('ventas','editar')));
create policy liquidaciones_comision_read on public.liquidaciones_comision for select to authenticated using ((select public.tiene_permiso('ventas','ver')));
create policy ajustes_comision_read on public.ajustes_comision for select to authenticated using ((select public.tiene_permiso('ventas','ver')));
create policy ajustes_comision_insert on public.ajustes_comision for insert to authenticated with check ((select public.tiene_permiso('ventas','editar')));
create policy pagos_comision_read on public.pagos_comision for select to authenticated using ((select public.tiene_permiso('finanzas','ver')));

-- Las cuentas solo cambian de estado; moneda y saldo inicial permanecen inmutables desde el cliente.
create or replace function public.actualizar_estado_cuenta_bancaria(p_cuenta_id uuid,p_activa boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not (select public.tiene_permiso('finanzas','editar')) then raise exception 'Se requiere permiso de edición de Tesorería.' using errcode='42501'; end if;
  if p_activa is null then raise exception 'El estado de la cuenta es obligatorio.' using errcode='22023'; end if;
  update public.cuentas_bancarias set activa=p_activa where id=p_cuenta_id;
  if not found then raise exception 'No se encontró la cuenta bancaria.' using errcode='P0002'; end if;
end $$;
revoke all on function public.actualizar_estado_cuenta_bancaria(uuid,boolean) from public,anon;
grant execute on function public.actualizar_estado_cuenta_bancaria(uuid,boolean) to authenticated;

-- Transferencia bancaria atómica: asiento de salida y entrada o ninguno.
create or replace function public.registrar_transferencia_bancaria(
  p_origen uuid,p_destino uuid,p_monto numeric,p_fecha date,p_referencia text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_transferencia uuid := gen_random_uuid();
begin
  if (select auth.uid()) is null or not (select public.tiene_permiso('finanzas','crear')) then
    raise exception 'Se requiere permiso de Tesorería para transferir fondos.' using errcode='42501';
  end if;
  if p_origen is null or p_destino is null or p_origen=p_destino or p_monto is null or p_monto<=0 then
    raise exception 'Las cuentas y el importe de transferencia no son válidos.' using errcode='22023';
  end if;
  perform 1 from public.cuentas_bancarias where id in (p_origen,p_destino) and activa order by id for update;
  if (select count(*) from public.cuentas_bancarias where id in (p_origen,p_destino) and activa) <> 2 then
    raise exception 'Ambas cuentas bancarias deben estar activas.' using errcode='23503';
  end if;
  if (select count(distinct moneda) from public.cuentas_bancarias where id in (p_origen,p_destino)) <> 1 then
    raise exception 'Las transferencias entre monedas distintas requieren una conversión registrada por separado.' using errcode='22023';
  end if;
  insert into public.movimientos_bancarios(cuenta_bancaria_id,tipo,concepto,monto,fecha,referencia,transferencia_id,created_by)
  values(p_origen,'transferencia_salida','Transferencia entre cuentas',round(p_monto,2),coalesce(p_fecha,current_date),nullif(trim(p_referencia),''),v_transferencia,(select auth.uid())),
        (p_destino,'transferencia_entrada','Transferencia entre cuentas',round(p_monto,2),coalesce(p_fecha,current_date),nullif(trim(p_referencia),''),v_transferencia,(select auth.uid()));
  return v_transferencia;
end $$;
revoke all on function public.registrar_transferencia_bancaria(uuid,uuid,numeric,date,text) from public,anon;
grant execute on function public.registrar_transferencia_bancaria(uuid,uuid,numeric,date,text) to authenticated;

-- Conciliación atómica: solo cierra si todas las líneas están vinculadas y el saldo cuadra.
create or replace function public.actualizar_estado_conciliacion(p_conciliacion_id uuid,p_estado text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_rec public.conciliaciones_bancarias%rowtype; v_saldo numeric(14,2);
begin
  if (select auth.uid()) is null or not (select public.tiene_permiso('finanzas','editar')) then raise exception 'Se requiere permiso de edición de Tesorería.' using errcode='42501'; end if;
  if p_estado is null or p_estado not in ('abierta','cerrada') then raise exception 'Estado de conciliación no válido.' using errcode='22023'; end if;
  select * into v_rec from public.conciliaciones_bancarias where id=p_conciliacion_id for update;
  if not found then raise exception 'No se encontró la conciliación.' using errcode='P0002'; end if;
  if p_estado='abierta' then
    update public.conciliaciones_bancarias set estado='abierta',cerrada_at=null where id=p_conciliacion_id;
    return;
  end if;
  if not exists(select 1 from public.cuentas_bancarias where id=v_rec.cuenta_bancaria_id and fecha_saldo<=v_rec.periodo_hasta) then
    raise exception 'El período debe terminar en o después de la fecha del saldo inicial de la cuenta.' using errcode='23514';
  end if;
  if exists(select 1 from public.lineas_extracto_bancario where conciliacion_id=p_conciliacion_id and movimiento_bancario_id is null) then
    raise exception 'Vincula todas las líneas del extracto antes de cerrar.' using errcode='23514';
  end if;
  select (c.saldo_inicial+coalesce(sum(case when m.tipo in ('ingreso','transferencia_entrada') then m.monto else -m.monto end),0))::numeric(14,2)
    into v_saldo from public.cuentas_bancarias c left join public.movimientos_bancarios m on m.cuenta_bancaria_id=c.id and m.fecha>=c.fecha_saldo and m.fecha<=v_rec.periodo_hasta
    where c.id=v_rec.cuenta_bancaria_id group by c.id;
  if v_saldo is null or abs(v_saldo-v_rec.saldo_extracto)>0.01 then raise exception 'El saldo del extracto no cuadra con el libro bancario (%).',coalesce(v_saldo,0) using errcode='23514'; end if;
  update public.conciliaciones_bancarias set estado='cerrada',cerrada_at=now() where id=p_conciliacion_id;
end $$;
revoke all on function public.actualizar_estado_conciliacion(uuid,text) from public,anon;
grant execute on function public.actualizar_estado_conciliacion(uuid,text) to authenticated;
-- Vínculo atómico validado por cuenta, intervalo y signo/importe del asiento.
create or replace function public.conciliar_linea_extracto(p_linea_id uuid,p_movimiento_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_line public.lineas_extracto_bancario%rowtype; v_rec public.conciliaciones_bancarias%rowtype; v_mov public.movimientos_bancarios%rowtype; v_signed numeric(14,2);
begin
  if (select auth.uid()) is null or not (select public.tiene_permiso('finanzas','editar')) then raise exception 'Se requiere permiso de edición de Tesorería.' using errcode='42501'; end if;
  select * into v_line from public.lineas_extracto_bancario where id=p_linea_id for update;
  if not found then raise exception 'No se encontró la línea del extracto.' using errcode='P0002'; end if;
  select * into v_rec from public.conciliaciones_bancarias where id=v_line.conciliacion_id for update;
  if v_rec.estado<>'abierta' then raise exception 'La conciliación está cerrada.' using errcode='23514'; end if;
  if p_movimiento_id is null then update public.lineas_extracto_bancario set movimiento_bancario_id=null where id=p_linea_id; return; end if;
  select * into v_mov from public.movimientos_bancarios where id=p_movimiento_id for update;
  if not found or v_mov.cuenta_bancaria_id<>v_rec.cuenta_bancaria_id or v_mov.fecha<v_rec.periodo_desde or v_mov.fecha>v_rec.periodo_hasta then raise exception 'El movimiento debe pertenecer a la misma cuenta y período.' using errcode='23514'; end if;
  v_signed:=case when v_mov.tipo in ('ingreso','transferencia_entrada') then v_mov.monto else -v_mov.monto end;
  if abs(v_signed-v_line.monto_firmado)>0.01 then raise exception 'El importe o signo del movimiento no coincide con la línea.' using errcode='23514'; end if;
  update public.lineas_extracto_bancario set movimiento_bancario_id=p_movimiento_id where id=p_linea_id;
end $$;
revoke all on function public.conciliar_linea_extracto(uuid,uuid) from public,anon;
grant execute on function public.conciliar_linea_extracto(uuid,uuid) to authenticated;
-- La liquidación no puede marcarse como pagada desde la API directa.
create or replace function public.liquidar_comision(p_liquidacion_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_estado text;
begin
  if (select auth.uid()) is null or not (select public.tiene_permiso('ventas','editar')) then raise exception 'Se requiere permiso de edición de Ventas.' using errcode='42501'; end if;
  select estado into v_estado from public.liquidaciones_comision where id=p_liquidacion_id for update;
  if not found then raise exception 'No se encontró la liquidación.' using errcode='P0002'; end if;
  if v_estado<>'calculada' then raise exception 'Solo se puede liquidar una comisión calculada.' using errcode='23514'; end if;
  update public.liquidaciones_comision set estado='liquidada' where id=p_liquidacion_id;
end $$;
revoke all on function public.liquidar_comision(uuid) from public,anon;
grant execute on function public.liquidar_comision(uuid) to authenticated;
-- Cálculo de comisiones sobre ventas netas completadas asignadas a vendedores.
create or replace function public.calcular_comisiones(p_desde date,p_hasta date)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_regla public.reglas_comision%rowtype; v_count integer := 0; v_row record; v_rate numeric(7,4); v_amount numeric(14,2);
begin
  if (select auth.uid()) is null or not (select public.tiene_permiso('ventas','editar')) then
    raise exception 'Se requiere permiso de edición de Ventas para calcular comisiones.' using errcode='42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta<p_desde then raise exception 'El período de cálculo no es válido.' using errcode='22023'; end if;
  select * into v_regla from public.reglas_comision where activa and vigente_desde<=p_hasta and (vigente_hasta is null or vigente_hasta>=p_desde) order by vigente_desde desc limit 1;
  if not found then raise exception 'Crea y activa una regla de comisión vigente antes de calcular.' using errcode='23514'; end if;
  for v_row in
    select vv.vendedor_id, coalesce(sum(v.monto),0)::numeric(14,2) as ventas
    from public.ventas_vendedor vv join public.ventas v on v.id=vv.venta_id
    where v.estado='Completada' and timezone('America/Lima',v.created_at)::date between p_desde and p_hasta
    group by vv.vendedor_id
  loop
    select e.porcentaje into v_rate from public.excepciones_comision e
      where e.vendedor_id=v_row.vendedor_id and e.activa and e.vigente_desde<=p_hasta and (e.vigente_hasta is null or e.vigente_hasta>=p_desde)
      order by e.vigente_desde desc limit 1;
    if v_rate is null then
      select s.porcentaje into v_rate from public.escalas_comision s where s.regla_id=v_regla.id and v_row.ventas>=s.desde_ventas and (s.hasta_ventas is null or v_row.ventas<s.hasta_ventas) order by s.desde_ventas desc limit 1;
    end if;
    v_rate:=coalesce(v_rate,v_regla.porcentaje);
    v_amount:=round(v_row.ventas*v_rate/100,2);
    insert into public.liquidaciones_comision(vendedor_id,periodo_desde,periodo_hasta,ventas_netas,comision_calculada,estado,created_by)
    values(v_row.vendedor_id,p_desde,p_hasta,v_row.ventas,v_amount,'calculada',(select auth.uid()))
    on conflict(vendedor_id,periodo_desde,periodo_hasta) do update set ventas_netas=excluded.ventas_netas,
      comision_calculada=excluded.comision_calculada,updated_at=now()
      where public.liquidaciones_comision.estado='calculada';
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
revoke all on function public.calcular_comisiones(date,date) from public,anon;
grant execute on function public.calcular_comisiones(date,date) to authenticated;

-- Registro atómico de un pago de liquidación con asiento bancario opcional.
create or replace function public.registrar_pago_comision(
  p_liquidacion_id uuid,p_monto numeric,p_fecha date,p_medio text,p_referencia text default null,p_cuenta_bancaria_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_liq public.liquidaciones_comision%rowtype; v_ajustes numeric(14,2); v_pagado numeric(14,2); v_pago uuid; v_movimiento uuid;
begin
  if (select auth.uid()) is null or not (select public.tiene_permiso('finanzas','crear')) then raise exception 'Se requiere permiso de Tesorería para pagar comisiones.' using errcode='42501'; end if;
  if p_monto is null or p_monto<=0 or nullif(trim(p_medio),'') is null then raise exception 'El importe y el medio de pago son obligatorios.' using errcode='22023'; end if;
  select * into v_liq from public.liquidaciones_comision where id=p_liquidacion_id for update;
  if not found or v_liq.estado='calculada' then raise exception 'Liquida la comisión antes de registrar su pago.' using errcode='23514'; end if;
  select coalesce(sum(monto),0)::numeric(14,2) into v_ajustes from public.ajustes_comision where liquidacion_id=p_liquidacion_id;
  select coalesce(sum(monto),0)::numeric(14,2) into v_pagado from public.pagos_comision where liquidacion_id=p_liquidacion_id;
  if round(p_monto,2)>greatest(0,v_liq.comision_calculada+v_ajustes-v_pagado) then raise exception 'El pago excede el saldo de la liquidación.' using errcode='23514'; end if;
  if p_cuenta_bancaria_id is not null and not exists(select 1 from public.cuentas_bancarias where id=p_cuenta_bancaria_id and activa and moneda='PEN') then raise exception 'Selecciona una cuenta bancaria activa en PEN.' using errcode='23503'; end if;
  insert into public.pagos_comision(liquidacion_id,monto,fecha,medio,referencia,cuenta_bancaria_id,created_by)
    values(p_liquidacion_id,round(p_monto,2),coalesce(p_fecha,current_date),trim(p_medio),nullif(trim(p_referencia),''),p_cuenta_bancaria_id,(select auth.uid())) returning id into v_pago;
  if p_cuenta_bancaria_id is not null then
    insert into public.movimientos_bancarios(cuenta_bancaria_id,tipo,concepto,monto,fecha,referencia,nota,created_by)
      values(p_cuenta_bancaria_id,'egreso','Pago de comisión',round(p_monto,2),coalesce(p_fecha,current_date),nullif(trim(p_referencia),''),'Liquidación '||p_liquidacion_id::text,(select auth.uid()))
      returning id into v_movimiento;
    update public.pagos_comision set movimiento_bancario_id=v_movimiento where id=v_pago;
  end if;
  select coalesce(sum(monto),0)::numeric(14,2) into v_pagado from public.pagos_comision where liquidacion_id=p_liquidacion_id;
  if v_pagado>=v_liq.comision_calculada+v_ajustes then update public.liquidaciones_comision set estado='pagada',updated_at=now() where id=p_liquidacion_id; end if;
  return v_pago;
end $$;
revoke all on function public.registrar_pago_comision(uuid,numeric,date,text,text,uuid) from public,anon;
grant execute on function public.registrar_pago_comision(uuid,numeric,date,text,text,uuid) to authenticated;
commit;
