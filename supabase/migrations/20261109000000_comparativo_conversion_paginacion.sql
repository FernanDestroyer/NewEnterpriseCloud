-- Fase D107-D114: comparativo fiscal homogéneo, adjudicación única,
-- conversión transaccional e idempotente y consultas paginadas de Compras.
-- Aplicación manual por el usuario; no ejecutar desde el cliente.
begin;

-- Snapshot de moneda/cambio y tratamiento tributario en cada oferta.
alter table public.ofertas_compra
  add column if not exists moneda char(3) not null default 'PEN',
  add column if not exists exchange_rate numeric(18,6) not null default 1;
alter table public.detalle_ofertas_compra
  add column if not exists tratamiento_tributario text not null default 'Gravado',
  add column if not exists tasa_tributaria numeric(5,2) not null default 18;
alter table public.ofertas_compra drop constraint if exists ofertas_compra_moneda_ck;
alter table public.ofertas_compra add constraint ofertas_compra_moneda_ck
  check(moneda in ('PEN','USD') and exchange_rate>0 and exchange_rate::text not in ('NaN','Infinity','-Infinity')
    and ((moneda='PEN' and exchange_rate=1) or moneda='USD'));
alter table public.detalle_ofertas_compra drop constraint if exists detalle_ofertas_compra_impuesto_ck;
alter table public.detalle_ofertas_compra add constraint detalle_ofertas_compra_impuesto_ck
  check((tratamiento_tributario='Gravado' and tasa_tributaria=18)
    or (tratamiento_tributario in ('Exonerado','Inafecto') and tasa_tributaria=0));
comment on column public.ofertas_compra.exchange_rate is 'Snapshot manual de PEN por unidad de moneda de la cotización; PEN usa 1.';
comment on column public.detalle_ofertas_compra.tratamiento_tributario is 'Tratamiento fiscal capturado en la cotización; no altera su evidencia histórica.';

-- Relación explícita oferta/línea/orden. Una solicitud adjudicada solo puede
-- producir una orden, según D108 (ganador se lo lleva todo).
alter table public.compras
  add column if not exists solicitud_compra_id uuid references public.solicitudes_compra(id) on delete restrict,
  add column if not exists oferta_compra_id uuid references public.ofertas_compra(id) on delete restrict;
alter table public.detalle_compras
  add column if not exists solicitud_linea_id uuid references public.solicitud_compra_lineas(id) on delete restrict,
  add column if not exists detalle_oferta_id uuid references public.detalle_ofertas_compra(id) on delete restrict,
  add column if not exists solicitud_compra_id uuid references public.solicitudes_compra(id) on delete restrict,
  add column if not exists oferta_compra_id uuid references public.ofertas_compra(id) on delete restrict;
create unique index if not exists ofertas_compra_id_solicitud_unica_idx on public.ofertas_compra(id,solicitud_id);
create unique index if not exists ofertas_compra_proveedor_id_unico_idx on public.ofertas_compra(proveedor_id,id);
create unique index if not exists detalle_ofertas_compra_oferta_id_unico_idx on public.detalle_ofertas_compra(oferta_id,id);
create unique index if not exists compras_origen_fk_unico_idx on public.compras(id,solicitud_compra_id,oferta_compra_id);
create unique index if not exists compras_proveedor_oferta_fk_unico_idx on public.compras(proveedor_id,oferta_compra_id);
do $sourcing_fks$
begin
  if not exists(select 1 from pg_constraint where conname='compras_oferta_solicitud_coherentes_fk') then
    alter table public.compras add constraint compras_oferta_solicitud_coherentes_fk
      foreign key(oferta_compra_id,solicitud_compra_id) references public.ofertas_compra(id,solicitud_id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conname='compras_oferta_proveedor_coherentes_fk') then
    alter table public.compras add constraint compras_oferta_proveedor_coherentes_fk
      foreign key(proveedor_id,oferta_compra_id) references public.ofertas_compra(proveedor_id,id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conname='compras_sourcing_origen_ck') then
    alter table public.compras add constraint compras_sourcing_origen_ck
      check((solicitud_compra_id is null and oferta_compra_id is null) or (solicitud_compra_id is not null and oferta_compra_id is not null));
  end if;
  if not exists(select 1 from pg_constraint where conname='detalle_compras_origen_completo_ck') then
    alter table public.detalle_compras add constraint detalle_compras_origen_completo_ck
      check((solicitud_compra_id is null and oferta_compra_id is null and solicitud_linea_id is null and detalle_oferta_id is null)
        or (solicitud_compra_id is not null and oferta_compra_id is not null and solicitud_linea_id is not null and detalle_oferta_id is not null));
  end if;
  if not exists(select 1 from pg_constraint where conname='detalle_compras_orden_origen_fk') then
    alter table public.detalle_compras add constraint detalle_compras_orden_origen_fk
      foreign key(compra_id,solicitud_compra_id,oferta_compra_id)
      references public.compras(id,solicitud_compra_id,oferta_compra_id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conname='detalle_compras_solicitud_linea_origen_fk') then
    alter table public.detalle_compras add constraint detalle_compras_solicitud_linea_origen_fk
      foreign key(solicitud_compra_id,solicitud_linea_id)
      references public.solicitud_compra_lineas(solicitud_id,id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conname='detalle_compras_oferta_linea_origen_fk') then
    alter table public.detalle_compras add constraint detalle_compras_oferta_linea_origen_fk
      foreign key(oferta_compra_id,detalle_oferta_id) references public.detalle_ofertas_compra(oferta_id,id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conname='detalle_compras_oferta_solicitud_linea_fk') then
    alter table public.detalle_compras add constraint detalle_compras_oferta_solicitud_linea_fk
      foreign key(oferta_compra_id,solicitud_linea_id) references public.detalle_ofertas_compra(oferta_id,solicitud_linea_id) on delete restrict;
  end if;
end
$sourcing_fks$;
create unique index if not exists compras_solicitud_origen_unica_idx
  on public.compras(solicitud_compra_id) where solicitud_compra_id is not null;
create unique index if not exists compras_oferta_origen_unica_idx
  on public.compras(oferta_compra_id) where oferta_compra_id is not null;
create unique index if not exists detalle_compras_solicitud_linea_unica_idx
  on public.detalle_compras(compra_id,solicitud_linea_id) where solicitud_linea_id is not null;
create unique index if not exists detalle_compras_oferta_linea_unica_idx
  on public.detalle_compras(compra_id,detalle_oferta_id) where detalle_oferta_id is not null;
create index if not exists solicitudes_compra_paginacion_idx
  on public.solicitudes_compra(created_at desc,id desc);
create index if not exists solicitudes_compra_fecha_necesidad_idx
  on public.solicitudes_compra(fecha_necesidad desc,id desc);
create index if not exists proveedores_compras_busqueda_idx
  on public.proveedores(lower(razon_social),id) where estado::text='Activo';

create table if not exists app_private.purchase_sourcing_conversion (
  solicitud_id uuid primary key references public.solicitudes_compra(id) on delete restrict,
  oferta_id uuid not null unique references public.ofertas_compra(id) on delete restrict,
  compra_id uuid not null unique references public.compras(id) on delete restrict,
  idempotency_key text not null unique,
  payload_hash text not null,
  actor_id uuid not null references public.usuarios(id) on delete restrict,
  created_at timestamptz not null default now()
);
revoke all on app_private.purchase_sourcing_conversion from public,anon,authenticated;

create or replace function app_private._proteger_linea_compra_vinculada_solicitud_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if old.solicitud_linea_id is not null then
    raise exception 'La línea de una orden convertida está vinculada a su cotización y solicitud; no se puede editar ni eliminar.' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$function$;
drop trigger if exists trg_proteger_linea_compra_vinculada_solicitud on public.detalle_compras;
create trigger trg_proteger_linea_compra_vinculada_solicitud
  before update or delete on public.detalle_compras
  for each row when (old.solicitud_linea_id is not null)
  execute function app_private._proteger_linea_compra_vinculada_solicitud_v1();
revoke all on function app_private._proteger_linea_compra_vinculada_solicitud_v1() from public,anon,authenticated;

-- Registro de oferta v4: conserva v3 y su idempotencia, agrega moneda/tasa e
-- impuesto por línea, siempre sujeto al motor fiscal configurado de Fase C.
create or replace function public.registrar_oferta_compra_v4(
  p_solicitud_id uuid,p_proveedor_id uuid,p_vigencia_hasta date,
  p_plazo_entrega_dias integer,p_condiciones text,p_precios jsonb,p_idempotency_key text,
  p_moneda text,p_exchange_rate numeric
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_hash text; v_id uuid; v_old_hash text;
  v_expected integer; v_price record; v_previous uuid; v_version integer;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','crear')) then
    raise exception 'No tienes permiso para registrar ofertas.' using errcode='42501';
  end if;
  if p_solicitud_id is null or p_proveedor_id is null or nullif(trim(p_idempotency_key),'') is null
     or length(p_idempotency_key) not between 8 and 128 or p_precios is null
     or jsonb_typeof(p_precios) is distinct from 'array' or jsonb_array_length(p_precios)=0 or jsonb_array_length(p_precios)>100 then
    raise exception 'Solicitud, proveedor, precios y clave son obligatorios.' using errcode='22023';
  end if;
  if p_moneda not in ('PEN','USD') or not exists(select 1 from public.monedas m where m.codigo=p_moneda and m.activo)
     or p_exchange_rate is null or p_exchange_rate::text in ('NaN','Infinity','-Infinity') or p_exchange_rate<=0
     or (p_moneda='PEN' and p_exchange_rate<>1) then
    raise exception 'Selecciona una moneda activa (PEN/USD) y registra el tipo de cambio válido; PEN usa 1.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_precios) e(value) where jsonb_typeof(e.value) is distinct from 'object') then
    raise exception 'Cada precio debe ser un objeto JSON.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('solicitud_id',p_solicitud_id,'proveedor_id',p_proveedor_id,
    'vigencia_hasta',p_vigencia_hasta,'plazo_entrega_dias',p_plazo_entrega_dias,
    'condiciones',coalesce(trim(p_condiciones),''),'precios',p_precios,'moneda',p_moneda,
    'exchange_rate',p_exchange_rate)::text);
  perform pg_advisory_xact_lock(hashtextextended('oferta-compra:'||p_idempotency_key,0));
  select id,payload_hash into v_id,v_old_hash from public.ofertas_compra where idempotency_key=p_idempotency_key for update;
  if found then
    if v_old_hash is distinct from v_hash then raise exception 'La clave ya se usó con otro contenido.' using errcode='23505'; end if;
    return v_id;
  end if;
  perform 1 from public.solicitudes_compra where id=p_solicitud_id and estado='Abierta' for update;
  if not found then raise exception 'La solicitud no está abierta.' using errcode='23514'; end if;
  if not exists(select 1 from public.proveedores where id=p_proveedor_id and estado::text='Activo') then
    raise exception 'El proveedor no existe o está inactivo.' using errcode='23503';
  end if;
  if p_plazo_entrega_dias is not null and p_plazo_entrega_dias<0 then raise exception 'El plazo no puede ser negativo.' using errcode='22023'; end if;
  select count(*) into v_expected from public.solicitud_compra_lineas where solicitud_id=p_solicitud_id;
  if jsonb_array_length(p_precios)<>v_expected or v_expected=0 then raise exception 'Debe cotizarse cada línea solicitada.' using errcode='22023'; end if;
  for v_price in select * from jsonb_to_recordset(p_precios) as x(linea_id uuid,precio_unitario numeric,tratamiento_tributario text,tasa_tributaria numeric) loop
    if v_price.linea_id is null or v_price.precio_unitario is null
       or v_price.precio_unitario::text in ('NaN','Infinity','-Infinity') or v_price.precio_unitario<0
       or v_price.precio_unitario>9999999999.9999 or v_price.precio_unitario<>round(v_price.precio_unitario,4)
       or not exists(select 1 from public.solicitud_compra_lineas where id=v_price.linea_id and solicitud_id=p_solicitud_id)
       or not ((v_price.tratamiento_tributario='Gravado' and v_price.tasa_tributaria=18)
          or (v_price.tratamiento_tributario in ('Exonerado','Inafecto') and v_price.tasa_tributaria=0)) then
      raise exception 'Precio, línea o tratamiento tributario inválidos.' using errcode='22023';
    end if;
    perform * from app_private._calcular_impuestos_compra_v1(
      v_price.tratamiento_tributario,(select cantidad from public.solicitud_compra_lineas where id=v_price.linea_id)*round(v_price.precio_unitario,2),v_price.tasa_tributaria);
  end loop;
  if (select count(distinct x.linea_id) from jsonb_to_recordset(p_precios) as x(linea_id uuid,precio_unitario numeric,tratamiento_tributario text,tasa_tributaria numeric))<>v_expected then
    raise exception 'Cada línea debe aparecer una sola vez.' using errcode='22023';
  end if;
  select id,version into v_previous,v_version from public.ofertas_compra
    where solicitud_id=p_solicitud_id and proveedor_id=p_proveedor_id and es_version_actual for update;
  if found then
    update public.ofertas_compra set estado='Sustituida',es_version_actual=false,updated_at=clock_timestamp() where id=v_previous;
    v_version:=v_version+1;
  else
    select coalesce(max(version),0)+1 into v_version from public.ofertas_compra where solicitud_id=p_solicitud_id and proveedor_id=p_proveedor_id;
  end if;
  insert into public.ofertas_compra(solicitud_id,proveedor_id,vigencia_hasta,plazo_entrega_dias,condiciones,
    estado,created_by,version,version_anterior_id,es_version_actual,idempotency_key,payload_hash,moneda,exchange_rate)
    values(p_solicitud_id,p_proveedor_id,p_vigencia_hasta,p_plazo_entrega_dias,trim(coalesce(p_condiciones,'')),
      'Vigente',v_uid,v_version,v_previous,true,p_idempotency_key,v_hash,p_moneda,p_exchange_rate) returning id into v_id;
  insert into public.detalle_ofertas_compra(oferta_id,solicitud_linea_id,precio_unitario,tratamiento_tributario,tasa_tributaria)
    select v_id,x.linea_id,x.precio_unitario,x.tratamiento_tributario,x.tasa_tributaria
    from jsonb_to_recordset(p_precios) as x(linea_id uuid,precio_unitario numeric,tratamiento_tributario text,tasa_tributaria numeric);
  return v_id;
end
$function$;

-- Comparativo fiscal en PEN: cantidades convertidas con techo (D10), costo de
-- orden a 2 decimales, cálculo de impuesto por línea con tasa de Fase C y FX
-- snapshot de la oferta. Las propuestas en cero o incompletas no son elegibles.
create or replace function public.seleccionar_oferta_compra_v4(
  p_solicitud_id uuid,p_oferta_id uuid,p_motivo text,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_hash text; v_saved app_private.purchase_transition_idempotency%rowtype;
  v_request public.solicitudes_compra%rowtype; v_offer public.ofertas_compra%rowtype;
  v_chosen numeric; v_lowest numeric; v_line_count integer;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar')) then
    raise exception 'No tienes permiso para seleccionar ofertas.' using errcode='42501';
  end if;
  if p_solicitud_id is null or p_oferta_id is null or length(trim(coalesce(p_motivo,''))) not between 4 and 500
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'La selección requiere motivo y clave de idempotencia válidos.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('solicitud_id',p_solicitud_id,'oferta_id',p_oferta_id,'motivo',trim(p_motivo))::text);
  perform pg_advisory_xact_lock(hashtextextended('purchase-transition:'||p_idempotency_key,0));
  select * into v_saved from app_private.purchase_transition_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'seleccionar_oferta_con_motivo' or v_saved.payload_hash<>v_hash then raise exception 'Clave usada con otro contenido.' using errcode='23505'; end if;
    return v_saved.result_id;
  end if;
  select * into v_request from public.solicitudes_compra where id=p_solicitud_id for update;
  if not found or v_request.estado<>'Abierta' then raise exception 'La solicitud no está abierta.' using errcode='23514'; end if;
  select * into v_offer from public.ofertas_compra where id=p_oferta_id and solicitud_id=p_solicitud_id
    and estado='Vigente' and es_version_actual for update;
  if not found then raise exception 'Oferta ajena, retirada o no vigente.' using errcode='23514'; end if;
  if v_offer.vigencia_hasta is not null and v_offer.vigencia_hasta<current_date then raise exception 'La oferta está vencida.' using errcode='23514'; end if;
  select count(*) into v_line_count from public.solicitud_compra_lineas where solicitud_id=p_solicitud_id;
  select round(sum(t.total)*v_offer.exchange_rate,2) into v_chosen from (
    select tax.total from public.detalle_ofertas_compra d
    join public.solicitud_compra_lineas l on l.id=d.solicitud_linea_id
    cross join lateral app_private._calcular_impuestos_compra_v1(
      d.tratamiento_tributario,ceil(l.cantidad)*round(d.precio_unitario,2),d.tasa_tributaria) tax
    where d.oferta_id=p_oferta_id and l.solicitud_id=p_solicitud_id
  ) t;
  if (select count(*) from public.detalle_ofertas_compra d join public.solicitud_compra_lineas l on l.id=d.solicitud_linea_id
      where d.oferta_id=p_oferta_id and l.solicitud_id=p_solicitud_id)<>v_line_count or coalesce(v_chosen,0)<=0 then
    raise exception 'La oferta está incompleta o su total es cero; no puede ganar por defecto.' using errcode='23514';
  end if;
  select min(t.total_pen) into v_lowest from (
    select o.id,round(sum(x.line_total)*o.exchange_rate,2) as total_pen
    from public.ofertas_compra o
    join public.detalle_ofertas_compra d on d.oferta_id=o.id
    join public.solicitud_compra_lineas l on l.id=d.solicitud_linea_id and l.solicitud_id=p_solicitud_id
    cross join lateral app_private._calcular_impuestos_compra_v1(
      d.tratamiento_tributario,ceil(l.cantidad)*round(d.precio_unitario,2),d.tasa_tributaria) x
    where o.solicitud_id=p_solicitud_id and o.estado='Vigente' and o.es_version_actual
      and (o.vigencia_hasta is null or o.vigencia_hasta>=current_date)
      and d.tratamiento_tributario in ('Gravado','Exonerado','Inafecto') and d.tasa_tributaria in (0,18)
    group by o.id,o.exchange_rate
    having count(*)=v_line_count and round(sum(x.total)*o.exchange_rate,2)>0
  ) t;
  if v_chosen>v_lowest and length(trim(p_motivo))<12 then
    raise exception 'No es la oferta de menor total con impuestos en PEN; justifica con al menos 12 caracteres.' using errcode='22023';
  end if;
  update public.ofertas_compra set estado='Seleccionada',seleccionado_por=v_uid,seleccionado_en=clock_timestamp(),updated_at=clock_timestamp() where id=p_oferta_id;
  update public.solicitudes_compra set seleccion_oferta_id=p_oferta_id,estado='Cerrada',seleccion_motivo=trim(p_motivo),
    seleccionado_por=v_uid,seleccionado_en=clock_timestamp(),updated_by=v_uid,updated_at=clock_timestamp() where id=p_solicitud_id;
  insert into app_private.purchase_transition_idempotency(idempotency_key,operation,payload_hash,result_id,result_version)
    values(p_idempotency_key,'seleccionar_oferta_con_motivo',v_hash,p_solicitud_id,v_request.version);
  return p_solicitud_id;
end
$function$;

-- Conversión todo-o-nada a UNA orden real de bienes. Requiere vínculo único de
-- cada línea con el catálogo del proveedor ganador y conserva IDs de origen.
create or replace function public.convertir_solicitud_a_orden_v1(
  p_solicitud_id uuid,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_request public.solicitudes_compra%rowtype;
  v_offer public.ofertas_compra%rowtype; v_saved app_private.purchase_sourcing_conversion%rowtype;
  v_payload jsonb:='[]'::jsonb; v_order uuid; v_hash text; v_line record;
  v_catalog_id uuid; v_matches integer; v_count integer;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','crear')) then
    raise exception 'Se requiere permiso de Compras para convertir la selección.' using errcode='42501';
  end if;
  if p_solicitud_id is null or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 110 then
    raise exception 'Solicitud y clave de idempotencia válidas son obligatorias.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sourcing-conversion:'||p_idempotency_key,0));
  select * into v_saved from app_private.purchase_sourcing_conversion where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.solicitud_id<>p_solicitud_id then raise exception 'La clave de idempotencia ya corresponde a otra solicitud.' using errcode='23505'; end if;
    return v_saved.compra_id;
  end if;
  select * into v_request from public.solicitudes_compra where id=p_solicitud_id for update;
  if not found or v_request.estado<>'Cerrada' or v_request.seleccion_oferta_id is null then
    raise exception 'La solicitud debe tener una oferta seleccionada y estar cerrada.' using errcode='23514';
  end if;
  select * into v_offer from public.ofertas_compra where id=v_request.seleccion_oferta_id and solicitud_id=p_solicitud_id
    and estado='Seleccionada' and es_version_actual for update;
  if not found then raise exception 'La versión seleccionada no está disponible.' using errcode='23514'; end if;
  select * into v_saved from app_private.purchase_sourcing_conversion where solicitud_id=p_solicitud_id;
  if found then
    if v_saved.idempotency_key<>p_idempotency_key then raise exception 'La solicitud ya fue convertida en una orden.' using errcode='23505'; end if;
    return v_saved.compra_id;
  end if;
  if exists(select 1 from public.compras where solicitud_compra_id=p_solicitud_id) then
    raise exception 'Ya existe una orden asociada a esta solicitud.' using errcode='23505';
  end if;
  for v_line in
    select l.id as solicitud_linea_id,l.producto_id,l.descripcion,l.unidad,l.cantidad,
      d.id as detalle_oferta_id,d.precio_unitario,d.tratamiento_tributario,d.tasa_tributaria
    from public.solicitud_compra_lineas l
    left join public.detalle_ofertas_compra d on d.solicitud_linea_id=l.id and d.oferta_id=v_offer.id
    where l.solicitud_id=p_solicitud_id order by l.id
  loop
    if v_line.producto_id is null or v_line.detalle_oferta_id is null then
      raise exception 'Cada línea debe tener producto maestro y cotización para generar una orden de bienes.' using errcode='23514';
    end if;
    select count(*),(array_agg(pp.id))[1] into v_matches,v_catalog_id from public.proveedor_productos pp
      where pp.proveedor_id=v_offer.proveedor_id and pp.producto_id=v_line.producto_id;
    if v_matches<>1 then
      raise exception 'El artículo % debe tener exactamente un vínculo en el catálogo del proveedor ganador.',v_line.descripcion using errcode='23514';
    end if;
    if ceil(v_line.cantidad)>2147483647 then raise exception 'La cantidad supera el límite de una orden.' using errcode='22003'; end if;
    if exists(select 1 from jsonb_array_elements(v_payload) x where x->>'producto_id'=v_catalog_id::text) then
      raise exception 'La solicitud contiene líneas que se mapean al mismo artículo del proveedor; consolídalas antes de seleccionar.' using errcode='23514';
    end if;
    v_payload:=v_payload||jsonb_build_array(jsonb_build_object(
      'producto_id',v_catalog_id,'cantidad',ceil(v_line.cantidad),'precio',round(v_line.precio_unitario,2),
      'tratamiento_tributario',v_line.tratamiento_tributario,'tasa_tributaria',v_line.tasa_tributaria));
  end loop;
  select count(*) into v_count from public.solicitud_compra_lineas where solicitud_id=p_solicitud_id;
  if v_count=0 or jsonb_array_length(v_payload)<>v_count then raise exception 'La solicitud no tiene líneas convertibles.' using errcode='23514'; end if;
  v_hash:=md5(jsonb_build_object('solicitud_id',p_solicitud_id,'oferta_id',v_offer.id,'lineas',v_payload,
    'moneda',v_offer.moneda,'exchange_rate',v_offer.exchange_rate)::text);
  v_order:=public.crear_orden_compra_operativa_v4(
    v_offer.proveedor_id,'Solicitud '||v_request.codigo||' · '||coalesce(v_request.detalle,''),
    v_request.fecha_necesidad,null,v_payload,'sourcing:'||p_idempotency_key,v_offer.moneda,v_offer.exchange_rate);
  update public.compras set solicitud_compra_id=p_solicitud_id,oferta_compra_id=v_offer.id where id=v_order;
  for v_line in select l.id as solicitud_linea_id,d.id as detalle_oferta_id,pp.id as proveedor_producto_id
    from public.solicitud_compra_lineas l
    join public.detalle_ofertas_compra d on d.solicitud_linea_id=l.id and d.oferta_id=v_offer.id
    join public.proveedor_productos pp on pp.proveedor_id=v_offer.proveedor_id and pp.producto_id=l.producto_id
    where l.solicitud_id=p_solicitud_id and l.producto_id is not null
  loop
    update public.detalle_compras set solicitud_compra_id=p_solicitud_id,oferta_compra_id=v_offer.id,
      solicitud_linea_id=v_line.solicitud_linea_id,detalle_oferta_id=v_line.detalle_oferta_id
      where compra_id=v_order and proveedor_producto_id=v_line.proveedor_producto_id;
    get diagnostics v_matches=row_count;
    if v_matches<>1 then raise exception 'No se pudieron conservar todos los vínculos de trazabilidad.' using errcode='23514'; end if;
  end loop;
  insert into app_private.purchase_sourcing_conversion(solicitud_id,oferta_id,compra_id,idempotency_key,payload_hash,actor_id)
    values(p_solicitud_id,v_offer.id,v_order,p_idempotency_key,v_hash,v_uid);
  return v_order;
end
$function$;

-- Listado paginado: solo cabeceras y contadores; el detalle se pide al expandir.
create or replace function public.listar_solicitudes_compra_paginado_v1(
  p_estado text default null,p_desde date default null,p_hasta date default null,
  p_referencia text default null,p_limit integer default 20,p_offset integer default 0
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_items jsonb; v_total bigint; v_limit integer:=least(greatest(coalesce(p_limit,20),1),100); v_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if (select auth.uid()) is null or not (select app_private._tiene_permiso('compras','ver')) then raise exception 'No tienes permiso para consultar solicitudes.' using errcode='42501'; end if;
  if p_estado is not null and p_estado not in ('Borrador','Abierta','Cerrada','Cancelada') then raise exception 'Estado inválido.' using errcode='22023'; end if;
  if p_desde is not null and p_hasta is not null and p_desde>p_hasta then raise exception 'Rango de fechas inválido.' using errcode='22023'; end if;
  with filtered as (
    select s.* from public.solicitudes_compra s
    where (p_estado is null or s.estado=p_estado)
      and (p_desde is null or s.fecha_necesidad>=p_desde)
      and (p_hasta is null or s.fecha_necesidad<=p_hasta)
      and (nullif(trim(p_referencia),'') is null or s.codigo ilike '%'||trim(p_referencia)||'%'
        or s.detalle ilike '%'||trim(p_referencia)||'%'
        or exists(select 1 from public.ofertas_compra o join public.proveedores p on p.id=o.proveedor_id
          where o.solicitud_id=s.id and (p.razon_social ilike '%'||trim(p_referencia)||'%' or p.codigo ilike '%'||trim(p_referencia)||'%')))
  )
  select count(*) into v_total from filtered;
  with page as (
    select s.* from public.solicitudes_compra s
    where (p_estado is null or s.estado=p_estado)
      and (p_desde is null or s.fecha_necesidad>=p_desde)
      and (p_hasta is null or s.fecha_necesidad<=p_hasta)
      and (nullif(trim(p_referencia),'') is null or s.codigo ilike '%'||trim(p_referencia)||'%'
        or s.detalle ilike '%'||trim(p_referencia)||'%'
        or exists(select 1 from public.ofertas_compra o join public.proveedores p on p.id=o.proveedor_id
          where o.solicitud_id=s.id and (p.razon_social ilike '%'||trim(p_referencia)||'%' or p.codigo ilike '%'||trim(p_referencia)||'%')))
    order by s.created_at desc,s.id desc limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'codigo',p.codigo,'estado',p.estado,'version',p.version,
    'fecha_necesidad',p.fecha_necesidad,'detalle',p.detalle,'created_at',p.created_at,
    'seleccion_oferta_id',p.seleccion_oferta_id,'seleccion_motivo',p.seleccion_motivo,
    'cancelacion_motivo',p.cancelacion_motivo,'orden_compra_id',c.id,'orden_codigo',c.codigo,
    'line_count',(select count(*) from public.solicitud_compra_lineas l where l.solicitud_id=p.id),
    'offer_count',(select count(*) from public.ofertas_compra o where o.solicitud_id=p.id)) order by p.created_at desc,p.id desc),'[]'::jsonb)
  into v_items from page p left join public.compras c on c.solicitud_compra_id=p.id;
  return jsonb_build_object('items',v_items,'total',v_total,'limit',v_limit,'offset',v_offset);
end
$function$;

create or replace function public.obtener_detalle_solicitud_compra_v1(p_solicitud_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_result jsonb;
begin
  if (select auth.uid()) is null or not (select app_private._tiene_permiso('compras','ver')) then raise exception 'No tienes permiso para consultar solicitudes.' using errcode='42501'; end if;
  select jsonb_build_object('id',s.id,'codigo',s.codigo,'estado',s.estado,'version',s.version,
    'fecha_necesidad',s.fecha_necesidad,'detalle',s.detalle,'created_at',s.created_at,
    'seleccion_oferta_id',s.seleccion_oferta_id,'seleccion_motivo',s.seleccion_motivo,
    'seleccionado_por',s.seleccionado_por,'seleccionado_en',s.seleccionado_en,
    'cancelacion_motivo',s.cancelacion_motivo,'cancelado_por',s.cancelado_por,'cancelado_en',s.cancelado_en,
    'updated_by',s.updated_by,'orden_compra_id',c.id,'orden_codigo',c.codigo,
    'solicitud_compra_lineas',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'producto_id',l.producto_id,
      'unidad_medida_id',l.unidad_medida_id,'descripcion',l.descripcion,'cantidad',l.cantidad,'unidad',l.unidad) order by l.id),'[]'::jsonb)
      from public.solicitud_compra_lineas l where l.solicitud_id=s.id),
    'ofertas_compra',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'codigo',o.codigo,'proveedor_id',o.proveedor_id,
      'vigencia_hasta',o.vigencia_hasta,'plazo_entrega_dias',o.plazo_entrega_dias,'condiciones',o.condiciones,'estado',o.estado,
      'version',o.version,'version_anterior_id',o.version_anterior_id,'es_version_actual',o.es_version_actual,
      'seleccionado_por',o.seleccionado_por,'seleccionado_en',o.seleccionado_en,'moneda',o.moneda,'exchange_rate',o.exchange_rate,
      'proveedores',jsonb_build_object('razon_social',p.razon_social),
      'detalle_ofertas_compra',(select coalesce(jsonb_agg(jsonb_build_object('solicitud_linea_id',d.solicitud_linea_id,
        'precio_unitario',d.precio_unitario,'tratamiento_tributario',d.tratamiento_tributario,'tasa_tributaria',d.tasa_tributaria)
        order by d.solicitud_linea_id),'[]'::jsonb) from public.detalle_ofertas_compra d where d.oferta_id=o.id)) order by o.proveedor_id,o.version),'[]'::jsonb)
      from public.ofertas_compra o join public.proveedores p on p.id=o.proveedor_id where o.solicitud_id=s.id))
  into v_result from public.solicitudes_compra s left join public.compras c on c.solicitud_compra_id=s.id where s.id=p_solicitud_id;
  if v_result is null then raise exception 'La solicitud no existe.' using errcode='23503'; end if;
  return v_result;
end
$function$;

-- Búsqueda paginada de proveedores para el flujo de Compras, sin depender de
-- permisos generales de lectura de Maestros.
create or replace function public.listar_proveedores_compra_paginado_v1(
  p_busqueda text default null,p_limit integer default 20,p_offset integer default 0
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_items jsonb; v_total bigint; v_limit integer:=least(greatest(coalesce(p_limit,20),1),100); v_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if (select auth.uid()) is null or not (select app_private._tiene_permiso('compras','crear')) then raise exception 'Se requiere permiso de Compras para consultar proveedores.' using errcode='42501'; end if;
  select count(*) into v_total from public.proveedores p where p.estado::text='Activo'
    and (nullif(trim(p_busqueda),'') is null or p.razon_social ilike '%'||trim(p_busqueda)||'%' or p.codigo ilike '%'||trim(p_busqueda)||'%');
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'codigo',q.codigo,'razon_social',q.razon_social) order by q.razon_social,q.id),'[]'::jsonb)
    into v_items from (select p.id,p.codigo,p.razon_social from public.proveedores p where p.estado::text='Activo'
      and (nullif(trim(p_busqueda),'') is null or p.razon_social ilike '%'||trim(p_busqueda)||'%' or p.codigo ilike '%'||trim(p_busqueda)||'%')
      order by p.razon_social,p.id limit v_limit offset v_offset) q;
  return jsonb_build_object('items',v_items,'total',v_total,'limit',v_limit,'offset',v_offset);
end
$function$;

create or replace function public.listar_monedas_compra_v1()
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  if (select auth.uid()) is null or not (select app_private._tiene_permiso('compras','crear')) then
    raise exception 'Se requiere permiso de Compras para consultar monedas.' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('codigo',m.codigo,'nombre',m.nombre,'simbolo',m.simbolo) order by m.codigo)
    from public.monedas m where m.activo and m.codigo in ('PEN','USD')),'[]'::jsonb);
end
$function$;

revoke all on function public.registrar_oferta_compra_v4(uuid,uuid,date,integer,text,jsonb,text,text,numeric) from public,anon;
revoke all on function public.seleccionar_oferta_compra_v4(uuid,uuid,text,text) from public,anon;
revoke all on function public.convertir_solicitud_a_orden_v1(uuid,text) from public,anon;
revoke all on function public.listar_solicitudes_compra_paginado_v1(text,date,date,text,integer,integer) from public,anon;
revoke all on function public.obtener_detalle_solicitud_compra_v1(uuid) from public,anon;
revoke all on function public.listar_proveedores_compra_paginado_v1(text,integer,integer) from public,anon;
revoke all on function public.listar_monedas_compra_v1() from public,anon;
grant execute on function public.registrar_oferta_compra_v4(uuid,uuid,date,integer,text,jsonb,text,text,numeric) to authenticated;
grant execute on function public.seleccionar_oferta_compra_v4(uuid,uuid,text,text) to authenticated;
grant execute on function public.convertir_solicitud_a_orden_v1(uuid,text) to authenticated;
grant execute on function public.listar_solicitudes_compra_paginado_v1(text,date,date,text,integer,integer) to authenticated;
grant execute on function public.obtener_detalle_solicitud_compra_v1(uuid) to authenticated;
grant execute on function public.listar_proveedores_compra_paginado_v1(text,integer,integer) to authenticated;
grant execute on function public.listar_monedas_compra_v1() to authenticated;

-- Retira las versiones v3, ya sustituidas por v4. DROP ... IF EXISTS evita el
-- 42883 cuando la migración 08 no llegó a crear la función por un fallo previo.
drop function if exists public.registrar_oferta_compra_v3(uuid,uuid,date,integer,text,jsonb,text);
drop function if exists public.seleccionar_oferta_compra_v3(uuid,uuid,text,text);

commit;
