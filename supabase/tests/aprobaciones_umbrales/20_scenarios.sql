\set ON_ERROR_STOP 1
\set VERBOSITY terse
\pset pager off
-- Usuarios: S = Solicitante (Operador), G = Gerente, A = Administrador, O = otro Operador
\set S '11111111-1111-1111-1111-111111111111'
\set G '22222222-2222-2222-2222-222222222222'
\set A '33333333-3333-3333-3333-333333333333'
\set O '44444444-4444-4444-4444-444444444444'

insert into public.roles(nombre) values ('Operador'),('Gerente'),('Administrador');
insert into public.permisos(modulo,accion) values ('compras','ver'),('compras','crear'),('inventario','ver'),('inventario','crear'),('aprobaciones','ver'),('aprobaciones','aprobar');
insert into public.rol_permisos select r.id,p.id from public.roles r, public.permisos p where r.nombre in ('Gerente','Administrador');
insert into public.rol_permisos select r.id,p.id from public.roles r, public.permisos p where r.nombre='Operador' and (p.modulo,p.accion) in (('compras','ver'),('compras','crear'),('inventario','ver'),('inventario','crear'),('aprobaciones','ver'));
insert into public.usuarios(id,nombre,email,rol_id) select :'S','Solicitante','solicitante@test',id from public.roles where nombre='Operador';
insert into public.usuarios(id,nombre,email,rol_id) select :'G','Gerente','gerente@test',id from public.roles where nombre='Gerente';
insert into public.usuarios(id,nombre,email,rol_id) select :'A','Admin','admin@test',id from public.roles where nombre='Administrador';
insert into public.usuarios(id,nombre,email,rol_id) select :'O','Otro','otro@test',id from public.roles where nombre='Operador';

insert into auth.users select id from public.usuarios;
create function public.t_expect_error(p_sql text, p_state text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlstate = p_state then return; end if;
    raise exception 'esperaba % pero llegó % (%)', p_state, sqlstate, sqlerrm;
  end;
  raise exception 'esperaba error % pero la sentencia tuvo éxito: %', p_state, p_sql;
end $$;
create function public.t_assert(c boolean, m text) returns void language plpgsql as $$ begin if c is not true then raise exception 'FALLÓ: %', m; end if; end $$;
grant execute on function public.t_assert(boolean,text) to authenticated;
create function public.t_estado(p_id uuid) returns text language sql as $$ select estado from public.ec_solicitudes_aprobacion where id=p_id $$;
grant execute on function public.t_expect_error(text,text), public.t_estado(uuid) to authenticated;
grant select on public.ec_aprobacion_eventos, public.stub_ordenes, public.ec_conteos_fisicos to authenticated;

\echo '== T1  Regla INACTIVA: toda orden exige aprobación (comportamiento actual)'
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
select public.stub_solicitar('purchase_manual', '{"lineas":[{"cantidad":1,"precio":100,"tratamiento_tributario":"Gravado","tasa_tributaria":18}],"moneda":"PEN","exchange_rate":1,"monto_manual":0,"proveedor_id":"00000000-0000-0000-0000-000000000001","detalle":"t1"}', 't1-key-0001') as t1 \gset
reset role;
select public.t_assert(public.t_estado(:'t1') = 'pending', 'T1: debía quedar pendiente');

\echo '== T1b Solicitante NO puede decidir su propia solicitud (sin permiso aprobar)'
select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.t_expect_error(format($q$select public.ec_decidir_aprobacion_v1(%L, true, null)$q$, :'t1'), '42501');
reset role;

\echo '== T1c Gerente tampoco aprueba lo que el mismo solicitó'
select set_config('request.jwt.claim.sub', :'G', false); set role authenticated;
select public.stub_solicitar('purchase_manual', '{"lineas":[{"cantidad":1,"precio":50,"tratamiento_tributario":"Gravado","tasa_tributaria":18}],"moneda":"PEN","exchange_rate":1,"monto_manual":0,"proveedor_id":"00000000-0000-0000-0000-000000000001"}', 't1c-key-0001') as t1c \gset
select public.t_expect_error(format($q$select public.ec_decidir_aprobacion_v1(%L, true, null)$q$, :'t1c'), '42501');
reset role;

\echo '== T1d Otro Operador no ve la solicitud ajena (RLS); el Gerente sí'
select set_config('request.jwt.claim.sub', :'O', false); set role authenticated;
select public.t_assert((select count(*) from public.ec_solicitudes_aprobacion) = 0, 'T1d: O ve solicitudes ajenas');
reset role;
select set_config('request.jwt.claim.sub', :'G', false); set role authenticated;
select public.t_assert((select count(*) from public.ec_solicitudes_aprobacion where solicitante_id <> auth.uid()) = 1, 'T1d: G debe ver la de S');
reset role;

\echo '== T2  Gerente RECHAZA: exige motivo; luego rechaza con motivo'
select set_config('request.jwt.claim.sub', :'G', false); set role authenticated;
select public.t_expect_error(format($q$select public.ec_decidir_aprobacion_v1(%L, false, '')$q$, :'t1'), '22023');
select public.ec_decidir_aprobacion_v1(:'t1', false, 'Precio fuera de rango') ;
reset role;
select public.t_assert(public.t_estado(:'t1') = 'rejected', 'T2: debía quedar rechazada');
select public.t_assert((select count(*) from public.stub_ordenes) = 0, 'T2: no debe existir orden');
select public.t_assert((select motivo_decision from public.ec_solicitudes_aprobacion where id=:'t1') = 'Precio fuera de rango', 'assert');
select public.t_assert(exists (select 1 from public.notificaciones where usuario_id=:'S' and clave_fuente='decision:'||:'t1' and severidad='warning'), 'T2: el solicitante debe recibir aviso de rechazo');

\echo '== T2b Gerente APRUEBA solicitud de S (usuario distinto): se emite la orden'
select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.stub_solicitar('purchase_manual', '{"lineas":[{"cantidad":2,"precio":100,"tratamiento_tributario":"Gravado","tasa_tributaria":18}],"moneda":"PEN","exchange_rate":1,"monto_manual":0,"proveedor_id":"00000000-0000-0000-0000-000000000001"}', 't2b-key-0001') as t2b \gset
reset role;
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
select public.ec_decidir_aprobacion_v1(:'t2b', true, null);
reset role;
select public.t_assert(public.t_estado(:'t2b') = 'approved', 'T2b: debía quedar aprobada');
select public.t_assert((select decision_por from public.ec_solicitudes_aprobacion where id=:'t2b') = :'A', 'T2b: decide Admin');
select public.t_assert((select count(*) from public.stub_ordenes where creado_por = :'A') = 1, 'T2b: una orden emitida');
select public.t_assert((select array_agg(evento order by creado_en,id) from public.ec_aprobacion_eventos where solicitud_id=:'t2b') = array['solicitada','aprobada'], 'T2b: historial');
select public.t_assert(exists (select 1 from public.notificaciones where usuario_id=:'S' and clave_fuente='decision:'||:'t2b' and titulo='Solicitud aprobada'), 'T2b: aviso al solicitante');
select public.t_assert(exists (select 1 from public.notificaciones where usuario_id=:'G' and clave_fuente='request:'||:'t2b' and estado='resolved'), 'T2b: aviso al gerente resuelto');

\echo '== T3  Reglas: Operador no puede editar; Gerente sí; valores inválidos se rechazan; queda auditoría'
select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.t_expect_error($q$select public.ec_actualizar_regla_aprobacion_v1('orden_compra_monto_minimo_pen', 1000, true)$q$, '42501');
reset role;
select set_config('request.jwt.claim.sub', :'G', false); set role authenticated;
select public.t_expect_error($q$select public.ec_actualizar_regla_aprobacion_v1('orden_compra_monto_minimo_pen', 0, true)$q$, '22023');
select public.t_expect_error($q$select public.ec_actualizar_regla_aprobacion_v1('orden_compra_monto_minimo_pen', -5, false)$q$, '22023');
select public.t_expect_error($q$select public.ec_actualizar_regla_aprobacion_v1('orden_compra_monto_minimo_pen', 'NaN', true)$q$, '22023');
select public.t_expect_error($q$select public.ec_actualizar_regla_aprobacion_v1('conteo_fisico_variacion_maxima_unidades', 2.5, true)$q$, '22023');
select public.t_expect_error($q$select public.ec_actualizar_regla_aprobacion_v1('no_existe', 10, true)$q$, '23503');
select public.ec_actualizar_regla_aprobacion_v1('orden_compra_monto_minimo_pen', 1000, true);
select public.ec_actualizar_regla_aprobacion_v1('conteo_fisico_variacion_maxima_unidades', 5, true);
reset role;
select public.t_assert((select valor from public.ec_reglas_aprobacion where clave='orden_compra_monto_minimo_pen') = 1000, 'assert');
select public.t_assert((select actualizado_por from public.ec_reglas_aprobacion where clave='orden_compra_monto_minimo_pen') = :'G', 'assert');
select public.t_assert((select count(*) from public.auditoria where modulo='ec_reglas_aprobacion' and usuario_id=:'G') = 2, 'T3: auditoría');
select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.t_assert((select count(*) from public.ec_reglas_aprobacion) = 2, 'T3: S (aprobaciones:ver) lee las reglas');
select public.t_expect_error($q$update public.ec_reglas_aprobacion set valor = 1$q$, '42501');
reset role;

\echo '== T4  Regla ACTIVA (S/ 1000): bajo el umbral se emite solo; en/sobre el umbral queda pendiente'
select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.stub_solicitar('purchase_manual', '{"lineas":[{"cantidad":5,"precio":100,"tratamiento_tributario":"Gravado","tasa_tributaria":18}],"moneda":"PEN","exchange_rate":1,"monto_manual":0}', 't4a-key-0001') as t4a \gset
select public.stub_solicitar('purchase_manual', '{"lineas":[{"cantidad":1,"precio":1000,"tratamiento_tributario":"Exonerado","tasa_tributaria":0}],"moneda":"PEN","exchange_rate":1,"monto_manual":0}', 't4b-key-0001') as t4b \gset
select public.stub_solicitar('purchase_manual', '{"lineas":[{"cantidad":1,"precio":1500,"tratamiento_tributario":"Gravado","tasa_tributaria":18}],"moneda":"PEN","exchange_rate":1,"monto_manual":0}', 't4c-key-0001') as t4c \gset
select public.stub_solicitar('purchase_manual', '{"lineas":[{"cantidad":1,"precio":100,"tratamiento_tributario":"Gravado","tasa_tributaria":18}],"moneda":"USD","exchange_rate":3.8,"monto_manual":0}', 't4d-key-0001') as t4d \gset
select public.stub_solicitar('purchase_manual', '{"lineas":[{"cantidad":1,"precio":300,"tratamiento_tributario":"Gravado","tasa_tributaria":18}],"moneda":"USD","exchange_rate":3.8,"monto_manual":0}', 't4e-key-0001') as t4e \gset
select public.stub_solicitar('purchase_manual', '{"lineas":[],"moneda":"PEN","exchange_rate":1,"monto_manual":800}', 't4f-key-0001') as t4f \gset
select public.stub_solicitar('purchase_sourcing', '{"oferta":{"total_pen":900.50,"moneda":"PEN"}}', 't4g-key-0001', gen_random_uuid()) as t4g \gset
select public.stub_solicitar('purchase_contract', '{"lineas":[{"cantidad":10,"precio":50,"tratamiento_tributario":"Gravado","tasa_tributaria":18}],"moneda":"PEN","exchange_rate":1}', 't4h-key-0001', gen_random_uuid()) as t4h \gset
reset role;
select public.t_assert(public.t_estado(:'t4a') = 'approved', 'T4a: 590 < 1000 -> auto');
select public.t_assert(public.t_estado(:'t4b') = 'pending', 'T4b: 1000 no es < 1000 -> pendiente');
select public.t_assert(public.t_estado(:'t4c') = 'pending', 'T4c: 1770 -> pendiente');
select public.t_assert(public.t_estado(:'t4d') = 'approved', 'T4d: USD 118*3.8=448.4 -> auto');
select public.t_assert(public.t_estado(:'t4e') = 'pending', 'T4e: USD 354*3.8=1345.2 -> pendiente');
select public.t_assert(public.t_estado(:'t4f') = 'approved', 'T4f: monto manual 800 sin líneas -> auto');
select public.t_assert(public.t_estado(:'t4g') = 'approved', 'T4g: oferta 900.50 -> auto');
select public.t_assert(public.t_estado(:'t4h') = 'approved', 'T4h: contrato 10x50 con IGV = 590 -> auto');

\echo '== T4i La emisión automática deja rastro completo y en orden'
select public.t_assert((select decision_por from public.ec_solicitudes_aprobacion where id=:'t4a') = :'S', 'T4i: decision_por = solicitante (auto)');
select public.t_assert((select resultado_id is not null from public.ec_solicitudes_aprobacion where id=:'t4a'), 'T4i: resultado_id');
select public.t_assert((select array_agg(evento order by creado_en,id) from public.ec_aprobacion_eventos where solicitud_id=:'t4a') = array['solicitada','aprobada'], 'T4i: orden de eventos');
select public.t_assert((select (detalle->>'auto_aprobada')::boolean from public.ec_aprobacion_eventos where solicitud_id=:'t4a' and evento='aprobada') = true, 'assert');
select public.t_assert((select detalle->>'regla' from public.ec_aprobacion_eventos where solicitud_id=:'t4a' and evento='aprobada') = 'orden_compra_monto_minimo_pen', 'assert');
select public.t_assert((select (detalle->>'medida')::numeric from public.ec_aprobacion_eventos where solicitud_id=:'t4a' and evento='aprobada') = 590.00, 'assert');
select public.t_assert(exists (select 1 from public.notificaciones where usuario_id=:'G' and clave_fuente='request:'||:'t4a' and estado='resolved'), 'T4i: aviso a gerentes no queda colgado');

\echo '== T4j Las pendientes bajo/encima del umbral siguen necesitando a OTRA persona'
select set_config('request.jwt.claim.sub', :'G', false); set role authenticated;
select public.ec_decidir_aprobacion_v1(:'t4b', true, null);
select public.ec_decidir_aprobacion_v1(:'t4c', false, 'Excede presupuesto');
reset role;
select public.t_assert(public.t_estado(:'t4b') = 'approved' and public.t_estado(:'t4c') = 'rejected', 'assert');
select public.t_assert((select decision_por from public.ec_solicitudes_aprobacion where id=:'t4b') = :'G', 'assert');

\echo '== T5  Conteo físico: variación <= 5 u. se aplica solo; mayor queda pendiente'
insert into public.ec_conteos_fisicos values ('aaaaaaaa-0000-0000-0000-000000000001','abierto'),('aaaaaaaa-0000-0000-0000-000000000002','abierto'),('aaaaaaaa-0000-0000-0000-000000000003','abierto');
select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.stub_solicitar('physical_count', '{"diferencias":2,"variacion_unidades_absoluta":5}', 't5a-key-0001', 'aaaaaaaa-0000-0000-0000-000000000001') as t5a \gset
select public.stub_solicitar('physical_count', '{"diferencias":3,"variacion_unidades_absoluta":6}', 't5b-key-0001', 'aaaaaaaa-0000-0000-0000-000000000002') as t5b \gset
reset role;
select public.t_assert(public.t_estado(:'t5a') = 'approved', 'T5a: 5 <= 5 -> auto');
select public.t_assert((select estado from public.ec_conteos_fisicos where id='aaaaaaaa-0000-0000-0000-000000000001') = 'cerrado', 'T5a: conteo cerrado');
select public.t_assert(public.t_estado(:'t5b') = 'pending', 'T5b: 6 > 5 -> pendiente');
select public.t_assert((select estado from public.ec_conteos_fisicos where id='aaaaaaaa-0000-0000-0000-000000000002') = 'pendiente_aprobacion', 'assert');
select set_config('request.jwt.claim.sub', :'G', false); set role authenticated;
select public.ec_decidir_aprobacion_v1(:'t5b', true, null);
reset role;
select public.t_assert(public.t_estado(:'t5b') = 'approved' and (select estado from public.ec_conteos_fisicos where id='aaaaaaaa-0000-0000-0000-000000000002') = 'cerrado', 'assert');

\echo '== T6  Sin permiso de Compras o sin sesión del solicitante: nunca se auto-aprueba'
delete from public.rol_permisos where rol_id=(select id from public.roles where nombre='Operador') and permiso_id=(select id from public.permisos where modulo='compras' and accion='crear');
select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.stub_solicitar('purchase_manual', '{"lineas":[{"cantidad":1,"precio":10,"tratamiento_tributario":"Gravado","tasa_tributaria":18}],"moneda":"PEN","exchange_rate":1,"monto_manual":0}', 't6a-key-0001') as t6a \gset
reset role;
select public.t_assert(public.t_estado(:'t6a') = 'pending', 'T6a: sin compras:crear queda pendiente');
insert into public.rol_permisos select r.id,p.id from public.roles r, public.permisos p where r.nombre='Operador' and p.modulo='compras' and p.accion='crear';
-- Inserción por un proceso sin sesión (auth.uid() nulo) a nombre de S
select set_config('request.jwt.claim.sub', '', false);
insert into public.ec_solicitudes_aprobacion(tipo,solicitante_id,idempotency_key,snapshot,snapshot_hash)
values ('purchase_manual', :'S', 't6b-key-0001', '{"lineas":[{"cantidad":1,"precio":10,"tratamiento_tributario":"Gravado","tasa_tributaria":18}],"moneda":"PEN","exchange_rate":1,"monto_manual":0}', md5('x')) returning id as t6b \gset
select public.t_assert(public.t_estado(:'t6b') = 'pending', 'T6b: sin sesión del solicitante queda pendiente');

\echo '== T7  Si la emisión automática falla, la solicitud sigue pendiente (no se pierde)'
create or replace function public.crear_orden_compra_operativa_v4(uuid,text,date,numeric,jsonb,text,text,numeric) returns uuid language plpgsql security definer set search_path='' as $$
 begin raise exception 'proveedor inactivo' using errcode='23503'; end $$;
select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.stub_solicitar('purchase_manual', '{"lineas":[{"cantidad":1,"precio":10,"tratamiento_tributario":"Gravado","tasa_tributaria":18}],"moneda":"PEN","exchange_rate":1,"monto_manual":0}', 't7a-key-0001') as t7a \gset
reset role;
select public.t_assert(public.t_estado(:'t7a') = 'pending', 'T7: debe seguir pendiente');
select public.t_assert((select count(*) from public.ec_aprobacion_eventos where solicitud_id=:'t7a') = 1, 'T7: sin evento de aprobación');

\echo '== T8  Gerente DESACTIVA la regla: todo vuelve a exigir aprobación'
select set_config('request.jwt.claim.sub', :'G', false); set role authenticated;
select public.ec_actualizar_regla_aprobacion_v1('orden_compra_monto_minimo_pen', 1000, false);
reset role;
create or replace function public.crear_orden_compra_operativa_v4(uuid,text,date,numeric,jsonb,text,text,numeric) returns uuid language plpgsql security definer set search_path='' as $$
 declare v uuid; begin insert into public.stub_ordenes(origen,creado_por) values('manual', auth.uid()) returning id into v; return v; end $$;
select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.stub_solicitar('purchase_manual', '{"lineas":[{"cantidad":1,"precio":10,"tratamiento_tributario":"Gravado","tasa_tributaria":18}],"moneda":"PEN","exchange_rate":1,"monto_manual":0}', 't8a-key-0001') as t8a \gset
reset role;
select public.t_assert(public.t_estado(:'t8a') = 'pending', 'T8: regla inactiva => pendiente');

\echo '== T9  Un solicitante no puede escribir directo en el historial ni en las solicitudes'
select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.t_expect_error($q$update public.ec_solicitudes_aprobacion set estado='approved'$q$, '42501');
select public.t_expect_error($q$insert into public.ec_aprobacion_eventos(solicitud_id,actor_id,evento) values (gen_random_uuid(), auth.uid(), 'aprobada')$q$, '42501');
reset role;


\echo '== T10 Alertas predictivas: sincronizar, leer, resolver, aislar por usuario y permiso'
insert into public.roles(nombre) values ('SinInventario');
insert into public.usuarios(id,nombre,email,rol_id) select '55555555-5555-5555-5555-555555555555','Sin inv','sininv@test',id from public.roles where nombre='SinInventario';
insert into auth.users values ('55555555-5555-5555-5555-555555555555');
select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.ec_sincronizar_alertas_predictivas_v1('[
 {"fuente":"predictive","clave_fuente":"stockout:p1","referencia":"P-001","titulo":"Cable: se agotaría en ~3 días","detalle":"20 u. en stock","severidad":"critical"},
 {"fuente":"predictive","clave_fuente":"stockout:p2","referencia":"P-002","titulo":"Tuerca: se agotaría en ~12 días","detalle":"","severidad":"warning"}]'::jsonb) as n10 \gset
select public.t_assert(:n10 = 2, 'T10: devuelve 2');
select public.t_assert((select count(*) from public.notificaciones where fuente='predictive' and estado='active') = 2, 'T10: 2 activas');
update public.notificaciones set read_at = now() where fuente='predictive' and clave_fuente='stockout:p1';
reset role;
select set_config('request.jwt.claim.sub', :'O', false); set role authenticated;
select public.t_assert((select count(*) from public.notificaciones where fuente='predictive') = 0, 'T10: otro usuario no ve las alertas de S');
reset role;
select set_config('request.jwt.claim.sub', :'S', false); set role authenticated;
select public.ec_sincronizar_alertas_predictivas_v1('[{"fuente":"predictive","clave_fuente":"stockout:p1","referencia":"P-001","titulo":"Cable: se agotaría en ~2 días","detalle":"15 u. en stock","severidad":"critical"}]'::jsonb);
select public.t_assert((select estado from public.notificaciones where clave_fuente='stockout:p2') = 'resolved', 'T10: p2 se resuelve sola');
select public.t_assert((select read_at is not null from public.notificaciones where clave_fuente='stockout:p1'), 'T10: p1 conserva lectura');
select public.t_assert((select titulo from public.notificaciones where clave_fuente='stockout:p1') like '%2 días', 'T10: p1 actualizada');
select public.ec_sincronizar_alertas_predictivas_v1('[{"fuente":"predictive","clave_fuente":"stockout:p2","referencia":"P-002","titulo":"Tuerca: se agotaría en ~5 días","detalle":"","severidad":"warning"}]'::jsonb);
select public.t_assert((select estado='active' and read_at is null from public.notificaciones where clave_fuente='stockout:p2'), 'T10: p2 reactivada sin lectura');
select public.t_expect_error($q$select public.ec_sincronizar_alertas_predictivas_v1('[{"clave_fuente":"a","referencia":"r","titulo":"t","detalle":"","severidad":"grave"}]'::jsonb)$q$, '22023');
select public.t_expect_error($q$select public.ec_sincronizar_alertas_predictivas_v1('[{"clave_fuente":"a","referencia":"r","titulo":"t","severidad":"info"},{"clave_fuente":"a","referencia":"r","titulo":"t","severidad":"info"}]'::jsonb)$q$, '22023');
select public.t_expect_error($q$select public.ec_sincronizar_alertas_predictivas_v1((select jsonb_agg(jsonb_build_object('clave_fuente','k'||g,'referencia','r','titulo','t','severidad','info')) from generate_series(1,601) g))$q$, '22023');
select public.t_expect_error($q$insert into public.notificaciones(usuario_id,fuente,clave_fuente,referencia,titulo,severidad) values (auth.uid(),'predictive','x','r','t','info')$q$, '42501');
reset role;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false); set role authenticated;
select public.t_expect_error($q$select public.ec_sincronizar_alertas_predictivas_v1('[]'::jsonb)$q$, '42501');
reset role;

\echo 'TODAS LAS PRUEBAS PASARON'
