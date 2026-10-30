# D08 — Límites y consumo de Contratos Marco

- Un contrato establece dos límites duros: un tope monetario total bruto (incluye impuestos) y un tope de cantidad para cada línea.
- La tolerancia permitida es 0%: una liberación que rebase cualquiera de los límites se bloquea; no se redondea ni se autoriza exceso.
- Ejemplo: contrato con tope de S/ 10,000 y línea “Filtro” con máximo de 100 unidades. Un compromiso bruto acumulado de S/ 9,500 y 95 filtros deja S/ 500 y 5 unidades. Una liberación de 6 filtros o cuyo total bruto acumulado supere S/ 10,000 se rechaza aunque el otro límite aún tenga saldo.
- Si una orden vinculada se cancela antes de recibirla, el cupo comprometido se restituye automáticamente. La implementación transaccional y sus reglas de concurrencia corresponden a F08–F09; no se implementan en este bloque.
- Activar el contrato solo habilita su uso futuro: no crea cuentas por pagar, recepciones, movimientos de inventario ni stock.
- Diseño de datos para este bloque: PEN o USD como moneda del tope; las líneas y órdenes futuras vinculadas deben mantener la misma moneda. La cifra del ejemplo se expresa en PEN.
