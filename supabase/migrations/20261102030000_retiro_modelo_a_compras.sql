-- Retira el Modelo A del ciclo de compras (solicitudes_compra / ofertas_compra /
-- transferencias_inventario y sus funciones), consolidando el flujo en el Modelo B
-- (requisiciones_compra / ofertas_proveedor / transferencias_almacen).
--
-- Verificado contra la base remota antes de retirar:
--   * `compras` y `detalle_compras` mantienen 8 columnas de enlace hacia el Modelo A,
--     todas con valor NULL (ninguna ordenlinked proviene del sourcing).
--   * Ninguna vista o vista materializada referencia a las 7 tablas.
--   * La única tabla de soporte en app_private con FK al Modelo A es
--     purchase_sourcing_conversion, y su única usuaria es convertir_solicitud_a_orden_v1.
--   * trg_proteger_linea_compra_vinculada_solicitud Solo protege líneas cuya
--     solicitud_linea_id no es NULL, y Dicha columna se retira junto con el modelo.
begin;

-- 1. Funciones del ciclo solicitud -> oferta -> orden y de transferencias (19).
drop function if exists public.abrir_solicitud_compra(uuid);
drop function if exists public.abrir_solicitud_compra_v2(uuid, text);
drop function if exists public.cancelar_solicitud_compra_v1(uuid, text, text);
drop function if exists public.convertir_solicitud_a_orden_v1(uuid, text);
drop function if exists public.crear_solicitud_compra(text, date, jsonb);
drop function if exists public.crear_solicitud_compra_v2(text, date, jsonb, text);
drop function if exists public.crear_solicitud_compra_v3(text, date, jsonb, text);
drop function if exists public.editar_solicitud_compra_v1(uuid, integer, text, date, jsonb, text);
drop function if exists public.listar_solicitudes_compra_paginado_v1(text, date, date, text, integer, integer);
drop function if exists public.obtener_detalle_solicitud_compra_v1(uuid);
drop function if exists public.registrar_oferta_compra(uuid, uuid, date, integer, text, jsonb);
drop function if exists public.registrar_oferta_compra_v2(uuid, uuid, date, integer, text, jsonb, text);
drop function if exists public.registrar_oferta_compra_v3(uuid, uuid, date, integer, text, jsonb, text);
drop function if exists public.registrar_oferta_compra_v4(uuid, uuid, date, integer, text, jsonb, text, text, numeric);
drop function if exists public.seleccionar_oferta_compra(uuid, uuid);
drop function if exists public.seleccionar_oferta_compra_v2(uuid, uuid, text);
drop function if exists public.seleccionar_oferta_compra_v3(uuid, uuid, text, text);
drop function if exists public.seleccionar_oferta_compra_v4(uuid, uuid, text, text);
drop function if exists public.transferir_stock_entre_almacenes(uuid, uuid, jsonb, text, text);

-- 2. Soporte de idempotencia/conversión propios del Modelo A.
drop table if exists app_private.purchase_sourcing_conversion;

-- 3. Trigger de protección de líneas vinculadas al sourcing retirado.
drop trigger if exists trg_proteger_linea_compra_vinculada_solicitud on public.detalle_compras;
drop function if exists app_private._proteger_linea_compra_vinculada_solicitud_v1();

-- 4. Constraints compuestos y de coherencia que apuntan al Modelo A.
alter table public.detalle_compras drop constraint if exists detalle_compras_orden_origen_fk;
alter table public.detalle_compras drop constraint if exists detalle_compras_oferta_linea_origen_fk;
alter table public.detalle_compras drop constraint if exists detalle_compras_oferta_solicitud_linea_fk;
alter table public.detalle_compras drop constraint if exists detalle_compras_solicitud_linea_origen_fk;
alter table public.detalle_compras drop constraint if exists detalle_compras_detalle_oferta_id_fkey;
alter table public.detalle_compras drop constraint if exists detalle_compras_oferta_compra_id_fkey;
alter table public.detalle_compras drop constraint if exists detalle_compras_solicitud_compra_id_fkey;
alter table public.detalle_compras drop constraint if exists detalle_compras_solicitud_linea_id_fkey;

alter table public.compras drop constraint if exists compras_oferta_solicitud_coherentes_fk;
alter table public.compras drop constraint if exists compras_oferta_proveedor_coherentes_fk;
alter table public.compras drop constraint if exists compras_solicitud_compra_id_fkey;
alter table public.compras drop constraint if exists compras_oferta_compra_id_fkey;

-- 5. Índices parciales/únicos sobre las columnas que se retiran.
drop index if exists public.compras_oferta_origen_unica_idx;
drop index if exists public.compras_origen_fk_unico_idx;
drop index if exists public.compras_solicitud_compra_idx;
drop index if exists public.compras_solicitud_origen_unica_idx;
drop index if exists public.compras_proveedor_oferta_fk_unico_idx;
drop index if exists public.detalle_compras_oferta_linea_unica_idx;
drop index if exists public.detalle_compras_solicitud_linea_unica_idx;

-- 6. Check constraints de coherencia del sourcing.
alter table public.compras drop constraint if exists compras_sourcing_origen_ck;
alter table public.detalle_compras drop constraint if exists detalle_compras_origen_completo_ck;

-- 7. Columnas de enlace (verificadas en NULL sobre las 6 compras y 11 líneas).
alter table public.compras
  drop column if exists solicitud_compra_id,
  drop column if exists oferta_compra_id;
alter table public.detalle_compras
  drop column if exists solicitud_linea_id,
  drop column if exists detalle_oferta_id,
  drop column if exists solicitud_compra_id,
  drop column if exists oferta_compra_id;

-- 7b. FK circular solicitud <-> oferta (el resto de FKs internas se retira con su tabla).
alter table public.solicitudes_compra drop constraint if exists solicitudes_compra_seleccion_fk;

-- 8. Tablas del Modelo A (hijas primero).
drop table if exists public.detalle_ofertas_compra;
drop table if exists public.ofertas_compra;
drop table if exists public.solicitudes_compra_historial;
drop table if exists public.solicitud_compra_lineas;
drop table if exists public.solicitudes_compra;
drop table if exists public.detalle_transferencias_inventario;
drop table if exists public.transferencias_inventario;

commit;
