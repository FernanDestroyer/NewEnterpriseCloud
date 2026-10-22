export type SystemGuideBrand = {
  companyName: string
  ruc?: string
  address?: string
  logoUrl?: string
  author?: string
  issuedLabel: string
  version: string
}

const escape = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

const styles = `
  :root { color-scheme: light; --ink: #13273e; --muted: #5f7386; --teal: #087f86; --gold: #b27c28; --line: #dfe8ee; --soft: #f2f7f8; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e6ecf1; color: var(--ink); font-family: 'Segoe UI', Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1, h2, h3, p, ul, ol { margin: 0; }
  .preview-bar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 24px; background: #11283d; color: #fff; font-size: 12px; }
  .preview-bar small { display: block; color: #b2cbd9; margin-top: 3px; }
  .preview-bar button { border: 0; border-radius: 8px; padding: 11px 20px; background: linear-gradient(120deg, #8df0e7, #ffd98a); color: #11283d; cursor: pointer; font-weight: 800; white-space: nowrap; }
  .sheet { width: 210mm; min-height: 280mm; margin: 22px auto; padding: 12mm 12mm 9mm; background: #fff; box-shadow: 0 12px 50px #152b4022; display: flex; flex-direction: column; break-after: page; }
  .sheet:last-child { break-after: auto; }
  .cover { position: relative; overflow: hidden; border-radius: 14px; color: #fff; background: linear-gradient(130deg, #0e2438 0%, #14424f 55%, #087f86 100%); padding: 26px 28px 24px; }
  .cover::after { content: ''; position: absolute; right: -70px; top: -110px; width: 300px; height: 300px; border: 38px solid #ffffff08; border-radius: 50%; pointer-events: none; }
  .cover::before { content: ''; position: absolute; right: 60px; bottom: -140px; width: 220px; height: 220px; border: 26px solid #ffd98a14; border-radius: 50%; pointer-events: none; }
  .cover-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; position: relative; z-index: 1; }
  .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .logo-box { width: 52px; height: 52px; display: grid; place-items: center; background: #fff; border-radius: 12px; padding: 5px; flex-shrink: 0; }
  .logo-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .logo-fallback { color: var(--teal); font-weight: 900; font-size: 20px; }
  .brand-name { font-size: 14px; font-weight: 800; }
  .brand-sub { margin-top: 4px; color: #c3d5df; font-size: 8px; letter-spacing: .6px; }
  .edition { text-align: right; font-size: 8px; letter-spacing: 1.6px; text-transform: uppercase; color: #a7d9df; }
  .edition strong { display: block; margin-top: 6px; color: #ffd98a; font-size: 10px; letter-spacing: .4px; }
  .cover h1 { position: relative; z-index: 1; margin-top: 26px; font-size: 40px; line-height: 1.02; letter-spacing: -1px; font-weight: 800; }
  .cover h1 span { color: #8df0e7; }
  .cover-lead { position: relative; z-index: 1; margin-top: 12px; max-width: 560px; color: #d7e5ec; font-size: 11px; line-height: 1.65; }
  .cover-meta { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 20px; }
  .cover-meta div { background: #ffffff14; border: 1px solid #ffffff22; border-radius: 10px; padding: 10px 12px; }
  .cover-meta small { display: block; color: #a7d9df; font-size: 7px; text-transform: uppercase; letter-spacing: 1px; }
  .cover-meta strong { display: block; margin-top: 5px; font-size: 10px; }
  .gold-band { margin-top: 16px; position: relative; z-index: 1; display: flex; align-items: center; gap: 10px; background: linear-gradient(90deg, #ffd98a, #f2b950); color: #4a3205; border-radius: 9px; padding: 10px 14px; font-size: 9px; font-weight: 700; }
  .toc { margin-top: 18px; border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; background: var(--soft); }
  .toc h2 { font-size: 12px; letter-spacing: .4px; }
  .toc ol { margin-top: 10px; padding-left: 18px; font-size: 9px; line-height: 2; color: #33475c; columns: 2; column-gap: 28px; }
  .toc b { color: var(--teal); }
  .section { margin-top: 20px; }
  .kicker { font-size: 8px; font-weight: 800; letter-spacing: 1.4px; text-transform: uppercase; color: var(--teal); }
  .section h2 { margin-top: 6px; font-size: 19px; letter-spacing: -.4px; }
  .section > p { margin-top: 8px; font-size: 9.5px; line-height: 1.7; color: #33475c; }
  .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
  .card { border: 1px solid var(--line); border-left: 4px solid var(--teal); border-radius: 10px; padding: 11px 13px; background: #fff; break-inside: avoid; }
  .card.gold { border-left-color: var(--gold); background: #fdfaf2; }
  .card.navy { border-left-color: #294760; background: #f7fafc; }
  .card h3 { font-size: 10px; }
  .card p, .card li { font-size: 8.5px; line-height: 1.6; color: #43586d; }
  .card ul { margin-top: 6px; padding-left: 15px; }
  .card li + li { margin-top: 3px; }
  .flow { margin-top: 12px; display: flex; align-items: stretch; gap: 0; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .flow div { flex: 1; padding: 10px 8px; text-align: center; font-size: 8px; font-weight: 700; background: #f7fafc; color: #294760; }
  .flow div + div { border-left: 1px solid var(--line); }
  .flow div.active { background: #e6f5f4; color: var(--teal); }
  .flow small { display: block; margin-top: 3px; font-weight: 400; color: var(--muted); }
  .tip { margin-top: 12px; display: flex; gap: 10px; background: #edf8f6; border: 1px solid #cde7e3; border-left: 4px solid var(--teal); border-radius: 8px; padding: 10px 12px; font-size: 8.5px; line-height: 1.6; }
  .tip.gold { background: #fdf6e3; border-color: #efdcab; border-left-color: var(--gold); }
  .checklist { margin-top: 10px; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .checklist div { display: flex; gap: 10px; padding: 9px 12px; font-size: 8.5px; line-height: 1.55; }
  .checklist div:nth-child(even) { background: #f5f9fa; }
  .check { flex-shrink: 0; width: 18px; height: 18px; border-radius: 50%; background: var(--teal); color: #fff; display: grid; place-items: center; font-size: 11px; font-weight: 800; }
  .footer { margin-top: auto; padding-top: 12px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; gap: 14px; font-size: 7px; color: var(--muted); }
  .footer strong { color: var(--ink); }
  .page-no { font-weight: 800; letter-spacing: 1px; white-space: nowrap; }
  .sign { margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .sign div { border-top: 1px solid #9fb0bf; padding-top: 8px; font-size: 8px; color: var(--muted); text-align: center; }
  @page { size: A4 portrait; margin: 0; }
  @media print { body { background: #fff; } .preview-bar { display: none; } .sheet { margin: 0; box-shadow: none; } }
`

function card(title: string, items: string[], tone = '') {
  return `<article class="card ${tone}"><h3>${escape(title)}</h3><ul>${items.map((i) => `<li>${escape(i)}</li>`).join('')}</ul></article>`
}

/** Guía formal y ejecutiva del sistema: documento autocontenido listo para imprimir/guardar en PDF. */
export function renderSystemGuide(brand: SystemGuideBrand): string {
  const issued = escape(brand.issuedLabel)
  const company = escape(brand.companyName)
  const sub = [brand.ruc ? `RUC ${brand.ruc}` : 'ERP · EnterpriseCloud', brand.address].filter(Boolean).map(String).join(' · ')

  const cover = `<section class="sheet" aria-label="Portada de la guía del sistema">
    <header class="cover">
      <div class="cover-top">
        <div class="brand"><div class="logo-box">${brand.logoUrl ? `<img src="${escape(brand.logoUrl)}" alt="Logotipo de EnterpriseCloud"/>` : '<span class="logo-fallback">EC</span>'}</div>
        <div><div class="brand-name">${company}</div><div class="brand-sub">${escape(sub)}</div></div></div>
        <div class="edition">Documento oficial<strong>Guía del sistema · ${escape(brand.version)}</strong></div>
      </div>
      <h1>Guía del sistema<br/><span>EnterpriseCloud ERP</span></h1>
      <p class="cover-lead">Manual ejecutivo y operativo para dirigir ventas, compras, inventario, tesorería y reportes desde un solo centro de control conectado a Supabase. Operación real, trazable y preparada para la normativa peruana.</p>
      <div class="cover-meta">
        <div><small>Empresa</small><strong>${company}</strong></div>
        <div><small>Emitido</small><strong>${issued} · Lima, Perú</strong></div>
        <div><small>Elaborado por</small><strong>${escape(brand.author || 'Administración del sistema')}</strong></div>
      </div>
      <div class="gold-band">✔ Documento formal de uso interno · Léelo antes de operar · Conserva el PDF como referencia oficial</div>
    </header>
    <nav class="toc"><h2>Contenido de la guía</h2><ol>
      <li><b>01 ·</b> Presentación y alcance del sistema</li>
      <li><b>02 ·</b> Acceso, roles y seguridad</li>
      <li><b>03 ·</b> Mapa de módulos del ERP</li>
      <li><b>04 ·</b> Flujo de ventas y cotizaciones</li>
      <li><b>05 ·</b> Flujo de compras e ingreso al Kardex</li>
      <li><b>06 ·</b> Inventario, Kardex y alertas</li>
      <li><b>07 ·</b> Tesorería, caja y cuentas</li>
      <li><b>08 ·</b> Yape, RENIEC / SUNAT e importación</li>
      <li><b>09 ·</b> Reportes y buenas prácticas</li>
      <li><b>10 ·</b> Resolución de avisos frecuentes</li>
    </ol></nav>
    <div class="footer"><div><strong>${company}</strong> · Guía del sistema ${escape(brand.version)} · Emitida ${issued}<br/>Información generada desde la operación registrada en Supabase.</div><div class="page-no">01 / 04</div></div>
  </section>`

  const page2 = `<section class="sheet" aria-label="Fundamentos y seguridad">
    <div class="section"><div class="kicker">01 · Fundamentos</div><h2>Presentación y alcance</h2>
      <p>EnterpriseCloud centraliza la operación comercial: cada venta, compra, movimiento de stock y cobro queda registrado una sola vez y se refleja automáticamente en panel, tesorería, Kardex y reportes. No existe modo de demostración: lo que ves es tu operación real.</p>
      <div class="cards">
        ${card('Lo que el sistema hace por ti', ['Unifica ventas, compras, inventario y finanzas en un solo panel.', 'Descuenta o ingresa stock automáticamente al guardar el documento.', 'Genera cuentas por cobrar y por pagar sin digitación doble.', 'Audita altas, cambios y bajas de cada registro.'])}
        ${card('Lo que el sistema no hace', ['No duplica el stock al imprimir un comprobante.', 'No permite stock negativo ni borrar documentos con líneas o pagos.', 'No confirma pagos de Yape/Plin automáticamente: se verifica en la app.', 'No guarda archivos físicos: Documentos conserva referencias y metadatos.'], 'gold')}
      </div>
      <div class="tip"><span>◆</span><p><strong>Principio de oro:</strong> el documento manda. Si la venta está registrada, el stock, la cuenta por cobrar y el comprobante ya existen. No vuelvas a digitarlos.</p></div>
    </div>
    <div class="section"><div class="kicker">02 · Acceso y seguridad</div><h2>Roles, permisos y buenas prácticas</h2>
      <p>El acceso es con correo y contraseña (Supabase Auth). Cada cuenta tiene un perfil activo y un rol; cada acción se autoriza como <strong>módulo + acción</strong> (ver / crear / editar / eliminar). Sin permiso, el módulo ni siquiera aparece en el menú.</p>
      <div class="cards">
        ${card('Roles de referencia', ['Administrador: acceso total y gestión de permisos.', 'Gerente: operación total y supervisión financiera.', 'Operador / Vendedor: operación diaria según su área.', 'Básico: consulta y creación inicial; ideal para nuevos usuarios.'], 'navy')}
        ${card('Reglas de seguridad', ['Nadie puede auto-elevarse el rol desde el navegador.', 'Las cuentas inactivas no ingresan aunque tengan contraseña.', 'Toda autorización se valida en base de datos (RLS).', 'Protege tu sesión y cierra sesión en equipos compartidos.'], '')}
      </div>
    </div>
    <div class="section"><div class="kicker">03 · Mapa del sistema</div><h2>Módulos en una mirada</h2>
      <div class="cards">
        ${card('Comercial', ['Panel de control: resumen, gráfico y alertas.', 'Ventas + comprobantes imprimibles (Factura, Boleta, N. de venta).', 'Cotizaciones convertibles en venta con un clic.', 'Clientes con DNI / RUC, línea de crédito y historial.'])}
        ${card('Abastecimiento', ['Órdenes de compra con seguimiento Solicitud → Pagada.', 'Catálogo por proveedor independiente del inventario.', 'Importación masiva de proveedores por CSV.', 'Ingreso al Kardex solo desde Recepción.'], 'gold')}
        ${card('Operación y finanzas', ['Stock global + Kardex con entradas, salidas y ajustes.', 'Tesorería: cuentas por cobrar / pagar y cancelación total.', 'Caja por turnos con conteo y descuadre por medio.', 'Reportes ejecutivos con exportación a PDF.'], 'navy')}
        ${card('Administración', ['Mantenimiento: clientes, productos, proveedores y empresa.', 'Métodos de pago, monedas y QR de Yape y Plin.', 'Permisos: cuentas, roles y estados.', 'Perfil: nombre, foto y permisos de tu rol.'], '')}
      </div>
    </div>
    <div class="footer"><div><strong>${company}</strong> · Guía del sistema · Fundamentos y seguridad</div><div class="page-no">02 / 04</div></div>
  </section>`

  const page3 = `<section class="sheet" aria-label="Flujos operativos">
    <div class="section"><div class="kicker">04 · Ventas</div><h2>Vender sin fricción y sin errores de stock</h2>
      <p>1) Abre turno en <strong>Caja</strong>. 2) En <strong>Ventas → Nuevo</strong> elige cliente, agrega productos del inventario y define medio de pago. 3) Guarda: el stock se descuenta y la cuenta por cobrar nace sola. 4) Imprime el comprobante desde la tabla.</p>
      <div class="flow"><div class="active">Cotización<small>Opcional · no mueve stock</small></div><div class="active">Venta<small>Descuenta stock + crea CxC</small></div><div>Comprobante<small>F001 / B001 / NV</small></div><div>Cobro<small>Tesorería → Completada</small></div></div>
      <div class="tip"><span>◆</span><p><strong>Tarjeta y crédito:</strong> solo el medio Tarjeta consume la línea de crédito del cliente. El descuento (%) requiere permiso de finanzas y aplica sobre el total con IGV incluido.</p></div>
    </div>
    <div class="section"><div class="kicker">05 · Compras</div><h2>Comprar por fases, ingresar con control</h2>
      <p>La compra avanza por <strong>Solicitud → Orden → Recepción → Factura → Pagada</strong> (con estado intermedio <strong>Recibida</strong> sin stock). El inventario recién se mueve en <strong>Recepción</strong>: ahí el catálogo del proveedor se convierte en productos reales.</p>
      <div class="flow"><div>Solicitud · Orden<small>Sin stock</small></div><div>Recibida<small>En revisión</small></div><div class="active">Recepción<small>Ingresa stock + Kardex</small></div><div>Factura · Pagada<small>CxP con IGV 18%</small></div></div>
      <div class="tip gold"><span>◆</span><p style="color:#6b4a10"><strong>IGV 18%:</strong> la orden guarda el subtotal; la cuenta por pagar suma automáticamente el IGV. Reabrir una recepción valida que lo ya vendido no deje el stock en negativo.</p></div>
    </div>
    <div class="section"><div class="kicker">06 · Inventario — 07 · Tesorería y caja</div><h2>Existencias y dinero siempre conciliados</h2>
      <div class="cards">
        ${card('Inventario y Kardex', ['Stock global en Productos; Almacenes muestra filas reales.', 'Estados automáticos: Estable / Bajo stock (≤5) / Crítico (0).', 'Kardex registra entradas, salidas, ajustes y transferencias.', 'Costo promedio ponderado desde compras para valorizar.'])}
        ${card('Tesorería y caja', ['CxC y CxP nacen de ventas y compras; no se digitan aparte.', 'Cobrar / Pagar completa también el documento origen.', 'Caja exige un solo turno Abierto con conteo por medio.', 'El descuadre = contado menos esperado del sistema.'], 'navy')}
      </div>
    </div>
    <div class="footer"><div><strong>${company}</strong> · Guía del sistema · Flujos operativos</div><div class="page-no">03 / 04</div></div>
  </section>`

  const page4 = `<section class="sheet" aria-label="Integraciones y cierre">
    <div class="section"><div class="kicker">08 · Integraciones peruanas</div><h2>Yape, RENIEC / SUNAT e importación masiva</h2>
      <div class="cards">
        ${card('Yape y Plin con QR del negocio', ['Sube tu QR en Mantenimiento → QR de Yape o QR de Plin (PNG/JPG/WebP ≤1MB).', 'En Nueva venta elige Yape o Plin: se muestra el QR con el total vivo.', 'El cliente digita el monto en su app; verifica y marca Completada.'])}
        ${card('DNI y RUC verificados', ['Clientes: DNI 8 dígitos o RUC 11 con dígito verificador.', 'Botón de búsqueda autocompleta nombre y dirección.', 'Proveedores: botón SUNAT con RUC; sin token, digitación manual.'], 'gold')}
        ${card('Importación por CSV', ['Plantilla: ruc, razon_social, direccion, correo, telefono, forma_pago, estado, productos.', 'Productos: “Nombre | costo | detalle // …” entrecomillado.', 'El sistema valida RUC, duplicados y costos sin abortar la carga.'], 'navy')}
        ${card('Comprobantes formales', ['Series automáticas: F001, B001, COT y NV con correlativo.', 'El voucher desglosa base e IGV (total / 1.18) solo en presentación.', 'Imprime desde la tabla; reimprimir no mueve stock.'], '')}
      </div>
    </div>
    <div class="section"><div class="kicker">09 · Reportes y disciplina operativa</div><h2>Decide con datos y opera con estándar</h2>
      <div class="checklist">
        <div><span class="check">✓</span><span><strong>Reportes por período:</strong> filtra por fechas (calendario America/Lima), revisa ventas, compras, valorización, CxC y Kardex, y exporta el resultado filtrado.</span></div>
        <div><span class="check">✓</span><span><strong>Rutina diaria:</strong> abre caja → registra ventas/compras → atiende alertas de stock → concilia cobros y pagos → cierra turno con conteo.</span></div>
        <div><span class="check">✓</span><span><strong>Mantenimiento semanal:</strong> depura RUC duplicados, catálogo huérfano y cuentas sin documento desde Mantenimiento.</span></div>
        <div><span class="check">✓</span><span><strong>Respaldo:</strong> descarga el respaldo JSON desde Mantenimiento antes de cargas masivas o cierres.</span></div>
      </div>
    </div>
    <div class="section"><div class="kicker">10 · Avisos frecuentes</div><h2>Si ves un aviso, actúa así</h2>
      <div class="cards">
        ${card('Mensajes típicos', ['“Sin turno abierto”: ve a Caja y abre turno antes de vender.', '“Stock insuficiente”: reduce cantidad o ingresa compra a Recepción.', '“Línea de crédito superada”: cambia medio o amplía la línea del cliente.', '“Falta migración / sin permiso”: contacta al administrador.'], 'gold')}
        ${card('Compromiso de uso', ['Registra el mismo día: el gráfico y los saldos dependen de la fecha real.', 'No edites ventas completadas para “corregir” stock: usa el Kardex.', 'Toda cobranza queda en Tesorería, no en notas externas.', 'Ante duda, consulta esta guía antes de borrar un registro.'], 'navy')}
      </div>
      <div class="sign"><div>Administración · Firma y sello</div><div>Responsable de operación · Firma</div></div>
    </div>
    <div class="footer"><div><strong>${company}</strong> · Guía del sistema ${escape(brand.version)} · Emitida ${issued} · Documento interno de operación</div><div class="page-no">04 / 04</div></div>
  </section>`

  const script = `<script>
    document.getElementById('print-guide').addEventListener('click', function(){window.print()});
    window.addEventListener('load', function(){
      var ready = Array.from(document.images).map(function(image){
        if(image.complete) return Promise.resolve();
        return new Promise(function(resolve){image.addEventListener('load',resolve,{once:true});image.addEventListener('error',resolve,{once:true})});
      });
      if(document.fonts) ready.push(document.fonts.ready);
      Promise.race([Promise.all(ready), new Promise(function(resolve){setTimeout(resolve,1800)})]).then(function(){requestAnimationFrame(function(){window.print()})});
    }, { once: true });
  </script>`

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Guía del sistema · ${company} · EnterpriseCloud</title><style>${styles}</style></head><body><div class="preview-bar"><div><strong>Guía del sistema · ${company}</strong><small>En el diálogo de impresión elige Guardar como PDF · A4 vertical · Márgenes mínimos.</small></div><button id="print-guide" type="button">Imprimir / Guardar PDF</button></div><main>${cover}${page2}${page3}${page4}</main>${script}</body></html>`
}
