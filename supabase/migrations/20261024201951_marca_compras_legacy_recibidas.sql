-- Los estados históricos Factura, Recibida, Recepción y Pagada ya implicaban
-- ingreso de stock en el flujo anterior. Se marcan como recibidos para evitar
-- que el nuevo proceso por almacén vuelva a sumar esas unidades.
update public.compras
set estado_recepcion = 'completa'
where lower(trim(estado)) in ('factura', 'recibida', 'recepción', 'pagada')
  and estado_recepcion = 'pendiente';
