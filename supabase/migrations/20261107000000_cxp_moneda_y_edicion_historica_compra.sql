-- Fase C, C12-C13: propagar moneda a la CxP y preservar snapshots historicos.
-- Preparada para aplicacion manual; no ejecutar desde el cliente.
begin;

alter table public.pagos
  add column if not exists moneda char(3) not null default 'PEN',
  add column if not exists exchange_rate numeric(18,6);

do $constraints$
begin
  if not exists(select 1 from pg_constraint where conname='pagos_moneda_ck') then
    alter table public.pagos add constraint pagos_moneda_ck check(moneda in ('PEN','USD'));
  end if;
  if not exists(select 1 from pg_constraint where conname='pagos_exchange_rate_ck') then
    alter table public.pagos add constraint pagos_exchange_rate_ck check(exchange_rate is null or exchange_rate>0);
  end if;
end
$constraints$;

-- No elimina duplicados existentes: aborta con mensaje para conciliarlos antes.
do $duplicates$
begin
  if exists(
    select 1 from public.pagos
    where tipo='pagar' and compra_id is not null
    group by compra_id having count(*)>1
  ) then
    raise exception 'Hay más de una CxP por compra. Conciliar duplicados antes de aplicar el índice único.';
  end if;
end
$duplicates$;

create unique index if not exists pagos_cxp_compra_unica_idx
  on public.pagos(compra_id) where tipo='pagar' and compra_id is not null;

create or replace function app_private._copiar_moneda_compra_a_cxp_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_moneda char(3); v_rate numeric(18,6);
begin
  if new.tipo='pagar' and new.compra_id is not null then
    select c.moneda,c.exchange_rate into v_moneda,v_rate
    from public.compras c where c.id=new.compra_id;
    if not found then raise exception 'La compra vinculada a la CxP no existe.' using errcode='23503'; end if;
    new.moneda:=v_moneda;
    new.exchange_rate:=v_rate;
  elsif new.moneda='PEN' then
    new.exchange_rate:=coalesce(new.exchange_rate,1);
  end if;
  return new;
end
$function$;
drop trigger if exists trg_cxp_copiar_moneda_compra on public.pagos;
create trigger trg_cxp_copiar_moneda_compra
before insert or update of compra_id,tipo,moneda,exchange_rate,monto on public.pagos
for each row execute function app_private._copiar_moneda_compra_a_cxp_v1();
revoke all on function app_private._copiar_moneda_compra_a_cxp_v1() from public,anon,authenticated;
-- Completa moneda/cambio de obligaciones que ya existían al desplegar la columna.
update public.pagos p set moneda=c.moneda,exchange_rate=c.exchange_rate
from public.compras c where p.compra_id=c.id and p.tipo='pagar';

-- Permite también servicios/gastos sin líneas: importe manual y moneda siguen
-- persistidos en la orden, sin inventar snapshots fiscales de detalle.
create or replace function public.crear_orden_compra_operativa_v4(
  p_proveedor_id uuid,p_detalle text,p_fecha_limite date,p_monto_manual numeric,
  p_lineas jsonb,p_idempotency_key text,p_moneda text,p_exchange_rate numeric default null
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_hash text;
  v_saved app_private.purchase_create_v3_idempotency%rowtype;
  v_compra_id uuid;
  v_line jsonb;
  v_updated integer;
begin
  if (select auth.uid()) is null or not (select public.tiene_permiso('compras','crear')) then
    raise exception 'Se requiere permiso para crear compras.' using errcode='42501';
  end if;
  if p_proveedor_id is null or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key)>128
     or p_lineas is null or jsonb_typeof(p_lineas) is distinct from 'array' then
    raise exception 'La orden requiere proveedor, clave y líneas JSON válidas.' using errcode='22023';
  end if;
  if p_moneda is null or p_moneda not in ('PEN','USD') or (p_moneda='PEN' and coalesce(p_exchange_rate,1)<>1)
     or (p_exchange_rate is not null and (p_exchange_rate::text in ('NaN','Infinity','-Infinity') or p_exchange_rate<=0)) then
    raise exception 'Moneda o tipo de cambio inválido.' using errcode='22023';
  end if;
  perform app_private._validar_lineas_compra_v1(p_lineas,true);
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    if jsonb_typeof(v_line) is distinct from 'object'
       or jsonb_typeof(v_line->'cantidad') is distinct from 'number'
       or jsonb_typeof(v_line->'precio') is distinct from 'number' then
      raise exception 'Cada línea requiere cantidad y precio numéricos.' using errcode='22023';
    end if;
    perform * from app_private._calcular_impuestos_compra_v1(
      coalesce(v_line->>'tratamiento_tributario','Gravado'),
      ((v_line->>'cantidad')::numeric*(v_line->>'precio')::numeric),
      nullif(v_line->>'tasa_tributaria','')::numeric);
  end loop;
  v_hash:=md5(jsonb_build_object('proveedor_id',p_proveedor_id,'detalle',coalesce(trim(p_detalle),''),
    'fecha_limite',p_fecha_limite,'monto_manual',p_monto_manual,'lineas',p_lineas,'moneda',p_moneda,
    'exchange_rate',p_exchange_rate)::text);
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
  select * into v_saved from app_private.purchase_create_v3_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.payload_hash<>v_hash then raise exception 'La clave ya se usó con otro contenido.' using errcode='23505'; end if;
    return v_saved.compra_id;
  end if;
  if exists(select 1 from public.compras where idempotency_key=p_idempotency_key) then
    raise exception 'La clave ya fue consumida por otra versión de creación de orden.' using errcode='23505';
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
  update public.compras set moneda=p_moneda,
    exchange_rate=case when p_moneda='PEN' then 1 else p_exchange_rate end where id=v_compra_id;
  insert into app_private.purchase_create_v3_idempotency(idempotency_key,payload_hash,compra_id)
    values(p_idempotency_key,v_hash,v_compra_id);
  return v_compra_id;
end
$function$;
revoke all on function public.crear_orden_compra_operativa_v4(uuid,text,date,numeric,jsonb,text,text,numeric) from public,anon;
grant execute on function public.crear_orden_compra_operativa_v4(uuid,text,date,numeric,jsonb,text,text,numeric) to authenticated;

-- Al editar, la ruta atómica heredada elimina y vuelve a crear las líneas.
-- El trigger solo permite NULL explícito en UPDATE para restituir el snapshot
-- histórico que ya era NULL; los INSERT operativos siguen generando snapshots.
create or replace function app_private._snapshot_fiscal_detalle_compra_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_calc record;
begin
  if tg_op='UPDATE'
     and new.tratamiento_tributario is null and new.tasa_tributaria is null
     and new.base_imponible is null and new.impuesto is null and new.total_linea is null then
    return new;
  end if;
  select * into v_calc from app_private._calcular_impuestos_compra_v1(
    new.tratamiento_tributario,round(new.cantidad*new.costo_unitario,2),new.tasa_tributaria);
  if new.base_imponible is not null and new.base_imponible<>v_calc.base then raise exception 'Base imponible inválida.' using errcode='22023'; end if;
  if new.impuesto is not null and new.impuesto<>v_calc.impuesto then raise exception 'Impuesto inválido.' using errcode='22023'; end if;
  if new.total_linea is not null and new.total_linea<>v_calc.total then raise exception 'Total de línea inválido.' using errcode='22023'; end if;
  new.tratamiento_tributario:=v_calc.tratamiento;
  new.tasa_tributaria:=v_calc.tasa;
  new.base_imponible:=v_calc.base;
  new.impuesto:=v_calc.impuesto;
  new.total_linea:=v_calc.total;
  return new;
end
$function$;

create or replace function app_private._sincronizar_monto_compra_desde_lineas_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_compra_id uuid; v_count integer; v_classified integer; v_total numeric(14,2);
begin
  if tg_op='DELETE' then v_compra_id:=old.compra_id; else v_compra_id:=new.compra_id; end if;
  select count(*),count(*) filter(where total_linea is not null),round(sum(total_linea),2)
    into v_count,v_classified,v_total from public.detalle_compras where compra_id=v_compra_id;
  if v_count>0 and v_count=v_classified then update public.compras set monto=v_total where id=v_compra_id; end if;
  if tg_op='UPDATE' and old.compra_id is distinct from new.compra_id then
    select count(*),count(*) filter(where total_linea is not null),round(sum(total_linea),2)
      into v_count,v_classified,v_total from public.detalle_compras where compra_id=old.compra_id;
    if v_count>0 and v_count=v_classified then update public.compras set monto=v_total where id=old.compra_id; end if;
  end if;
  return null;
end
$function$;
revoke all on function app_private._sincronizar_monto_compra_desde_lineas_v1() from public,anon,authenticated;

create or replace function public.editar_orden_compra_operativa_v3(
  p_compra_id uuid,p_expected_updated_at timestamptz,p_proveedor_id uuid,p_detalle text,
  p_fecha_limite date,p_comprobante_tipo text,p_comprobante_numero text,p_lineas jsonb,
  p_moneda text,p_exchange_rate numeric
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_line jsonb;
  v_result jsonb;
  v_legacy_null_products uuid[];
  v_id uuid;
  v_treatment text;
  v_updated_at timestamptz;
  v_old_amount numeric(14,2);
begin
  if (select auth.uid()) is null or not (select public.tiene_permiso('compras','editar')) then
    raise exception 'Se requiere permiso para editar compras.' using errcode='42501';
  end if;
  if p_moneda is null or p_moneda not in ('PEN','USD') or (p_moneda='PEN' and coalesce(p_exchange_rate,1)<>1)
     or (p_exchange_rate is not null and (p_exchange_rate::text in ('NaN','Infinity','-Infinity') or p_exchange_rate<=0)) then
    raise exception 'Moneda o tipo de cambio inválido.' using errcode='22023';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) is distinct from 'array' then
    raise exception 'Las líneas deben ser una lista JSON.' using errcode='22023';
  end if;
  perform app_private._validar_lineas_compra_v1(p_lineas,true);
  select coalesce(array_agg(distinct proveedor_producto_id),array[]::uuid[])
    into v_legacy_null_products
  from public.detalle_compras
  where compra_id=p_compra_id and tratamiento_tributario is null
    and tasa_tributaria is null and base_imponible is null and impuesto is null and total_linea is null;
  select monto into v_old_amount from public.compras where id=p_compra_id;

  if cardinality(v_legacy_null_products)>0 and (
    jsonb_array_length(p_lineas)<>(select count(*) from public.detalle_compras where compra_id=p_compra_id)
    or exists(
      select 1 from public.detalle_compras d
      where d.compra_id=p_compra_id and d.tratamiento_tributario is null
        and not exists(
          select 1 from jsonb_array_elements(p_lineas) j(value)
          where (j.value->>'producto_id')::uuid=d.proveedor_producto_id
            and (j.value->>'cantidad')::numeric=d.cantidad
            and (j.value->>'precio')::numeric=d.costo_unitario
        )
    )
  ) then
    raise exception 'La orden contiene líneas históricas sin snapshot fiscal. No se pueden cambiar, quitar o agregar líneas en esta edición; clasifica primero todas explícitamente.' using errcode='23514';
  end if;

  for v_line in select value from jsonb_array_elements(p_lineas) loop
    v_treatment:=nullif(v_line->>'tratamiento_tributario','');
    perform * from app_private._calcular_impuestos_compra_v1(
      coalesce(v_treatment,'Gravado'),
      ((v_line->>'cantidad')::numeric*(v_line->>'precio')::numeric),
      nullif(v_line->>'tasa_tributaria','')::numeric);
  end loop;

  v_result:=app_private._editar_orden_compra_operativa_v1(
    p_compra_id,p_expected_updated_at,p_proveedor_id,p_detalle,p_fecha_limite,
    p_comprobante_tipo,p_comprobante_numero,p_lineas);

  for v_line in select value from jsonb_array_elements(p_lineas) loop
    v_id:=(v_line->>'producto_id')::uuid;
    v_treatment:=nullif(v_line->>'tratamiento_tributario','');
    if v_treatment is null and v_id=any(v_legacy_null_products) then
      update public.detalle_compras set tratamiento_tributario=null,tasa_tributaria=null,
        base_imponible=null,impuesto=null,total_linea=null
      where compra_id=p_compra_id and proveedor_producto_id=v_id;
    else
      update public.detalle_compras set tratamiento_tributario=coalesce(v_treatment,'Gravado'),
        tasa_tributaria=nullif(v_line->>'tasa_tributaria','')::numeric,
        base_imponible=null,impuesto=null,total_linea=null
      where compra_id=p_compra_id and proveedor_producto_id=v_id;
    end if;
  end loop;

  if exists(select 1 from public.detalle_compras d where d.compra_id=p_compra_id and d.total_linea is null) then
    update public.compras set monto=v_old_amount where id=p_compra_id;
  end if;

  update public.compras set moneda=p_moneda,
    exchange_rate=case when p_moneda='PEN' then 1 else p_exchange_rate end,
    updated_at=clock_timestamp()
  where id=p_compra_id returning updated_at into v_updated_at;
  return v_result||jsonb_build_object('updated_at',v_updated_at);
end
$function$;
revoke all on function public.editar_orden_compra_operativa_v3(uuid,timestamptz,uuid,text,date,text,text,jsonb,text,numeric) from public,anon;
grant execute on function public.editar_orden_compra_operativa_v3(uuid,timestamptz,uuid,text,date,text,text,jsonb,text,numeric) to authenticated;

commit;
