-- Tipo de cambio centralizado en Maestros.
-- `monedas.tipo_cambio` expresa cuántos soles (PEN) vale una unidad de la moneda.
-- Ventas lo consume automáticamente y guarda una copia en cada pedido/cotización.

alter table public.monedas
  add column if not exists tipo_cambio numeric(14,6) not null default 1;

alter table public.monedas drop constraint if exists monedas_tipo_cambio_positivo;
alter table public.monedas
  add constraint monedas_tipo_cambio_positivo check (tipo_cambio > 0);

alter table public.monedas drop constraint if exists monedas_pen_tipo_cambio_uno;
alter table public.monedas
  add constraint monedas_pen_tipo_cambio_uno check (codigo <> 'PEN' or tipo_cambio = 1);

update public.monedas set tipo_cambio = 1 where codigo = 'PEN';

insert into public.monedas (nombre, codigo, simbolo, activo, tipo_cambio)
values ('Dólar estadounidense', 'USD', '$', true, 3.75)
on conflict (codigo) do nothing;

create or replace function public.ec_tipo_cambio_venta_v1(p_codigo text default 'USD')
returns numeric
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select m.tipo_cambio
    from public.monedas m
    where m.codigo = upper(trim(p_codigo)) and m.activo
  ), 0)
  where (select auth.uid()) is not null
$function$;

revoke all on function public.ec_tipo_cambio_venta_v1(text) from public;
grant execute on function public.ec_tipo_cambio_venta_v1(text) to authenticated;

create or replace function public.ec_actualizar_tipo_cambio_v1(p_codigo text, p_tipo_cambio numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_codigo text := upper(trim(coalesce(p_codigo, '')));
  v_rate numeric := round(coalesce(p_tipo_cambio, 0), 6);
  v_row public.monedas%rowtype;
begin
  if (select auth.uid()) is null or not (select public.tiene_permiso('configuracion', 'editar')) then
    raise exception 'Sin permiso de configuración.' using errcode = '42501';
  end if;
  if v_codigo !~ '^[A-Z]{3}$' then
    raise exception 'Código de moneda inválido.';
  end if;
  if v_rate <= 0 then
    raise exception 'El tipo de cambio debe ser mayor que cero.';
  end if;
  if v_codigo = 'PEN' then
    v_rate := 1;
  end if;

  update public.monedas
  set tipo_cambio = v_rate
  where codigo = v_codigo
  returning * into v_row;

  if not found then
    raise exception 'La moneda % no está registrada.', v_codigo;
  end if;

  return jsonb_build_object('codigo', v_row.codigo, 'tipo_cambio', v_row.tipo_cambio);
end
$function$;

revoke all on function public.ec_actualizar_tipo_cambio_v1(text, numeric) from public;
grant execute on function public.ec_actualizar_tipo_cambio_v1(text, numeric) to authenticated;
