begin;
set local lock_timeout = '5s';

-- Los wrappers públicos SECURITY INVOKER llaman estas funciones privadas.
grant usage on schema app_private to authenticated;

-- La moneda de cada movimiento se deriva de las obligaciones aplicadas. Los
-- registros históricos solo se rellenan cuando aplicaciones, importe, tipo y
-- moneda coinciden sin ambigüedad.
alter table public.movimientos_tesoreria
  add column if not exists moneda character(3);

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.movimientos_tesoreria'::regclass
      and conname = 'movimientos_tesoreria_moneda_ck'
  ) then
    alter table public.movimientos_tesoreria
      add constraint movimientos_tesoreria_moneda_ck
      check (moneda is null or btrim(moneda::text) in ('PEN', 'USD'));
  end if;
end
$migration$;

comment on column public.movimientos_tesoreria.moneda is
  'Moneda de las obligaciones aplicadas. NULL identifica filas históricas que no pudieron conciliarse sin suposición.';

with aplicaciones_conciliadas as (
  select
    m.id,
    min(btrim(p.moneda::text)) as moneda
  from public.movimientos_tesoreria m
  join public.aplicaciones_pago a on a.movimiento_id = m.id
  left join public.pagos p on p.id = a.cuenta_id
  group by m.id, m.tipo, m.monto
  having count(a.id) > 0
     and count(a.id) = count(p.id)
     and count(distinct btrim(p.moneda::text)) = 1
     and min(btrim(p.moneda::text)) in ('PEN', 'USD')
     and sum(a.monto) = m.monto
     and bool_and(
       (m.tipo = 'cobro' and p.tipo = 'cobrar')
       or (m.tipo = 'pago' and p.tipo = 'pagar')
     )
)
update public.movimientos_tesoreria m
set moneda = c.moneda::character(3)
from aplicaciones_conciliadas c
where m.id = c.id and m.moneda is null;

alter table public.caja_turnos
  add column if not exists monto_inicial_usd numeric(14,2) not null default 0,
  add column if not exists conteo_usd numeric(14,2),
  add column if not exists saldo_esperado_pen numeric(14,2),
  add column if not exists saldo_esperado_usd numeric(14,2),
  add column if not exists descuadre_pen numeric(14,2),
  add column if not exists descuadre_usd numeric(14,2);

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.caja_turnos'::regclass
      and conname = 'caja_turnos_monto_inicial_usd_ck'
  ) then
    alter table public.caja_turnos
      add constraint caja_turnos_monto_inicial_usd_ck
      check (monto_inicial_usd >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.caja_turnos'::regclass
      and conname = 'caja_turnos_conteo_usd_ck'
  ) then
    alter table public.caja_turnos
      add constraint caja_turnos_conteo_usd_ck
      check (conteo_usd is null or conteo_usd >= 0);
  end if;
end
$migration$;

comment on column public.caja_turnos.monto_inicial is
  'Efectivo inicial en PEN; la interfaz histórica identificaba explícitamente el monto como soles.';
comment on column public.caja_turnos.monto_inicial_usd is
  'Efectivo inicial en USD. Los turnos anteriores se conservan con cero porque el formulario previo solo admitía PEN.';
comment on column public.caja_turnos.conteo_usd is
  'Conteo de cierre USD. NULL en cierres anteriores significa que no se registró un conteo separado por moneda.';
comment on column public.caja_turnos.saldo_esperado_pen is
  'Saldo PEN esperado calculado bajo bloqueo del turno al cerrarlo; NULL para cierres históricos.';
comment on column public.caja_turnos.saldo_esperado_usd is
  'Saldo USD esperado calculado bajo bloqueo del turno al cerrarlo; NULL para cierres históricos.';
comment on column public.caja_turnos.descuadre_pen is
  'Conteo PEN menos saldo esperado al cerrar; NULL para cierres históricos.';
comment on column public.caja_turnos.descuadre_usd is
  'Conteo USD menos saldo esperado al cerrar; NULL para cierres históricos.';

create or replace function public.registrar_pago_parcial(
  p_tipo text,
  p_monto numeric,
  p_medio_pago text,
  p_referencia text,
  p_aplicaciones jsonb,
  p_idempotency_key text,
  p_nota text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_hash text;
  v_mov uuid;
  v_old public.movimientos_tesoreria%rowtype;
  v_line jsonb;
  v_cuenta uuid;
  v_aplicar numeric(14,2);
  v_tipo_cuenta text;
  v_moneda_cuenta character(3);
  v_moneda text;
  v_obligacion numeric(14,2);
  v_total_aplicado numeric(14,2);
  v_total numeric(14,2) := 0;
  v_compra_id uuid;
  v_venta_id uuid;
begin
  if v_uid is null or not (select public.tiene_permiso('finanzas','crear')) then
    raise exception 'Se requiere permiso para registrar cobros y pagos.' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('cobro','pago') or p_monto is null or p_monto <= 0
     or p_monto::text in ('NaN','Infinity','-Infinity')
     or jsonb_typeof(p_aplicaciones) <> 'array' or jsonb_array_length(p_aplicaciones) = 0 then
    raise exception 'El movimiento o sus aplicaciones no son válidos.' using errcode = '22023';
  end if;
  if nullif(trim(p_idempotency_key),'') is null then
    raise exception 'Falta la clave de idempotencia.' using errcode = '22023';
  end if;
  if (select count(*) from (
        select value->>'cuenta_id'
        from jsonb_array_elements(p_aplicaciones)
        group by value->>'cuenta_id'
      ) x) <> jsonb_array_length(p_aplicaciones) then
    raise exception 'Cada cuenta solo puede aparecer una vez por movimiento.' using errcode = '22023';
  end if;

  v_hash := md5(concat_ws('|', p_tipo, p_monto, coalesce(p_medio_pago,''),
    coalesce(p_referencia,''), p_aplicaciones::text, coalesce(p_nota,'')));
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
  select * into v_old
  from public.movimientos_tesoreria
  where idempotency_key = p_idempotency_key;
  if found then
    if v_old.payload_hash <> v_hash then
      raise exception 'La clave ya pertenece a otro movimiento.' using errcode = '23505';
    end if;
    if v_old.moneda is null
       or not exists (
         select 1 from public.aplicaciones_pago a
         where a.movimiento_id = v_old.id
       )
       or exists (
         select 1
         from public.aplicaciones_pago a
         join public.pagos p on p.id = a.cuenta_id
         where a.movimiento_id = v_old.id
           and btrim(p.moneda::text) <> btrim(v_old.moneda::text)
       ) then
      raise exception 'El movimiento anterior tiene moneda sin conciliar; requiere revisión manual.' using errcode = '23514';
    end if;
    return v_old.id;
  end if;

  for v_line in
    select value from jsonb_array_elements(p_aplicaciones) order by value->>'cuenta_id'
  loop
    v_cuenta := (v_line->>'cuenta_id')::uuid;
    v_aplicar := round((v_line->>'monto')::numeric, 2);
    if v_aplicar is null or v_aplicar <= 0
       or v_aplicar::text in ('NaN','Infinity','-Infinity') then
      raise exception 'Cada aplicación debe ser mayor que cero.' using errcode = '22023';
    end if;

    select tipo, monto, moneda
    into v_tipo_cuenta, v_obligacion, v_moneda_cuenta
    from public.pagos
    where id = v_cuenta
    for update;
    if not found then
      raise exception 'La cuenta no existe.' using errcode = '23503';
    end if;
    if (p_tipo = 'cobro' and v_tipo_cuenta <> 'cobrar')
       or (p_tipo = 'pago' and v_tipo_cuenta <> 'pagar') then
      raise exception 'El movimiento no coincide con el tipo de cuenta.' using errcode = '23514';
    end if;
    if btrim(v_moneda_cuenta::text) not in ('PEN','USD') then
      raise exception 'La cuenta tiene una moneda que Tesorería no puede aplicar.' using errcode = '22023';
    end if;
    if v_moneda is null then
      v_moneda := btrim(v_moneda_cuenta::text);
    elsif v_moneda <> btrim(v_moneda_cuenta::text) then
      raise exception 'Un movimiento no puede aplicar cuentas de monedas distintas.' using errcode = '22023';
    end if;

    select coalesce(sum(a.monto), 0)::numeric(14,2)
    into v_total_aplicado
    from public.aplicaciones_pago a
    join public.movimientos_tesoreria m on m.id = a.movimiento_id
    where a.cuenta_id = v_cuenta and m.anulado_en is null;
    if v_aplicar > v_obligacion - v_total_aplicado then
      raise exception 'La aplicación excede el saldo pendiente.' using errcode = '23514';
    end if;
    v_total := v_total + v_aplicar;
  end loop;

  if v_moneda is null or round(v_total, 2) <> round(p_monto, 2) then
    raise exception 'Las aplicaciones deben sumar el importe del movimiento en una moneda común.' using errcode = '23514';
  end if;

  insert into public.movimientos_tesoreria
    (codigo, tipo, monto, moneda, medio_pago, referencia, nota, idempotency_key, payload_hash, created_by)
  values
    ('', p_tipo, round(p_monto, 2), v_moneda::character(3), nullif(trim(p_medio_pago),''),
     nullif(trim(p_referencia),''), nullif(trim(p_nota),''), p_idempotency_key, v_hash, v_uid)
  returning id into v_mov;

  for v_line in
    select value from jsonb_array_elements(p_aplicaciones) order by value->>'cuenta_id'
  loop
    v_cuenta := (v_line->>'cuenta_id')::uuid;
    v_aplicar := round((v_line->>'monto')::numeric, 2);
    insert into public.aplicaciones_pago(movimiento_id, cuenta_id, monto)
      values(v_mov, v_cuenta, v_aplicar);

    select monto, compra_id, venta_id
    into v_obligacion, v_compra_id, v_venta_id
    from public.pagos
    where id = v_cuenta;
    select coalesce(sum(a.monto), 0)::numeric(14,2)
    into v_total_aplicado
    from public.aplicaciones_pago a
    join public.movimientos_tesoreria m on m.id = a.movimiento_id
    where a.cuenta_id = v_cuenta and m.anulado_en is null;

    update public.pagos
    set estado_cobro = case
          when v_total_aplicado >= v_obligacion then 'completa'
          when v_total_aplicado > 0 then 'parcial'
          else 'pendiente'
        end,
        estado = case when v_total_aplicado >= v_obligacion then 'Completada' else 'Pendiente' end
    where id = v_cuenta;

    if v_total_aplicado >= v_obligacion and v_compra_id is not null then
      update public.compras
      set estado = 'Pagada'
      where id = v_compra_id
        and (estado_recepcion = 'completa' or requiere_recepcion = false)
        and estado::text not in ('Cancelada', 'Rechazada', 'Pagada');
    end if;
    if v_total_aplicado >= v_obligacion and v_venta_id is not null then
      update public.ventas
      set estado = 'Completada'
      where id = v_venta_id
        and estado::text not in ('Cancelada', 'Rechazada', 'Completada');
    end if;
  end loop;

  return v_mov;
end
$function$;

create or replace function app_private.registrar_pago_parcial_en_turno(
  p_tipo text,
  p_monto numeric,
  p_medio_pago text,
  p_referencia text,
  p_aplicaciones jsonb,
  p_idempotency_key text,
  p_nota text default null,
  p_caja_turno_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_mov uuid;
  v_old_turno uuid;
  v_estado text;
begin
  if v_uid is null or not (select public.tiene_permiso('finanzas','crear')) then
    raise exception 'Se requiere permiso para registrar cobros y pagos.' using errcode = '42501';
  end if;

  select id, caja_turno_id
  into v_mov, v_old_turno
  from public.movimientos_tesoreria
  where idempotency_key = p_idempotency_key;
  if found then
    v_mov := public.registrar_pago_parcial(
      p_tipo, p_monto, p_medio_pago, p_referencia, p_aplicaciones, p_idempotency_key, p_nota
    );
    if v_old_turno is distinct from p_caja_turno_id then
      raise exception 'La clave ya se registró en otro turno de caja.' using errcode = '23505';
    end if;
    return v_mov;
  end if;

  if p_caja_turno_id is not null then
    select estado into v_estado
    from public.caja_turnos
    where id = p_caja_turno_id
    for update;
    if not found or v_estado <> 'Abierto' then
      raise exception 'El turno de caja no existe o ya está cerrado.' using errcode = '23514';
    end if;
  elsif lower(trim(coalesce(p_medio_pago,''))) = 'efectivo' then
    raise exception 'Abre un turno de caja para registrar efectivo.' using errcode = '23514';
  end if;

  v_mov := public.registrar_pago_parcial(
    p_tipo, p_monto, p_medio_pago, p_referencia, p_aplicaciones, p_idempotency_key, p_nota
  );
  if p_caja_turno_id is not null then
    update public.movimientos_tesoreria
    set caja_turno_id = p_caja_turno_id
    where id = v_mov;
  end if;
  return v_mov;
end
$function$;

create or replace function app_private.abrir_turno_caja_v1(
  p_caja_id uuid,
  p_monto_inicial_pen numeric,
  p_monto_inicial_usd numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_turno_id uuid;
begin
  if v_uid is null or not (select public.tiene_permiso('finanzas','crear')) then
    raise exception 'Se requiere permiso para abrir turnos de caja.' using errcode = '42501';
  end if;
  if p_caja_id is null
     or p_monto_inicial_pen is null or p_monto_inicial_usd is null
     or p_monto_inicial_pen::text in ('NaN','Infinity','-Infinity')
     or p_monto_inicial_usd::text in ('NaN','Infinity','-Infinity')
     or p_monto_inicial_pen < 0 or p_monto_inicial_usd < 0 then
    raise exception 'Caja y montos iniciales deben ser válidos y no negativos.' using errcode = '22023';
  end if;
  perform 1 from public.cajas where id = p_caja_id and activo for share;
  if not found then
    raise exception 'La caja no existe o está inactiva.' using errcode = '23503';
  end if;

  insert into public.caja_turnos
    (caja_id, abierto_por_email, monto_inicial, monto_inicial_usd, estado, conteo, notas)
  values
    (p_caja_id, (select auth.jwt()->>'email'), round(p_monto_inicial_pen,2),
     round(p_monto_inicial_usd,2), 'Abierto', '{}'::jsonb, '')
  returning id into v_turno_id;
  return v_turno_id;
end
$function$;

create or replace function app_private.cerrar_turno_caja_v1(
  p_caja_turno_id uuid,
  p_conteo_pen numeric,
  p_conteo_usd numeric,
  p_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_turno public.caja_turnos%rowtype;
  v_esperado_pen numeric(14,2);
  v_esperado_usd numeric(14,2);
  v_notas text := left(btrim(coalesce(p_notas,'')), 2000);
begin
  if v_uid is null or not (select public.tiene_permiso('finanzas','editar')) then
    raise exception 'Se requiere permiso para cerrar turnos de caja.' using errcode = '42501';
  end if;
  if p_caja_turno_id is null
     or p_conteo_pen is null or p_conteo_usd is null
     or p_conteo_pen::text in ('NaN','Infinity','-Infinity')
     or p_conteo_usd::text in ('NaN','Infinity','-Infinity')
     or p_conteo_pen < 0 or p_conteo_usd < 0 then
    raise exception 'El turno y los conteos deben ser válidos y no negativos.' using errcode = '22023';
  end if;

  select * into v_turno
  from public.caja_turnos
  where id = p_caja_turno_id
  for update;
  if not found then
    raise exception 'El turno de caja no existe.' using errcode = '23503';
  end if;
  if v_turno.estado = 'Cerrado' then
    if v_turno.saldo_esperado_pen is not null
       and v_turno.saldo_esperado_usd is not null
       and v_turno.conteo ? 'Efectivo'
       and round((v_turno.conteo->>'Efectivo')::numeric,2) = round(p_conteo_pen,2)
       and v_turno.conteo_usd = round(p_conteo_usd,2)
       and v_turno.notas = v_notas then
      return jsonb_build_object(
        'esperado_pen', v_turno.saldo_esperado_pen,
        'esperado_usd', v_turno.saldo_esperado_usd,
        'contado_pen', v_turno.conteo->>'Efectivo',
        'contado_usd', v_turno.conteo_usd,
        'descuadre_pen', v_turno.descuadre_pen,
        'descuadre_usd', v_turno.descuadre_usd
      );
    end if;
    raise exception 'El turno ya fue cerrado con otro conteo.' using errcode = '23514';
  end if;
  if v_turno.estado <> 'Abierto' then
    raise exception 'El estado del turno no permite cerrarlo.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.movimientos_tesoreria m
    where m.caja_turno_id = p_caja_turno_id
      and m.anulado_en is null
      and lower(trim(coalesce(m.medio_pago,''))) = 'efectivo'
      and m.moneda is null
  ) then
    raise exception 'Hay movimientos en efectivo sin moneda conciliada; revisa Tesorería antes de cerrar.' using errcode = '23514';
  end if;

  select round(v_turno.monto_inicial + coalesce(sum(
    case when m.tipo = 'cobro' then m.monto else -m.monto end
  ),0),2)
  into v_esperado_pen
  from public.movimientos_tesoreria m
  where m.caja_turno_id = p_caja_turno_id
    and m.anulado_en is null
    and lower(trim(coalesce(m.medio_pago,''))) = 'efectivo'
    and m.moneda = 'PEN';

  select round(v_turno.monto_inicial_usd + coalesce(sum(
    case when m.tipo = 'cobro' then m.monto else -m.monto end
  ),0),2)
  into v_esperado_usd
  from public.movimientos_tesoreria m
  where m.caja_turno_id = p_caja_turno_id
    and m.anulado_en is null
    and lower(trim(coalesce(m.medio_pago,''))) = 'efectivo'
    and m.moneda = 'USD';

  update public.caja_turnos
  set estado = 'Cerrado',
      cerrado_en = now(),
      conteo = jsonb_build_object('Efectivo', round(p_conteo_pen,2)),
      conteo_usd = round(p_conteo_usd,2),
      saldo_esperado_pen = v_esperado_pen,
      saldo_esperado_usd = v_esperado_usd,
      descuadre_pen = round(p_conteo_pen,2) - v_esperado_pen,
      descuadre_usd = round(p_conteo_usd,2) - v_esperado_usd,
      notas = v_notas
  where id = p_caja_turno_id;

  return jsonb_build_object(
    'esperado_pen', v_esperado_pen,
    'esperado_usd', v_esperado_usd,
    'contado_pen', round(p_conteo_pen,2),
    'contado_usd', round(p_conteo_usd,2),
    'descuadre_pen', round(p_conteo_pen,2) - v_esperado_pen,
    'descuadre_usd', round(p_conteo_usd,2) - v_esperado_usd
  );
end
$function$;

create or replace function public.abrir_turno_caja_v1(
  p_caja_id uuid,
  p_monto_inicial_pen numeric,
  p_monto_inicial_usd numeric
)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select app_private.abrir_turno_caja_v1($1,$2,$3)
$function$;

create or replace function public.cerrar_turno_caja_v1(
  p_caja_turno_id uuid,
  p_conteo_pen numeric,
  p_conteo_usd numeric,
  p_notas text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select app_private.cerrar_turno_caja_v1($1,$2,$3,$4)
$function$;

revoke all on function app_private.abrir_turno_caja_v1(uuid,numeric,numeric) from public, anon;
revoke all on function app_private.cerrar_turno_caja_v1(uuid,numeric,numeric,text) from public, anon;
grant execute on function app_private.abrir_turno_caja_v1(uuid,numeric,numeric) to authenticated;
grant execute on function app_private.cerrar_turno_caja_v1(uuid,numeric,numeric,text) to authenticated;
revoke all on function public.abrir_turno_caja_v1(uuid,numeric,numeric) from public, anon;
revoke all on function public.cerrar_turno_caja_v1(uuid,numeric,numeric,text) from public, anon;
grant execute on function public.abrir_turno_caja_v1(uuid,numeric,numeric) to authenticated;
grant execute on function public.cerrar_turno_caja_v1(uuid,numeric,numeric,text) to authenticated;
revoke insert, update on table public.caja_turnos from authenticated;
grant select on table public.caja_turnos to authenticated;
drop policy if exists caja_turnos_insert on public.caja_turnos;
drop policy if exists caja_turnos_update on public.caja_turnos;

create or replace function app_private._proteger_moneda_cxp_aplicada_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.moneda is not distinct from old.moneda then
    return new;
  end if;
  if exists (
    select 1
    from public.aplicaciones_pago a
    where a.cuenta_id = old.id
  ) then
    raise exception 'No se puede cambiar la moneda de una cuenta con aplicaciones de Tesorería.' using errcode = '23514';
  end if;
  return new;
end
$function$;

revoke all on function app_private._proteger_moneda_cxp_aplicada_v1() from public, anon, authenticated;
drop trigger if exists trg_z_proteger_moneda_cxp_aplicada_v1 on public.pagos;
create trigger trg_z_proteger_moneda_cxp_aplicada_v1
before update on public.pagos
for each row execute function app_private._proteger_moneda_cxp_aplicada_v1();

comment on function public.registrar_pago_parcial(text,numeric,text,text,jsonb,text,text) is
  'Registra aplicaciones idempotentes en una única moneda; conserva sincronización de estados de CxP/CxC.';
comment on function app_private.registrar_pago_parcial_en_turno(text,numeric,text,text,jsonb,text,text,uuid) is
  'Bloquea el turno mientras registra cobros/pagos para que el cierre sea atómico y conserve moneda.';
comment on function public.cerrar_turno_caja_v1(uuid,numeric,numeric,text) is
  'Cierra un turno bajo bloqueo y guarda esperado, conteo y descuadre separados en PEN y USD.';

notify pgrst, 'reload schema';

commit;
