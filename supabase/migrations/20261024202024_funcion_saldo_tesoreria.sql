-- Devuelve el saldo calculado desde aplicaciones no anuladas, sin duplicar
-- consultas de todos los movimientos en el cliente.
create or replace function public.obtener_saldos_cuentas(p_cuenta_ids uuid[])
returns table(cuenta_id uuid, monto_original numeric, monto_aplicado numeric, saldo_pendiente numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not (select public.tiene_permiso('finanzas','ver')) then
    raise exception 'Se requiere permiso para consultar saldos de Tesorería.' using errcode='42501';
  end if;
  return query
    select p.id, p.monto::numeric,
      coalesce(sum(a.monto) filter (where m.anulado_en is null),0)::numeric(14,2),
      greatest(0,p.monto-coalesce(sum(a.monto) filter (where m.anulado_en is null),0))::numeric(14,2)
    from public.pagos p
    left join public.aplicaciones_pago a on a.cuenta_id=p.id
    left join public.movimientos_tesoreria m on m.id=a.movimiento_id
    where p.id=any(coalesce(p_cuenta_ids,'{}'::uuid[]))
    group by p.id,p.monto;
end $$;
revoke all on function public.obtener_saldos_cuentas(uuid[]) from public,anon;
grant execute on function public.obtener_saldos_cuentas(uuid[]) to authenticated;
