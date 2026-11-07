-- Maestros necesita leer las monedas para configurar el tipo de cambio.
-- La lectura se comparte entre Finanzas y Configuración; la escritura directa
-- sigue reservada a Finanzas y la tasa se actualiza por RPC con configuración:editar.

drop policy if exists monedas_select on public.monedas;
create policy monedas_select on public.monedas
  for select to authenticated
  using (
    (select public.tiene_permiso('finanzas', 'ver'))
    or (select public.tiene_permiso('configuracion', 'ver'))
  );
