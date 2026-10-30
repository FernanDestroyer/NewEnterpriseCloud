# Decisiones de Compras — Fase C

Fecha de aprobación: 29-10-2026. Fuente: confirmación explícita del usuario.

## D01 — Importaciones

- La carga CSV histórica es únicamente ingreso de datos; no representa una importación comercial ni genera un expediente logístico.
- La Fase G será responsable de compras internacionales, embarques y aduanas.
- Consecuencia: no introducir metadatos de embarque/aduana en la ruta CSV histórica.

## D02 — Autoridad por acción

| Acción | Actor autorizado |
|---|---|
| Solicitar una compra | Cualquier usuario |
| Seleccionar una oferta | Rol Compras |
| Confirmar una orden | JefeCompras |

Estas reglas se aplicarán en RPC/RLS de las fases correspondientes; la presentación de controles en UI no constituye autorización.

## D03 — Nacimiento de CxP

Se conserva la decisión validada en B: la CxP nace al registrar recepción física o documental; órdenes sin recepción no originan obligación y recepciones parciales reconocen únicamente lo recibido. Las líneas recibidas no se editan.

## D04 — Tratamiento tributario

- El cálculo se realiza por línea.
- Tratamientos: `Gravado` al 18%, `Exonerado` al 0% e `Inafecto` al 0%.
- Base, impuesto y total de cada línea se redondean a 2 decimales; el total autoritativo es exactamente base + impuesto.
- Las órdenes históricas no se reclasifican automáticamente; sus snapshots pueden permanecer nulos hasta una migración contable explícita.

Ejemplos por línea: base 100.00 Gravado → impuesto 18.00, total 118.00; base 100.00 Exonerado → 0.00, 100.00; base 100.01 Inafecto → 0.00, 100.01. En una línea Gravada de base 0.03, `round(0.03 × 18%, 2)` produce 0.01 y total 0.04.

## D05 — Moneda y tipo de cambio

- Moneda base: PEN; monedas admitidas en esta fase: PEN y USD.
- `exchange_rate` es manual y se captura al confirmar la orden. Para USD puede permanecer nulo mientras la orden no esté confirmada; debe ser positivo al confirmarla.
- El tipo de cambio es un snapshot de la orden. No se convierte automáticamente el importe durante esta migración.

## D10 — Unidades

- Stock y líneas de orden usan cantidades enteras.
- Solo la solicitud inicial admite hasta 3 decimales.
- Al convertir una solicitud histórica fraccionaria a orden, la cantidad se redondeará al entero superior (techo), sin modificar retrospectivamente la solicitud.

## Cierre certificado de Fase C

El usuario certificó oficialmente la Fase C tras aplicar `20261107000000` en remoto. La UI refleja correctamente los cálculos, las exportaciones están alineadas, las órdenes históricas permanecieron intactas y la cuenta por pagar registra la moneda con unicidad estricta. El conteo asociado a C06 está documentado internamente; este documento no replica el número.

D01–D05 y D10 quedan registradas abajo y arriba, respectivamente. La consulta de diagnóstico ejecutada por el usuario fue:

```sql
select id, solicitud_id, descripcion, cantidad, unidad
from public.solicitud_compra_lineas
where cantidad <> trunc(cantidad)
order by solicitud_id, id;
```
