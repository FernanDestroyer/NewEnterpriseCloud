begin;

alter policy sucursales_read on public.sucursales
  using (
    (select public.tiene_permiso('configuracion', 'ver'))
    or (select public.tiene_permiso('finanzas', 'ver'))
  );

drop policy sucursales_finanzas_read on public.sucursales;

commit;
