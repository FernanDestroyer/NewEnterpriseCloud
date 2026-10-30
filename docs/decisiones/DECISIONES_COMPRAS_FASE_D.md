# Decisiones de Compras — Fase D

## D108 — Adjudicación total

- Una solicitud se adjudica completa a una sola oferta/proveedor: “el ganador se lo lleva todo”.
- La conversión genera como máximo una orden por solicitud; no se divide por líneas ni por proveedor.
- La conversión D109–D111 usa el contrato existente de órdenes recepcionables: cada línea debe tener producto maestro y un vínculo inequívoco con el catálogo del proveedor ganador.
- Las cantidades fraccionarias de solicitud se convierten al entero superior para la orden, conforme a D10, sin alterar la solicitud original.

## D107 — Base de comparación

- El comparativo considera importes por línea con el tratamiento y tasa tributaria capturados en la oferta (Gravado 18%, Exonerado/Inafecto 0%).
- La tasa usada es la del motor tributario ya configurado en Fase C; el total de cada propuesta se normaliza a PEN con el tipo de cambio manual snapshot de la oferta.
- Cotizaciones en otra moneda sin tipo de cambio válido, ofertas incompletas y total cero no pueden resultar seleccionadas.
- El SQL de D107–D114 está preparado localmente y pendiente de aplicación/certificación remotas.
