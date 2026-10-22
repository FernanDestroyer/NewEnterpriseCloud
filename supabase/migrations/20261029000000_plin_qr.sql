-- QR de Plin: se guarda en configuracion (codigo PLIN_QR), igual que el de Yape.
-- Los usuarios de ventas/finanzas pueden leer exclusivamente esa configuracion.
-- La escritura conserva los permisos de configuracion existentes.

drop policy if exists configuracion_plin_select on public.configuracion;
create policy configuracion_plin_select on public.configuracion
  for select to authenticated
  using (
    codigo = 'PLIN_QR'
    and (
      (select public.tiene_permiso('ventas', 'ver'))
      or (select public.tiene_permiso('finanzas', 'ver'))
    )
  );
