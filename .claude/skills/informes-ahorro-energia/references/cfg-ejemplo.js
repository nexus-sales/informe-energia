/*
 * EJEMPLO DE USO de scripts/report_builder.js
 * -------------------------------------------
 * Este es el cfg real, ya validado, del caso NIBA de la primera vez que se usó
 * este skill. Cópialo como punto de partida y sustituye los valores por los
 * datos extraídos del nuevo PDF (ver references/extraction-schema.md).
 *
 * Pasos para generar un informe nuevo:
 *   1. Copia scripts/report_builder.js y scripts/package.json a un directorio
 *      de trabajo (p.ej. /home/claude/work/).
 *   2. npm install (docx, image-size).
 *   3. Renderiza la primera página del PDF de la oferta a imagen:
 *        pdftoppm -jpeg -r 150 oferta.pdf oferta_page
 *      Recorta una cabecera (banner) si quieres, igual que en el caso NIBA/Repsol.
 *   4. Construye un objeto cfg como el de abajo con los datos extraídos
 *      (ver extraction-schema.md para los nombres de campo del JSON de extracción
 *      y cómo mapean a este cfg).
 *   5. const { buildReport } = require('./report_builder.js');
 *      const { Packer } = require('docx');
 *      const fs = require('fs');
 *      Packer.toBuffer(buildReport(cfg)).then(buf => fs.writeFileSync('Informe.docx', buf));
 *   6. Verifica SIEMPRE el resultado: convierte a PDF con soffice, renderiza con
 *      pdftoppm y revisa las imágenes antes de entregarlo (ver skill docx).
 */

const nibaCfgEjemplo = {
  title: "Propuesta de cambio: NIBA — Tarifa ZEN ENCHUFATE",
  subtitle: "Simulación basada en tu consumo real · Tarifa de acceso 2.0TD · Oferta emitida el 8 de julio de 2026",
  offerName: "NIBA ZEN ENCHUFATE",
  offerShortName: "Oferta NIBA",
  // Ficha del informe: [etiqueta, valor, esEditable?] — esEditable=true -> se pinta en rojo
  // (dato que el humano debe rellenar o que no vino en el documento).
  fichaRows: [
    ["Cliente", "[Nombre del cliente]", true],
    ["Contacto cliente", "[Teléfono cliente] · [Email cliente]", true],
    ["Comercial asignado", "[Nombre comercial] · [Teléfono] · [Email]", true],
    ["Comercializadora ofertante", "NIBA"],
    ["Producto / tarifa ofertada", "NIBA ZEN ENCHUFATE"],
    ["Permanencia", "No especificada en el documento de oferta", true],
    ["Referencia de la oferta", "No indicada en el documento", true],
    ["Fecha de la oferta", "8/7/2026"],
  ],
  section1Intro: "Estos son los datos de tu factura y consumo que se han utilizado como base para la simulación, correspondientes a un periodo de 29 días.",
  currentInfoRows: [
    ["Tarifa de acceso", "2.0TD"],
    ["Periodo analizado", "29 días"],
    ["Potencia contratada", "P1: 3,45 kW  ·  P2: 3,45 kW"],
    ["Consumo del periodo", "P1: 63,30 kWh  ·  P2: 84,40 kWh  ·  P3: 63,30 kWh"],
    ["Coste estimado de tu factura actual", "42,59 €"],
  ],
  section2Intro: "NIBA presenta su tarifa ZEN ENCHUFATE, calculada con los mismos consumos y potencias que tu factura actual para que la comparación sea directa.",
  bannerImage: "img/niba_banner.jpg",   // recorte de cabecera de la oferta original (pdftoppm)
  bannerCaption: "Cabecera de la oferta original emitida por NIBA (documento completo en el Anexo).",
  compareRows: [
    ["Total del periodo (29 días)", "42,59 €", "39,59 €", "-3,00 €"],
  ],
  savingsMain: "Ahorras 3,00 € en tu factura (7,06 %)",
  savingsSub: "Sobre un periodo de 29 días. Manteniendo tu patrón de consumo, esto equivale a un ahorro aproximado de 38 € al año.",
  breakdownRows: [
    ["Término de potencia (P1 + P2)", "13,80 €"],
    ["Término de energía (P1 + P2 + P3)", "24,27 €"],
    ["Bono social", "0,55 €"],
    ["Impuesto eléctrico (0,50 %)", "0,19 €"],
    ["Alquiler de equipos", "0,77 €"],
    ["IVA (0 %)", "0,00 €"],
  ],
  breakdownTotalLabel: "TOTAL OFERTA NIBA ZEN ENCHUFATE",
  breakdownTotalValue: "39,59 €",
  section2Note: "* El ahorro anual es una estimación proporcional a partir del ahorro del periodo simulado; no incluye variaciones estacionales de consumo ni posibles regularizaciones.",
  recommendationParas: [
    "La oferta de NIBA supone un ahorro claro y sin cambios en tus hábitos de consumo ni en tu potencia contratada: mismas potencias, mismos periodos, un precio del kWh más bajo.",
    "El ahorro del 7,06 % es moderado pero constante mes a mes, y el cambio no conlleva ningún coste ni riesgo para ti como cliente.",
  ],
  recommendationBullets: [
    "Sin permanencia forzosa ni penalización por cambio de comercializadora.",
    "Misma potencia contratada: no es necesario tramitar ningún cambio técnico con la distribuidora.",
    "Precio de energía único (0,115 €/kWh) más sencillo de entender que tu tarifa actual.",
  ],
  ctaTitle: "¿Damos el siguiente paso?",
  ctaLines: (cfg) => [
    "Confirma tu decisión respondiendo a este informe o contactando con tu comercial asignado (datos en la ficha del informe, arriba).",
    "Nos encargamos de toda la gestión del cambio: sin cortes de suministro ni papeleo por tu parte.",
  ],
  disclaimerText: "Esta es una simulación basada en los datos facilitados por el cliente y en los precios de la oferta en la fecha indicada. Los importes mostrados son estimados y no incluyen posibles regularizaciones ni servicios adicionales no contemplados. Los precios de la oferta quedan sujetos a las condiciones contractuales de la comercializadora.",
  appendixIntro: "A continuación se incluye la propuesta original tal como la emitió NIBA, para tu consulta y verificación de los datos.",
  fullImage: "img/niba_page-1.jpg",   // página completa de la oferta original (pdftoppm)
  appendixCaption: "Documento original: Propuesta de Ahorro Energético — NIBA (8/7/2026).",
};

module.exports = { nibaCfgEjemplo };
