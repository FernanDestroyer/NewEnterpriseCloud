-- La regla de un único turno abierto se debe cumplir también bajo concurrencia.
-- Si existieran duplicados históricos, se detiene sin modificar datos para
-- que puedan revisarse manualmente antes de crear el índice.

begin;

do $migration$
begin
  if exists (
    select 1
    from public.caja_turnos
    where estado = 'Abierto'
    group by estado
    having count(*) > 1
  ) then
    raise exception 'Hay más de un turno abierto. Revisa y cierra los duplicados antes de aplicar esta migración.'
      using errcode = '23514';
  end if;
end
$migration$;

create unique index if not exists caja_turnos_un_solo_abierto_uidx
  on public.caja_turnos (estado)
  where estado = 'Abierto';

commit;
