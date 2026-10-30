-- F14: cierre terminal, motivado e idempotente de contratos marco.
-- Aplicar manualmente en el remoto después de las migraciones F01-F09.
begin;

alter table public.contratos_compra
  add column if not exists cerrado_por uuid references public.usuarios(id) on delete restrict,
  add column if not exists cerrado_en timestamptz,
  add column if not exists cierre_motivo text;

alter table public.contratos_compra drop constraint if exists contratos_compra_cierre_auditoria_check;
alter table public.contratos_compra add constraint contratos_compra_cierre_auditoria_check
  check (
    (estado='Cerrado' and cerrado_por is not null and cerrado_en is not null
      and cierre_motivo is not null and length(trim(cierre_motivo)) between 5 and 500)
    or
    (estado<>'Cerrado' and cerrado_por is null and cerrado_en is null and cierre_motivo is null)
  );

alter table public.contratos_compra_historial drop constraint if exists contratos_compra_historial_evento_check;
alter table public.contratos_compra_historial add constraint contratos_compra_historial_evento_check
  check(evento in ('Creado','Nueva versión','Activado','Suspendido','Cerrado'));

alter table app_private.contract_purchase_idempotency
  drop constraint if exists contract_purchase_idempotency_operation_check;
alter table app_private.contract_purchase_idempotency add constraint contract_purchase_idempotency_operation_check
  check(operation in ('crear','versionar','activar','suspender','cerrar'));

-- Impide saltarse el RPC, cambiar atributos o reabrir un contrato terminal.
create or replace function app_private._proteger_cierre_contrato_compra_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if tg_op='DELETE' then
    if old.estado='Cerrado' then
      raise exception 'Un contrato cerrado es terminal y no se puede eliminar.' using errcode='23514';
    end if;
    return old;
  end if;

  if old.estado='Cerrado' then
    raise exception 'Un contrato cerrado es terminal e inmutable.' using errcode='23514';
  end if;

  if new.estado='Cerrado' then
    if current_setting('app.ec_close_purchase_contract_rpc',true) is distinct from 'on'
       or new.cerrado_por is null or new.cerrado_en is null
       or length(trim(coalesce(new.cierre_motivo,''))) not between 5 and 500 then
      raise exception 'Cierre inválido: use cerrar_contrato_compra_v1 con actor y motivo.' using errcode='23514';
    end if;
  elsif new.cerrado_por is not null or new.cerrado_en is not null or new.cierre_motivo is not null then
    raise exception 'Los datos de cierre solo se registran al cerrar el contrato.' using errcode='23514';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_proteger_cierre_contrato_compra on public.contratos_compra;
create trigger trg_proteger_cierre_contrato_compra
  before update or delete on public.contratos_compra
  for each row execute function app_private._proteger_cierre_contrato_compra_v1();
revoke all on function app_private._proteger_cierre_contrato_compra_v1() from public,anon,authenticated;

create or replace function public.cerrar_contrato_compra_v1(
  p_contrato_id uuid,p_motivo text,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid());
  v_contract public.contratos_compra%rowtype;
  v_saved app_private.contract_purchase_idempotency%rowtype;
  v_hash text;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar')) then
    raise exception 'Se requiere permiso de edición de Compras para cerrar contratos.' using errcode='42501';
  end if;
  if p_contrato_id is null or length(trim(coalesce(p_motivo,''))) not between 5 and 500
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'El cierre requiere contrato, motivo (5-500 caracteres) y clave idempotente válidos.' using errcode='22023';
  end if;

  v_hash:=md5(jsonb_build_object('contrato_id',p_contrato_id,'motivo',trim(p_motivo))::text);
  perform pg_advisory_xact_lock(hashtextextended('contrato-compra:'||p_idempotency_key,0));
  select * into v_saved from app_private.contract_purchase_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'cerrar' or v_saved.payload_hash<>v_hash then
      raise exception 'La clave de idempotencia ya se usó con otros datos.' using errcode='23505';
    end if;
    return v_saved.contrato_id;
  end if;

  -- La misma fila que bloquea las liberaciones serializa el cierre frente a nuevas órdenes.
  select * into v_contract from public.contratos_compra where id=p_contrato_id for update;
  if not found then raise exception 'El contrato no existe.' using errcode='23503'; end if;
  if v_contract.estado='Cerrado' then raise exception 'El contrato ya está cerrado y no se puede modificar.' using errcode='23514'; end if;

  perform set_config('app.ec_close_purchase_contract_rpc','on',true);
  update public.contratos_compra
    set estado='Cerrado',cerrado_por=v_uid,cerrado_en=clock_timestamp(),cierre_motivo=trim(p_motivo),updated_at=clock_timestamp()
    where id=p_contrato_id;

  insert into public.contratos_compra_historial(contrato_id,version_id,evento,actor_id,motivo,datos,idempotency_key)
    values(p_contrato_id,v_contract.version_actual_id,'Cerrado',v_uid,trim(p_motivo),
      jsonb_build_object('estado_anterior',v_contract.estado,'cerrado_en',clock_timestamp()),p_idempotency_key);
  insert into app_private.contract_purchase_idempotency(idempotency_key,operation,payload_hash,contrato_id,version_id,result_id,actor_id)
    values(p_idempotency_key,'cerrar',v_hash,p_contrato_id,v_contract.version_actual_id,p_contrato_id,v_uid);
  return p_contrato_id;
end
$function$;

revoke all on function public.cerrar_contrato_compra_v1(uuid,text,text) from public,anon;
grant execute on function public.cerrar_contrato_compra_v1(uuid,text,text) to authenticated;

commit;
