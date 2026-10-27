-- Impide que una cotización sin líneas se convierta en una venta vacía.
begin;
create or replace function public.validar_cotizacion_completada_con_lineas()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.estado = 'Completada' and old.estado is distinct from new.estado
     and not exists (select 1 from public.detalle_cotizaciones dc where dc.cotizacion_id = new.id) then
    raise exception 'No se puede completar una cotización sin productos.' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists cotizacion_completada_requiere_lineas on public.cotizaciones;
create trigger cotizacion_completada_requiere_lineas before update of estado on public.cotizaciones
for each row execute function public.validar_cotizacion_completada_con_lineas();
commit;