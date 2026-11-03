-- Fase C, C07-C09: snapshots tributarios y moneda en orden de compra.
-- Los valores existentes no se reclasifican; las nuevas/escritas líneas reciben snapshot.
begin;

alter table public.detalle_compras
  add column if not exists tratamiento_tributario text,
  add column if not exists tasa_tributaria numeric(5,2),
  add column if not exists base_imponible numeric(14,2),
  add column if not exists impuesto numeric(14,2),
  add column if not exists total_linea numeric(14,2);

alter table public.compras
  add column if not exists moneda char(3) not null default 'PEN',
  add column if not exists exchange_rate numeric(18,6);

do $constraints$
begin
  if not exists(select 1 from pg_constraint where conname='detalle_compras_tratamiento_ck') then
    alter table public.detalle_compras add constraint detalle_compras_tratamiento_ck
      check (tratamiento_tributario is null or tratamiento_tributario in ('Gravado','Exonerado','Inafecto'));
  end if;
  if not exists(select 1 from pg_constraint where conname='detalle_compras_tasa_ck') then
    alter table public.detalle_compras add constraint detalle_compras_tasa_ck
      check (tasa_tributaria is null or tasa_tributaria in (0,18));
  end if;
  if not exists(select 1 from pg_constraint where conname='detalle_compras_montos_fiscales_ck') then
    alter table public.detalle_compras add constraint detalle_compras_montos_fiscales_ck
      check ((base_imponible is null or base_imponible >= 0)
        and (impuesto is null or impuesto >= 0)
        and (total_linea is null or total_linea >= 0)
        and (base_imponible is null or impuesto is null or total_linea is null
          or base_imponible + impuesto = total_linea));
  end if;
  if not exists(select 1 from pg_constraint where conname='compras_moneda_ck') then
    alter table public.compras add constraint compras_moneda_ck check (moneda in ('PEN','USD'));
  end if;
  if not exists(select 1 from pg_constraint where conname='compras_exchange_rate_ck') then
    alter table public.compras add constraint compras_exchange_rate_ck
      check (exchange_rate is null or exchange_rate > 0);
  end if;
end
$constraints$;

comment on column public.detalle_compras.tratamiento_tributario is 'Snapshot fiscal por línea; NULL identifica una línea histórica no clasificada.';
comment on column public.detalle_compras.tasa_tributaria is 'Tasa porcentual snapshot: Gravado 18%, Exonerado/Inafecto 0%.';
comment on column public.detalle_compras.base_imponible is 'Base de la línea redondeada a 2 decimales.';
comment on column public.detalle_compras.impuesto is 'Impuesto calculado por línea y redondeado a 2 decimales.';
comment on column public.detalle_compras.total_linea is 'Total autoritativo de línea: base_imponible + impuesto.';
comment on column public.compras.moneda is 'Moneda de la orden: PEN o USD; los importes permanecen en moneda de origen.';
comment on column public.compras.exchange_rate is 'Tipo de cambio manual snapshot. USD puede quedar NULL hasta confirmar la orden.';

create or replace function app_private._calcular_impuestos_compra_v1(
  p_tratamiento text,p_base numeric,p_tasa numeric default null
)
returns table(tratamiento text,tasa numeric,base numeric,impuesto numeric,total numeric)
language plpgsql immutable set search_path = '' as $function$
declare
  v_treatment text := coalesce(nullif(trim(p_tratamiento),''),'Gravado');
  v_rate numeric;
  v_base numeric;
  v_tax numeric;
begin
  if p_base is null or p_base::text in ('NaN','Infinity','-Infinity') or p_base < 0 then
    raise exception 'La base imponible debe ser finita y no negativa.' using errcode='22023';
  end if;
  if v_treatment not in ('Gravado','Exonerado','Inafecto') then
    raise exception 'Tratamiento tributario inválido.' using errcode='22023';
  end if;
  v_rate := case v_treatment when 'Gravado' then 18 else 0 end;
  if p_tasa is not null and (p_tasa::text in ('NaN','Infinity','-Infinity') or p_tasa <> v_rate) then
    raise exception 'La tasa no corresponde al tratamiento tributario seleccionado.' using errcode='22023';
  end if;
  v_base := round(p_base,2);
  v_tax := round(v_base * v_rate / 100,2);
  return query select v_treatment,v_rate,v_base,v_tax,v_base+v_tax;
end
$function$;
revoke all on function app_private._calcular_impuestos_compra_v1(text,numeric,numeric) from public,anon,authenticated;

create or replace function app_private._snapshot_fiscal_detalle_compra_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_calc record;
begin
  select * into v_calc from app_private._calcular_impuestos_compra_v1(
    new.tratamiento_tributario, round(new.cantidad * new.costo_unitario,2), new.tasa_tributaria);
  if new.base_imponible is not null and new.base_imponible <> v_calc.base then
    raise exception 'La base imponible no coincide con cantidad × costo unitario.' using errcode='22023';
  end if;
  if new.impuesto is not null and new.impuesto <> v_calc.impuesto then
    raise exception 'El impuesto de línea no coincide con el cálculo autoritativo.' using errcode='22023';
  end if;
  if new.total_linea is not null and new.total_linea <> v_calc.total then
    raise exception 'El total de línea no coincide exactamente con base + impuesto.' using errcode='22023';
  end if;
  new.tratamiento_tributario := v_calc.tratamiento;
  new.tasa_tributaria := v_calc.tasa;
  new.base_imponible := v_calc.base;
  new.impuesto := v_calc.impuesto;
  new.total_linea := v_calc.total;
  return new;
end
$function$;

drop trigger if exists trg_snapshot_fiscal_detalle_compra on public.detalle_compras;
create trigger trg_snapshot_fiscal_detalle_compra
before insert or update of cantidad,costo_unitario,tratamiento_tributario,tasa_tributaria,base_imponible,impuesto,total_linea
on public.detalle_compras for each row execute function app_private._snapshot_fiscal_detalle_compra_v1();
revoke all on function app_private._snapshot_fiscal_detalle_compra_v1() from public,anon,authenticated;

create or replace function app_private._sincronizar_monto_compra_desde_lineas_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_compra_id uuid;
begin
  if tg_op='DELETE' then v_compra_id:=old.compra_id; else v_compra_id:=new.compra_id; end if;
  update public.compras c set monto=(select round(sum(d.total_linea),2) from public.detalle_compras d where d.compra_id=v_compra_id)
  where c.id=v_compra_id and exists(select 1 from public.detalle_compras d where d.compra_id=v_compra_id);
  if tg_op='UPDATE' and old.compra_id is distinct from new.compra_id then
    update public.compras c set monto=(select round(sum(d.total_linea),2) from public.detalle_compras d where d.compra_id=old.compra_id)
    where c.id=old.compra_id and exists(select 1 from public.detalle_compras d where d.compra_id=old.compra_id);
  end if;
  return null;
end
$function$;
drop trigger if exists trg_sincronizar_monto_compra_lineas on public.detalle_compras;
create trigger trg_sincronizar_monto_compra_lineas
after insert or update of cantidad,costo_unitario,tratamiento_tributario,tasa_tributaria,base_imponible,impuesto,total_linea or delete
on public.detalle_compras for each row execute function app_private._sincronizar_monto_compra_desde_lineas_v1();
revoke all on function app_private._sincronizar_monto_compra_desde_lineas_v1() from public,anon,authenticated;

create or replace function app_private._validar_moneda_compra_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.moneda not in ('PEN','USD') then raise exception 'La moneda debe ser PEN o USD.' using errcode='22023'; end if;
  if new.exchange_rate is not null and (new.exchange_rate::text in ('NaN','Infinity','-Infinity') or new.exchange_rate<=0) then
    raise exception 'El tipo de cambio debe ser finito y mayor que cero.' using errcode='22023';
  end if;
  if new.moneda='PEN' then
    if new.exchange_rate is not null and new.exchange_rate<>1 then raise exception 'El tipo de cambio de PEN debe ser 1.' using errcode='22023'; end if;
    new.exchange_rate:=1;
  elsif new.estado::text in ('Confirmada','Confirmado') and new.exchange_rate is null then
    raise exception 'Debe registrar el tipo de cambio manual antes de confirmar una orden en USD.' using errcode='22023';
  end if;
  return new;
end
$function$;
drop trigger if exists trg_validar_moneda_compra on public.compras;
create trigger trg_validar_moneda_compra before insert or update of moneda,exchange_rate,estado
on public.compras for each row execute function app_private._validar_moneda_compra_v1();
revoke all on function app_private._validar_moneda_compra_v1() from public,anon,authenticated;

create table if not exists app_private.purchase_create_v3_idempotency (
  idempotency_key text primary key,
  payload_hash text not null,
  compra_id uuid not null references public.compras(id) on delete restrict,
  created_at timestamptz not null default now()
);
revoke all on app_private.purchase_create_v3_idempotency from public,anon,authenticated;

-- Nueva firma: preserva las RPC desplegadas y agrega moneda/cambio + snapshots fiscales.
create or replace function public.crear_orden_compra_operativa_v3(
  p_proveedor_id uuid,p_detalle text,p_fecha_limite date,p_monto_manual numeric,
  p_lineas jsonb,p_idempotency_key text,p_moneda text,p_exchange_rate numeric default null
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_hash text;
  v_saved app_private.purchase_create_v3_idempotency%rowtype;
  v_compra_id uuid;
  v_line jsonb;
  v_expected integer;
  v_updated integer;
begin
  if (select auth.uid()) is null or not (select public.tiene_permiso('compras','crear')) then
    raise exception 'Se requiere permiso para crear compras.' using errcode='42501';
  end if;
  if p_proveedor_id is null or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key)>128
     or p_lineas is null or jsonb_typeof(p_lineas) is distinct from 'array' or jsonb_array_length(p_lineas)=0 then
    raise exception 'La orden requiere proveedor, clave y al menos una línea JSON.' using errcode='22023';
  end if;
  if p_moneda is null or p_moneda not in ('PEN','USD') or (p_moneda='PEN' and coalesce(p_exchange_rate,1)<>1)
     or (p_exchange_rate is not null and (p_exchange_rate::text in ('NaN','Infinity','-Infinity') or p_exchange_rate<=0)) then
    raise exception 'Moneda o tipo de cambio inválido.' using errcode='22023';
  end if;
  perform app_private._validar_lineas_compra_v1(p_lineas,false);
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    if jsonb_typeof(v_line) is distinct from 'object'
       or jsonb_typeof(v_line->'cantidad') is distinct from 'number'
       or jsonb_typeof(v_line->'precio') is distinct from 'number' then
      raise exception 'Cada línea requiere cantidad y precio numéricos.' using errcode='22023';
    end if;
    perform * from app_private._calcular_impuestos_compra_v1(
      coalesce(v_line->>'tratamiento_tributario','Gravado'),
      ((v_line->>'cantidad')::numeric * (v_line->>'precio')::numeric),
      nullif(v_line->>'tasa_tributaria','')::numeric);
  end loop;
  v_hash:=md5(jsonb_build_object('proveedor_id',p_proveedor_id,'detalle',coalesce(trim(p_detalle),''),
    'fecha_limite',p_fecha_limite,'monto_manual',p_monto_manual,'lineas',p_lineas,'moneda',p_moneda,
    'exchange_rate',p_exchange_rate)::text);
  -- Usa el mismo candado que la fachada v2 para evitar carreras entre versiones.
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
  select * into v_saved from app_private.purchase_create_v3_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.payload_hash<>v_hash then raise exception 'La clave ya se usó con otro contenido.' using errcode='23505'; end if;
    return v_saved.compra_id;
  end if;
  if exists(select 1 from public.compras where idempotency_key=p_idempotency_key) then
    raise exception 'La clave ya fue consumida por una versión anterior de creación de orden.' using errcode='23505';
  end if;
  v_compra_id:=app_private._crear_orden_compra_operativa_v2(
    p_proveedor_id,p_detalle,p_fecha_limite,p_monto_manual,p_lineas,p_idempotency_key);
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    update public.detalle_compras d set tratamiento_tributario=coalesce(v_line->>'tratamiento_tributario','Gravado'),
      tasa_tributaria=nullif(v_line->>'tasa_tributaria','')::numeric,
      base_imponible=null,impuesto=null,total_linea=null
    where d.compra_id=v_compra_id and d.proveedor_producto_id=(v_line->>'producto_id')::uuid;
    get diagnostics v_updated = row_count;
    if v_updated<>1 then raise exception 'No se pudo asociar el snapshot fiscal a una línea.' using errcode='23503'; end if;
  end loop;
  select count(*) into v_expected from public.detalle_compras where compra_id=v_compra_id;
  if v_expected<>jsonb_array_length(p_lineas) then raise exception 'El conjunto de líneas creado no coincide con la solicitud.' using errcode='23514'; end if;
  update public.compras set moneda=p_moneda,exchange_rate=case when p_moneda='PEN' then 1 else p_exchange_rate end where id=v_compra_id;
  insert into app_private.purchase_create_v3_idempotency(idempotency_key,payload_hash,compra_id)
    values(p_idempotency_key,v_hash,v_compra_id);
  return v_compra_id;
end
$function$;
revoke all on function public.crear_orden_compra_operativa_v3(uuid,text,date,numeric,jsonb,text,text,numeric) from public,anon;
grant execute on function public.crear_orden_compra_operativa_v3(uuid,text,date,numeric,jsonb,text,text,numeric) to authenticated;

-- Edición versionada: conserva control optimista y bloqueos de v1, agrega snapshots y moneda.
create or replace function public.editar_orden_compra_operativa_v2(
  p_compra_id uuid,p_expected_updated_at timestamptz,p_proveedor_id uuid,p_detalle text,
  p_fecha_limite date,p_comprobante_tipo text,p_comprobante_numero text,p_lineas jsonb,
  p_moneda text,p_exchange_rate numeric
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_line jsonb;
  v_result jsonb;
  v_updated integer;
  v_updated_at timestamptz;
begin
  if p_moneda is null or p_moneda not in ('PEN','USD') or (p_moneda='PEN' and coalesce(p_exchange_rate,1)<>1)
     or (p_exchange_rate is not null and (p_exchange_rate::text in ('NaN','Infinity','-Infinity') or p_exchange_rate<=0)) then
    raise exception 'Moneda o tipo de cambio inválido.' using errcode='22023';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) is distinct from 'array' then
    raise exception 'Las líneas deben ser una lista JSON.' using errcode='22023';
  end if;
  perform app_private._validar_lineas_compra_v1(p_lineas,true);
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    if jsonb_typeof(v_line) is distinct from 'object' then raise exception 'Formato de línea inválido.' using errcode='22023'; end if;
    perform * from app_private._calcular_impuestos_compra_v1(
      coalesce(v_line->>'tratamiento_tributario','Gravado'),
      ((v_line->>'cantidad')::numeric * (v_line->>'precio')::numeric),
      nullif(v_line->>'tasa_tributaria','')::numeric);
  end loop;
  v_result:=app_private._editar_orden_compra_operativa_v1(p_compra_id,p_expected_updated_at,p_proveedor_id,
    p_detalle,p_fecha_limite,p_comprobante_tipo,p_comprobante_numero,p_lineas);
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    update public.detalle_compras d set tratamiento_tributario=coalesce(v_line->>'tratamiento_tributario','Gravado'),
      tasa_tributaria=nullif(v_line->>'tasa_tributaria','')::numeric,
      base_imponible=null,impuesto=null,total_linea=null
    where d.compra_id=p_compra_id and d.proveedor_producto_id=(v_line->>'producto_id')::uuid;
    get diagnostics v_updated = row_count;
    if v_updated<>1 then raise exception 'No se pudo asociar el snapshot fiscal a una línea.' using errcode='23503'; end if;
  end loop;
  update public.compras set moneda=p_moneda,exchange_rate=case when p_moneda='PEN' then 1 else p_exchange_rate end,
    updated_at=clock_timestamp() where id=p_compra_id returning updated_at into v_updated_at;
  return v_result || jsonb_build_object('updated_at',v_updated_at);
end
$function$;
revoke all on function public.editar_orden_compra_operativa_v2(uuid,timestamptz,uuid,text,date,text,text,jsonb,text,numeric) from public,anon;
grant execute on function public.editar_orden_compra_operativa_v2(uuid,timestamptz,uuid,text,date,text,text,jsonb,text,numeric) to authenticated;

-- Para órdenes nuevas completamente clasificadas, reconocer CxP según el total
-- persistido de cada línea y la fracción efectivamente recibida. Las filas
-- históricas (snapshot NULL) conservan el cálculo anterior, sin reclasificación.
create or replace function app_private._cxp_monto_desde_lineas_fiscales_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_count integer;
  v_classified integer;
  v_total numeric(14,2);
  v_applied numeric(14,2);
begin
  if new.tipo='pagar' and new.compra_id is not null then
    select count(*),count(*) filter(where d.total_linea is not null),
      round(coalesce(sum(round(d.total_linea * received.qty / nullif(d.cantidad,0),2)),0),2)
      into v_count,v_classified,v_total
    from public.detalle_compras d
    left join lateral (
      select coalesce(sum(dr.cantidad),0)::numeric as qty
      from public.detalle_recepciones_compra dr
      join public.recepciones_compra r on r.id=dr.recepcion_id
      where dr.detalle_compra_id=d.id and r.compra_id=new.compra_id
    ) received on true
    where d.compra_id=new.compra_id;
    if v_count>0 and v_count=v_classified then
      select coalesce(sum(ap.monto),0) into v_applied from public.aplicaciones_pago ap where ap.cuenta_id=new.id;
      new.monto:=greatest(v_total,coalesce(v_applied,0));
    end if;
  end if;
  return new;
end
$function$;
drop trigger if exists trg_cxp_monto_fiscal_desde_compra on public.pagos;
create trigger trg_cxp_monto_fiscal_desde_compra before insert or update of monto on public.pagos
for each row execute function app_private._cxp_monto_desde_lineas_fiscales_v1();
revoke all on function app_private._cxp_monto_desde_lineas_fiscales_v1() from public,anon,authenticated;

commit;
