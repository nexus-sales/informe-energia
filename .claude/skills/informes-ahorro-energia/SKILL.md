---
name: informes-ahorro-energia
description: Genera informes ejecutivos de cambio de comercializadora energética (luz/gas) a partir de una oferta en PDF de cualquier CRM o comercializadora (NIBA, Repsol, o cualquier otra). Usa este skill SIEMPRE que el usuario suba uno o varios PDF de ofertas/simulaciones de comercializadoras eléctricas o de gas, o pida un "informe de ahorro energético", "comparativa de oferta energética", "propuesta de cambio de suministro/comercializadora", una "ficha de cliente" para presentar una oferta, o la "app"/"herramienta"/"histórico" de informes de ahorro — incluso si no lo pide con la palabra "informe". Cubre tanto un documento Word (.docx) pulido para presentar al cliente como la herramienta interactiva en HTML (self-serve, con historial) ya construida para este usuario.
---

# Informes de Ahorro Energético

Genera informes ejecutivos que comparan la factura actual de un cliente con la oferta
de una comercializadora energética, listos para presentar al cliente final. El usuario
es un asesor/bróker energético que compara ofertas de varios CRM.

## Regla de oro: nunca inventar datos

Los PDF de oferta de los CRM casi nunca traen nombre del cliente, teléfono, email, datos
del comercial, ni permanencia. **No los inventes ni los asumas.** Márcalos como pendientes
de rellenar (rojo en el Word, campo editable en la app) en vez de fabricarlos. Si el
documento no da el importe de la factura actual pero sí el ahorro en euros, sí puedes
calcularlo (total oferta + ahorro) y debes indicar que es una estimación derivada.

El esquema completo de campos a extraer está en `references/extraction-schema.md` — léelo
antes de extraer datos de un PDF nuevo, es la fuente de verdad que comparten el Word y la
app.

## Qué entregar: dos modos

Pregúntate primero qué quiere el usuario (o pregúntaselo si no está claro):

### Modo A — Documento Word (.docx)
Para presentar UN informe puntual a un cliente. Es el formato por defecto si el usuario
sube un PDF y pide "el informe" sin más contexto.

1. Lee primero `/mnt/skills/public/docx/SKILL.md` (gotchas de docx-js).
2. Lee `references/extraction-schema.md` y extrae los datos del PDF subido.
3. Renderiza la primera página del PDF original a imagen (para el Anexo y, si quieres,
   un recorte de cabecera como "ancla visual"):
   ```
   pdftoppm -jpeg -r 150 oferta.pdf oferta_page
   ```
4. Copia `scripts/report_builder.js` y `scripts/package.json` a tu directorio de trabajo,
   `npm install`, y construye un `cfg` con los datos extraídos — usa
   `references/cfg-ejemplo.js` como plantilla exacta de los campos esperados (es un caso
   real ya validado, no un esqueleto vacío).
5. Genera el `.docx`:
   ```js
   const { buildReport } = require('./report_builder.js');
   const { Packer } = require('docx');
   const fs = require('fs');
   Packer.toBuffer(buildReport(cfg)).then(buf => fs.writeFileSync('Informe.docx', buf));
   ```
6. Verifica SIEMPRE el resultado antes de entregarlo: convierte a PDF con
   `soffice.py --headless --convert-to pdf`, renderiza con `pdftoppm` y revisa las
   imágenes (página por página) — es el mismo paso que exige el skill de docx.
7. Copia el `.docx` final a `/mnt/user-data/outputs/` y preséntalo.

Estructura del informe (fija, no la reinventes):
1. **Ficha del informe** — cliente, contacto, comercial (editables/rojo) + comercializadora,
   producto/tarifa, permanencia, referencia (extraídos, rojo si faltan).
2. **1 · Situación actual** — tarifa de acceso, periodo, potencia, consumo, coste estimado
   de la factura actual.
3. **2 · La propuesta** — desglose económico de la oferta + total + aviso destacado de
   ahorro (importe y %).
4. **3 · Recomendación** — 2-3 frases + puntos clave + caja de llamada a la acción.
5. **Anexo** — página completa de la oferta original renderizada como imagen.

Estilo: paleta navy/teal/verde (ahorro) — reutiliza los tokens de color ya definidos en
`report_builder.js` (NAVY, TEAL, GREEN, GREEN_BG, GRAY_TEXT). Tono cercano, sin
tecnicismos, dirigido al cliente final (no al bróker). Incluye siempre el disclaimer de
que son importes estimados sujetos a las condiciones contractuales de la comercializadora.

### Modo B — Herramienta interactiva (HTML)
Para cuando el usuario quiere generar informes él mismo sin volver a pedírmelo cada vez,
o pide explícitamente "la app", "la herramienta", "el histórico".

`assets/app-template.html` ya es genérico (no hace falta tocarlo por CRM): sube cualquier
PDF, llama a la API de Claude para extraer los datos con el mismo esquema de
`extraction-schema.md`, renderiza el informe en pantalla, permite editar cliente/comercial,
guarda historial personal y exporta a PDF vía impresión del navegador. Simplemente:
```
cp assets/app-template.html /mnt/user-data/outputs/informes-ahorro-energia.html
```
y preséntalo con `present_files`. No necesita datos de este usuario incrustados — es la
misma herramienta cada vez.

**Importante — modo dual (no lo rompas al editar):** la app detecta sola si se está
ejecutando dentro del visor de artefactos de Claude (`window.storage` existe → usa
`window.storage` y llama a la API sin clave, gratis dentro del plan de Claude.ai) o si se
ha descargado y se sirve fuera (Live Server, GitHub Pages, cualquier hosting propio —
`window.storage` no existe → modo standalone: usa `localStorage` del navegador para el
historial, y pide al usuario su propia clave de la API de Anthropic en una pantalla de
"Ajustes", añadiendo las cabeceras `x-api-key`, `anthropic-version` y
`anthropic-dangerous-direct-browser-access: true` a la llamada). La clave nunca se escribe
en el archivo, solo se guarda en el `localStorage` del navegador del usuario. Si el usuario
pide cambios en la app, mantén esta detección (`isStandalone`) y ambos caminos de
storage/autenticación funcionando.

Si el usuario pide cambios de diseño o de campos en la app, edítala con criterio pero
mantén: el esquema de extracción, el guardado con historial personal, el bloque
`@media print` que oculta el menú/botones al exportar, y el documento HTML5 completo
(`<!DOCTYPE html><html><head>...<meta charset="UTF-8">...</head><body>...</body></html>`)
— sin esto último, servidores locales tipo Live Server pueden romper el `<script>` al
inyectar su script de recarga.

## Recordatorios
- No fabriques nombre del cliente, comercial, ni permanencia si no están en el documento.
- Si el usuario sube más de un PDF sin decir qué quiere, pregunta si son ofertas de
  distintos clientes/consumos (informes separados) o alternativas para el mismo cliente
  (mismo informe, comparando varias ofertas) — no lo asumas.
- Verifica visualmente cualquier `.docx` generado antes de entregarlo (soffice + pdftoppm
  + view), igual que exige el skill de docx.
