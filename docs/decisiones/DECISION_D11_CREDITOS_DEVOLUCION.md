# D11 — Créditos por devolución

- Registrar una devolución reduce las existencias físicas y deja trazabilidad en Kardex.
- Compras conserva la referencia documental y el seguimiento del crédito; la devolución y su compensación no modifican automáticamente la CxP ni las aplicaciones de Tesorería.
- Tesorería aplica manualmente la Nota de Crédito a la deuda.
- Una reposición es una nueva recepción estándar contra la misma orden, ligada a la línea de devolución que la habilita; el servidor limita su cantidad a lo devuelto, no compensado y aún pendiente de reposición.
- Una devolución errónea se corrige mediante un evento compensatorio append-only con entrada inversa en Kardex. No se elimina ni altera el evento original.
