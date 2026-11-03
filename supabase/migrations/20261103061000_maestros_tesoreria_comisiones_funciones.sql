-- Capa de funciones de Maestros, Tesorería bancaria y Comisiones (Modelo B).
-- Adaptación de la migración de Smith:
--   * actualizar_estado_cuenta_bancaria: RPC que respalda el toggle de la UI.
--   * registrar_transferencia_bancaria / registrar_pago_comision: idempotencia
--     opcional por clave (clave + hash + advisory lock; repetición idéntica
--     devuelve el id ya registrado).
--   * liquidar_comision: idempotente (reejecutar sobre 'liquidada' no falla).
--   * calcular_comisiones: recálculo limpia las liquidaciones 'calculada'
--     que dejaron de aplicar al período.
-- Las liquidaciones no pueden marcarse pagadas desde la API directa.
begin;

-- ============================================================
-- TESORERÍA
-- ============================================================
-- Las cuentas solo cambian de estado; moneda y saldo inicial permanecen inmutables desde el cliente.
drop function if exists public.actualizar_estado_cuenta_bancaria(uuid, boolean);
create or replace function public.actualizar_estado_cuenta_bancaria(
  p_cuenta_id uuid, p_activa boolean)
returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  if (select auth.uid()) is null
     or not (select public.tiene_permiso('finanzas','editar')) then
    raise exception 'Se requiere permiso de edición de Tesorería.' using errcode = '42501';
  end if;
  if p_activa is null then
    raise exception 'El estado de la cuenta es obligatorio.' using errcode = '22023';
  end if;
  update public.cuentas_bancarias set activa = p_activa where id = p_cuenta_id;
  if not found then
    raise exception 'No se encontró la cuenta bancaria.' using errcode = 'P0002';
  end if;
end;
$function$;

-- Transferencia bancaria atómica: asiento de salida y entrada o ninguno.
-- Con clave de idempotencia: misma clave con el mismo contenido devuelve la
-- transferencia original; con otro contenido se rechaza.
drop function if exists public.registrar_transferencia_bancaria(uuid, uuid, numeric, date, text);
create or replace function public.registrar_transferencia_bancaria(
  p_origen uuid, p_destino uuid, p_monto numeric, p_fecha date,
  p_referencia text default null, p_idempotency_key text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
  v_transferencia uuid := gen_random_uuid();
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_hash text;
  v_prev_hash text;
begin
  if (select auth.uid()) is null
     or not (select public.tiene_permiso('finanzas','crear')) then
    raise exception 'Se requiere permiso de Tesorería para transferir fondos.' using errcode = '42501';
  end if;
  if p_origen is null or p_destino is null or p_origen = p_destino
     or p_monto is null or p_monto <= 0
     or p_monto::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Las cuentas y el importe de transferencia no son válidos.' using errcode = '22023';
  end if;

  if v_key is not null then
    v_hash := md5(concat_ws('|', p_origen::text, p_destino::text, round(p_monto,2),
      coalesce(p_fecha::text, current_date::text), coalesce(nullif(btrim(p_referencia),''),'')));
    perform pg_advisory_xact_lock(hashtextextended('tesoreria:transferencia:' || v_key, 0));
    select payload_hash into v_prev_hash
    from public.movimientos_bancarios
    where tipo = 'transferencia_salida' and idempotency_key = v_key;
    if found then
      if v_prev_hash is not distinct from v_hash then
        select transferencia_id into v_transferencia
        from public.movimientos_bancarios
        where tipo = 'transferencia_salida' and idempotency_key = v_key;
        return v_transferencia;
      end if;
      raise exception 'La clave de transferencia ya fue usada con otro contenido.' using errcode = '23505';
    end if;
  end if;

  perform 1 from public.cuentas_bancarias
  where id in (p_origen, p_destino) and activa
  order by id for update;
  if (select count(*) from public.cuentas_bancarias
      where id in (p_origen, p_destino) and activa) <> 2 then
    raise exception 'Ambas cuentas bancarias deben estar activas.' using errcode = '23503';
  end if;
  if (select count(distinct moneda) from public.cuentas_bancarias
      where id in (p_origen, p_destino)) <> 1 then
    raise exception 'Las transferencias entre monedas distintas requieren una conversión registrada por separado.'
      using errcode = '22023';
  end if;

  insert into public.movimientos_bancarios
    (cuenta_bancaria_id, tipo, concepto, monto, fecha, referencia, transferencia_id, idempotency_key, payload_hash, created_by)
  values
    (p_origen, 'transferencia_salida', 'Transferencia entre cuentas', round(p_monto,2),
     coalesce(p_fecha,current_date), nullif(btrim(p_referencia),''), v_transferencia, v_key, v_hash, (select auth.uid())),
    (p_destino, 'transferencia_entrada', 'Transferencia entre cuentas', round(p_monto,2),
     coalesce(p_fecha,current_date), nullif(btrim(p_referencia),''), v_transferencia, null, v_hash, (select auth.uid()));

  return v_transferencia;
end;
$function$;

-- Conciliación atómica: solo cierra si todas las líneas están vinculadas y el saldo cuadra.
drop function if exists public.actualizar_estado_conciliacion(uuid, text);
create or replace function public.actualizar_estado_conciliacion(
  p_conciliacion_id uuid, p_estado text)
returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  v_rec public.conciliaciones_bancarias%rowtype;
  v_saldo numeric(14,2);
begin
  if (select auth.uid()) is null
     or not (select public.tiene_permiso('finanzas','editar')) then
    raise exception 'Se requiere permiso de edición de Tesorería.' using errcode = '42501';
  end if;
  if p_estado is null or p_estado not in ('abierta','cerrada') then
    raise exception 'Estado de conciliación no válido.' using errcode = '22023';
  end if;
  select * into v_rec from public.conciliaciones_bancarias where id = p_conciliacion_id for update;
  if not found then
    raise exception 'No se encontró la conciliación.' using errcode = 'P0002';
  end if;
  if p_estado = 'abierta' then
    update public.conciliaciones_bancarias set estado = 'abierta', cerrada_at = null
    where id = p_conciliacion_id;
    return;
  end if;
  if not exists (select 1 from public.cuentas_bancarias
                 where id = v_rec.cuenta_bancaria_id and fecha_saldo <= v_rec.periodo_hasta) then
    raise exception 'El período debe terminar en o después de la fecha del saldo inicial de la cuenta.'
      using errcode = '23514';
  end if;
  if exists (select 1 from public.lineas_extracto_bancario
             where conciliacion_id = p_conciliacion_id and movimiento_bancario_id is null) then
    raise exception 'Vincula todas las líneas del extracto antes de cerrar.' using errcode = '23514';
  end if;
  select (c.saldo_inicial + coalesce(sum(case when m.tipo in ('ingreso','transferencia_entrada')
    then m.monto else -m.monto end),0))::numeric(14,2)
    into v_saldo
  from public.cuentas_bancarias c
  left join public.movimientos_bancarios m
    on m.cuenta_bancaria_id = c.id and m.fecha >= c.fecha_saldo and m.fecha <= v_rec.periodo_hasta
  where c.id = v_rec.cuenta_bancaria_id
  group by c.id;
  if v_saldo is null or abs(v_saldo - v_rec.saldo_extracto) > 0.01 then
    raise exception 'El saldo del extracto no cuadra con el libro bancario (%).', coalesce(v_saldo,0)
      using errcode = '23514';
  end if;
  update public.conciliaciones_bancarias set estado = 'cerrada', cerrada_at = now()
  where id = p_conciliacion_id;
end;
$function$;

-- Vínculo atómico validado por cuenta, intervalo y signo/importe del asiento.
drop function if exists public.conciliar_linea_extracto(uuid, uuid);
create or replace function public.conciliar_linea_extracto(
  p_linea_id uuid, p_movimiento_id uuid default null)
returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  v_line public.lineas_extracto_bancario%rowtype;
  v_rec public.conciliaciones_bancarias%rowtype;
  v_mov public.movimientos_bancarios%rowtype;
  v_signed numeric(14,2);
begin
  if (select auth.uid()) is null
     or not (select public.tiene_permiso('finanzas','editar')) then
    raise exception 'Se requiere permiso de edición de Tesorería.' using errcode = '42501';
  end if;
  select * into v_line from public.lineas_extracto_bancario where id = p_linea_id for update;
  if not found then
    raise exception 'No se encontró la línea del extracto.' using errcode = 'P0002';
  end if;
  select * into v_rec from public.conciliaciones_bancarias where id = v_line.conciliacion_id for update;
  if v_rec.estado <> 'abierta' then
    raise exception 'La conciliación está cerrada.' using errcode = '23514';
  end if;
  if p_movimiento_id is null then
    update public.lineas_extracto_bancario set movimiento_bancario_id = null where id = p_linea_id;
    return;
  end if;
  select * into v_mov from public.movimientos_bancarios where id = p_movimiento_id for update;
  if not found or v_mov.cuenta_bancaria_id <> v_rec.cuenta_bancaria_id
     or v_mov.fecha < v_rec.periodo_desde or v_mov.fecha > v_rec.periodo_hasta then
    raise exception 'El movimiento debe pertenecer a la misma cuenta y período.' using errcode = '23514';
  end if;
  v_signed := case when v_mov.tipo in ('ingreso','transferencia_entrada')
    then v_mov.monto else -v_mov.monto end;
  if abs(v_signed - v_line.monto_firmado) > 0.01 then
    raise exception 'El importe o signo del movimiento no coincide con la línea.' using errcode = '23514';
  end if;
  update public.lineas_extracto_bancario set movimiento_bancario_id = p_movimiento_id
  where id = p_linea_id;
end;
$function$;

-- ============================================================
-- COMISIONES
-- ============================================================
-- La liquidación no puede marcarse como pagada desde la API directa.
-- Idempotente: repetir sobre una liquidación ya liquidada no falla.
drop function if exists public.liquidar_comision(uuid);
create or replace function public.liquidar_comision(p_liquidacion_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  v_estado text;
begin
  if (select auth.uid()) is null
     or not (select public.tiene_permiso('ventas','editar')) then
    raise exception 'Se requiere permiso de edición de Ventas.' using errcode = '42501';
  end if;
  select estado into v_estado from public.liquidaciones_comision where id = p_liquidacion_id for update;
  if not found then
    raise exception 'No se encontró la liquidación.' using errcode = 'P0002';
  end if;
  if v_estado = 'liquidada' then
    return; -- repetición idéntica: nada que hacer
  end if;
  if v_estado <> 'calculada' then
    raise exception 'Solo se puede liquidar una comisión calculada.' using errcode = '23514';
  end if;
  update public.liquidaciones_comision set estado = 'liquidada' where id = p_liquidacion_id;
end;
$function$;

-- Cálculo de comisiones sobre ventas netas completadas asignadas a vendedores.
-- El recálculo retira las liquidaciones 'calculada' que ya no aplican y solo
-- refresca la fila cuyo estado sigue siendo 'calculada'.
drop function if exists public.calcular_comisiones(date, date);
create or replace function public.calcular_comisiones(p_desde date, p_hasta date)
returns integer
language plpgsql security definer set search_path = ''
as $function$
declare
  v_regla public.reglas_comision%rowtype;
  v_count integer := 0;
  v_row record;
  v_rate numeric(7,4);
  v_amount numeric(14,2);
begin
  if (select auth.uid()) is null
     or not (select public.tiene_permiso('ventas','editar')) then
    raise exception 'Se requiere permiso de edición de Ventas para calcular comisiones.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'El período de cálculo no es válido.' using errcode = '22023';
  end if;
  select * into v_regla from public.reglas_comision
  where activa and vigente_desde <= p_hasta
    and (vigente_hasta is null or vigente_hasta >= p_desde)
  order by vigente_desde desc limit 1;
  if not found then
    raise exception 'Crea y activa una regla de comisión vigente antes de calcular.' using errcode = '23514';
  end if;

  -- Recálculo: retira las liquidaciones 'calculada' que ya no aplican al período.
  delete from public.liquidaciones_comision as l
  where l.estado = 'calculada'
    and l.periodo_desde = p_desde and l.periodo_hasta = p_hasta
    and not exists (
      select 1
      from public.ventas_vendedor vv
      join public.ventas v on v.id = vv.venta_id
      where vv.vendedor_id = l.vendedor_id
        and v.estado = 'Completada'
        and timezone('America/Lima', v.created_at)::date between p_desde and p_hasta
    );

  for v_row in
    select vv.vendedor_id, coalesce(sum(v.monto),0)::numeric(14,2) as ventas
    from public.ventas_vendedor vv
    join public.ventas v on v.id = vv.venta_id
    where v.estado = 'Completada'
      and timezone('America/Lima', v.created_at)::date between p_desde and p_hasta
    group by vv.vendedor_id
  loop
    select e.porcentaje into v_rate from public.excepciones_comision e
    where e.vendedor_id = v_row.vendedor_id and e.activa
      and e.vigente_desde <= p_hasta
      and (e.vigente_hasta is null or e.vigente_hasta >= p_desde)
    order by e.vigente_desde desc limit 1;
    if v_rate is null then
      select s.porcentaje into v_rate from public.escalas_comision s
      where s.regla_id = v_regla.id
        and v_row.ventas >= s.desde_ventas
        and (s.hasta_ventas is null or v_row.ventas < s.hasta_ventas)
      order by s.desde_ventas desc limit 1;
    end if;
    v_rate := coalesce(v_rate, v_regla.porcentaje);
    v_amount := round(v_row.ventas * v_rate / 100, 2);
    insert into public.liquidaciones_comision
      (vendedor_id, periodo_desde, periodo_hasta, ventas_netas, comision_calculada, estado, created_by)
    values
      (v_row.vendedor_id, p_desde, p_hasta, v_row.ventas, v_amount, 'calculada', (select auth.uid()))
    on conflict (vendedor_id, periodo_desde, periodo_hasta) do update
      set ventas_netas = excluded.ventas_netas,
          comision_calculada = excluded.comision_calculada,
          updated_at = now()
      where public.liquidaciones_comision.estado = 'calculada';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

-- Registro atómico de un pago de liquidación con asiento bancario opcional.
-- Con clave de idempotencia: repetición idéntica devuelve el pago original.
drop function if exists public.registrar_pago_comision(uuid, numeric, date, text, text, uuid);
create or replace function public.registrar_pago_comision(
  p_liquidacion_id uuid, p_monto numeric, p_fecha date, p_medio text,
  p_referencia text default null, p_cuenta_bancaria_id uuid default null,
  p_idempotency_key text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
  v_liq public.liquidaciones_comision%rowtype;
  v_ajustes numeric(14,2);
  v_pagado numeric(14,2);
  v_pago uuid;
  v_movimiento uuid;
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_hash text;
  v_prev_hash text;
begin
  if (select auth.uid()) is null
     or not (select public.tiene_permiso('finanzas','crear')) then
    raise exception 'Se requiere permiso de Tesorería para pagar comisiones.' using errcode = '42501';
  end if;
  if p_monto is null or p_monto <= 0 or nullif(btrim(p_medio),'') is null
     or p_monto::text in ('NaN','Infinity','-Infinity') then
    raise exception 'El importe y el medio de pago son obligatorios.' using errcode = '22023';
  end if;
  select * into v_liq from public.liquidaciones_comision where id = p_liquidacion_id for update;
  if not found or v_liq.estado = 'calculada' then
    raise exception 'Liquida la comisión antes de registrar su pago.' using errcode = '23514';
  end if;

  if v_key is not null then
    v_hash := md5(concat_ws('|', p_liquidacion_id::text, round(p_monto,2),
      coalesce(p_fecha::text, current_date::text), btrim(p_medio),
      coalesce(nullif(btrim(p_referencia),''),''), coalesce(p_cuenta_bancaria_id::text,'')));
    perform pg_advisory_xact_lock(hashtextextended('tesoreria:pago_comision:' || v_key, 0));
    select id, payload_hash into v_pago, v_prev_hash
    from public.pagos_comision where idempotency_key = v_key;
    if found then
      if v_prev_hash is not distinct from v_hash then
        return v_pago;
      end if;
      raise exception 'La clave de pago ya fue usada con otro contenido.' using errcode = '23505';
    end if;
  end if;

  select coalesce(sum(monto),0)::numeric(14,2) into v_ajustes
  from public.ajustes_comision where liquidacion_id = p_liquidacion_id;
  select coalesce(sum(monto),0)::numeric(14,2) into v_pagado
  from public.pagos_comision where liquidacion_id = p_liquidacion_id;
  if round(p_monto,2) > greatest(0, v_liq.comision_calculada + v_ajustes - v_pagado) then
    raise exception 'El pago excede el saldo de la liquidación.' using errcode = '23514';
  end if;
  if p_cuenta_bancaria_id is not null and not exists (
    select 1 from public.cuentas_bancarias
    where id = p_cuenta_bancaria_id and activa and moneda = 'PEN') then
    raise exception 'Selecciona una cuenta bancaria activa en PEN.' using errcode = '23503';
  end if;

  insert into public.pagos_comision
    (liquidacion_id, monto, fecha, medio, referencia, cuenta_bancaria_id, idempotency_key, payload_hash, created_by)
  values
    (p_liquidacion_id, round(p_monto,2), coalesce(p_fecha,current_date), btrim(p_medio),
     nullif(btrim(p_referencia),''), p_cuenta_bancaria_id, v_key, v_hash, (select auth.uid()))
  returning id into v_pago;

  if p_cuenta_bancaria_id is not null then
    insert into public.movimientos_bancarios
      (cuenta_bancaria_id, tipo, concepto, monto, fecha, referencia, nota, idempotency_key, payload_hash, created_by)
    values
      (p_cuenta_bancaria_id, 'egreso', 'Pago de comisión', round(p_monto,2),
       coalesce(p_fecha,current_date), nullif(btrim(p_referencia),''), 'Liquidación ' || p_liquidacion_id::text,
       null, null, (select auth.uid()))
    returning id into v_movimiento;
    update public.pagos_comision set movimiento_bancario_id = v_movimiento where id = v_pago;
  end if;

  select coalesce(sum(monto),0)::numeric(14,2) into v_pagado
  from public.pagos_comision where liquidacion_id = p_liquidacion_id;
  if v_pagado >= v_liq.comision_calculada + v_ajustes then
    update public.liquidaciones_comision set estado = 'pagada', updated_at = now()
    where id = p_liquidacion_id;
  end if;
  return v_pago;
end;
$function$;

-- ============================================================
-- Superficie de API.
-- ============================================================
revoke all on function public.actualizar_estado_cuenta_bancaria(uuid, boolean) from public, anon;
grant execute on function public.actualizar_estado_cuenta_bancaria(uuid, boolean) to authenticated;

revoke all on function public.registrar_transferencia_bancaria(uuid, uuid, numeric, date, text, text) from public, anon;
grant execute on function public.registrar_transferencia_bancaria(uuid, uuid, numeric, date, text, text) to authenticated;

revoke all on function public.actualizar_estado_conciliacion(uuid, text) from public, anon;
grant execute on function public.actualizar_estado_conciliacion(uuid, text) to authenticated;

revoke all on function public.conciliar_linea_extracto(uuid, uuid) from public, anon;
grant execute on function public.conciliar_linea_extracto(uuid, uuid) to authenticated;

revoke all on function public.liquidar_comision(uuid) from public, anon;
grant execute on function public.liquidar_comision(uuid) to authenticated;

revoke all on function public.calcular_comisiones(date, date) from public, anon;
grant execute on function public.calcular_comisiones(date, date) to authenticated;

revoke all on function public.registrar_pago_comision(uuid, numeric, date, text, text, uuid, text) from public, anon;
grant execute on function public.registrar_pago_comision(uuid, numeric, date, text, text, uuid, text) to authenticated;

commit;
