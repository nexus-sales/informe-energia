(function () {
    "use strict";

    // Genera el informe como documento PDF "real" (pdfmake), en vez de imprimir el
    // DOM de la app. Es aditivo: no toca renderReport ni window.print(). Recibe los
    // mismos datos que ya usa renderReport (currentRecord + brand) y construye un
    // docDefinition de pdfmake desde cero — texto plano, sin HTML ni escapeHtml().

    var NAVY = '#173254';
    var NAVY_DARK = '#0E2038';
    var TEAL_DARK = '#0B6355';
    var MUTED = '#5B6672';
    var LINE = '#DCE3E1';
    var RED = '#B23B3B';
    var INK = '#16212B';

    // Mismo mapeo posición → color que ya usa la pantalla (offer-accent-1/2/3).
    var OFFER_COLORS = ['#0B6355', '#C98A2C', '#5C6BC0'];
    var OFFER_TINTS = ['#E8F4EE', '#FBF1E1', '#ECEEFA'];

    function parsePercent(str) {
        if (!str) return null;
        var m = String(str).replace(',', '.').match(/-?\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : null;
    }

    function formatDate(iso) {
        try {
            var d = new Date(iso);
            return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
        } catch (e) { return ''; }
    }

    function normalizeOfertas(record) {
        var ofertas = (Array.isArray(record.ofertas) && record.ofertas.length) ? record.ofertas : [{
            comercializadora: record.comercializadora, productoTarifa: record.productoTarifa,
            tarifaAcceso: record.tarifaAcceso, fechaOferta: record.fechaOferta, referenciaOferta: record.referenciaOferta,
            permanencia: record.permanencia, desglose: record.desglose, totalOferta: record.totalOferta,
            ahorroImporte: record.ahorroImporte, ahorroPorcentaje: record.ahorroPorcentaje,
            ahorroAnualEstimado: record.ahorroAnualEstimado, resumenRecomendacion: record.resumenRecomendacion,
            puntosClave: record.puntosClave, nombreArchivo: record.nombreArchivo
        }];
        var multi = ofertas.length > 1;
        if (multi) {
            ofertas = ofertas.slice().sort(function (a, b) {
                var pa = parsePercent(a.ahorroPorcentaje);
                var pb = parsePercent(b.ahorroPorcentaje);
                if (pa === null && pb === null) return 0;
                if (pa === null) return 1;
                if (pb === null) return -1;
                return pb - pa;
            });
        }
        return { ofertas: ofertas, multi: multi };
    }

    // ---- bloques reutilizables ----

    function buildHeaderBlock(record, brand) {
        var hasLogo = !!(brand && brand.logo);
        var hasName = !!(brand && brand.name);
        var rightStack = {
            width: '*',
            stack: [
                { text: 'INFORME EJECUTIVO', fontSize: 9, bold: true, color: TEAL_DARK, characterSpacing: 0.6, alignment: hasLogo || hasName ? 'right' : 'left' },
                { text: 'Propuesta de cambio de comercializadora', fontSize: 9, color: MUTED, alignment: hasLogo || hasName ? 'right' : 'left', margin: [0, 1, 0, 0] },
                { text: 'Generado el ' + formatDate(record.fechaGenerado), fontSize: 8, color: MUTED, alignment: hasLogo || hasName ? 'right' : 'left', margin: [0, 2, 0, 0] }
            ]
        };

        if (!hasLogo && !hasName) {
            // Sin marca configurada: cabecera simple (ya alineada a la izquierda
            // porque hasLogo||hasName es false), sin hueco vacío donde iría el logo.
            return { stack: rightStack.stack, margin: [0, 0, 0, 14] };
        }

        var leftContent;
        if (hasLogo && hasName) {
            leftContent = {
                width: 'auto',
                columns: [
                    { image: brand.logo, fit: [46, 46], margin: [0, 0, 8, 0] },
                    { text: brand.name, fontSize: 14, bold: true, color: NAVY_DARK, margin: [0, 12, 0, 0] }
                ]
            };
        } else if (hasLogo) {
            leftContent = { width: 'auto', image: brand.logo, fit: [50, 50] };
        } else {
            leftContent = { width: 'auto', text: brand.name, fontSize: 15, bold: true, color: NAVY_DARK, margin: [0, 10, 0, 0] };
        }

        return {
            columns: [leftContent, rightStack],
            margin: [0, 0, 0, 6]
        };
    }

    function bordersTableLayout(opts) {
        opts = opts || {};
        return {
            hLineWidth: function () { return 0.75; },
            vLineWidth: function () { return 0.75; },
            hLineColor: function () { return LINE; },
            vLineColor: function () { return LINE; },
            paddingLeft: function () { return opts.padH || 8; },
            paddingRight: function () { return opts.padH || 8; },
            paddingTop: function () { return opts.padV || 6; },
            paddingBottom: function () { return opts.padV || 6; }
        };
    }

    function fichaRow(label, value) {
        return [
            { text: label, fontSize: 9, bold: true, color: MUTED },
            { text: value, fontSize: 9.5, color: NAVY_DARK }
        ];
    }
    function fichaRowMissing(label) {
        return [
            { text: label, fontSize: 9, bold: true, color: MUTED },
            { text: 'No especificado en el documento', fontSize: 9, italics: true, color: RED }
        ];
    }
    function fichaRowInfo(label, value) {
        return value
            ? [{ text: label, fontSize: 9, bold: true, color: MUTED }, { text: value, fontSize: 9.5, color: NAVY_DARK }]
            : [{ text: label, fontSize: 9, bold: true, color: MUTED }, { text: 'No indicado en la oferta', fontSize: 9, italics: true, color: '#93A0AA' }];
    }

    function buildClientFichaBlock(record) {
        // Solo se listan los campos que el usuario ya ha rellenado en pantalla —
        // sin placeholders "[Nombre del cliente]": si no hay dato, la fila se omite.
        var candidates = [
            ['Cliente', record.cliente],
            ['Contacto cliente', record.telefonoCliente],
            ['Email cliente', record.emailCliente],
            ['Comercial asignado', record.comercial],
            ['Contacto comercial', record.telefonoComercial]
        ];
        var rows = candidates
            .filter(function (c) { return c[1]; })
            .map(function (c) { return fichaRow(c[0], c[1]); });

        if (!rows.length) return null; // nada relleno: no se imprime ninguna ficha vacía

        return {
            table: { widths: [140, '*'], body: rows },
            layout: bordersTableLayout(),
            margin: [0, 0, 0, 16]
        };
    }

    function buildNotesFichaBlock(record) {
        // Igual criterio que buildClientFichaBlock: solo filas rellenas, sin
        // placeholders; si ninguna tiene valor, no se imprime ninguna ficha vacía.
        var candidates = [
            ['Precio de excedentes', record.precioExcedentes],
            ['Observaciones', record.observaciones]
        ];
        var rows = candidates
            .filter(function (c) { return c[1]; })
            .map(function (c) { return fichaRow(c[0], c[1]); });

        if (!rows.length) return null;

        return {
            table: { widths: [140, '*'], body: rows },
            layout: bordersTableLayout(),
            margin: [0, 0, 0, 18]
        };
    }

    function buildOfferFichaBlock(oferta) {
        var rows = [];
        rows.push(oferta.comercializadora ? fichaRow('Comercializadora', oferta.comercializadora) : fichaRowMissing('Comercializadora'));
        rows.push(oferta.productoTarifa ? fichaRow('Producto / tarifa', oferta.productoTarifa) : fichaRowMissing('Producto / tarifa'));
        rows.push(oferta.permanencia ? fichaRow('Permanencia', oferta.permanencia) : fichaRowMissing('Permanencia'));
        rows.push(oferta.referenciaOferta ? fichaRow('Referencia de la oferta', oferta.referenciaOferta) : fichaRowMissing('Referencia de la oferta'));
        return {
            table: { widths: [140, '*'], body: rows },
            layout: bordersTableLayout(),
            margin: [0, 0, 0, 16]
        };
    }

    function buildSituacionActualBlock(record) {
        var rows = [
            fichaRowInfo('Tarifa de acceso', record.tarifaAcceso),
            fichaRowInfo('Periodo analizado', record.periodoDescripcion),
            fichaRowInfo('Consumo anual', record.consumoAnualKwh),
            fichaRowInfo('Potencia contratada', record.potenciaContratada),
            fichaRowInfo('Consumo del periodo', record.consumoPeriodo),
            fichaRowInfo('Instalación', record.notasInstalacion),
            fichaRowInfo('Coste estimado factura actual', record.facturaActualEstimada)
        ];
        return {
            table: { widths: [180, '*'], body: rows },
            layout: bordersTableLayout(),
            margin: [0, 0, 0, 18]
        };
    }

    // pdfmake no soporta "border" en text nodes; usamos una tabla de 1 celda con
    // borde inferior para simular el subrayado de sección que ya existe en pantalla.
    function sectionTitleBlock(text) {
        return {
            table: {
                widths: ['*'],
                body: [[{ text: text, fontSize: 13, bold: true, color: NAVY, border: [false, false, false, true], borderColor: [null, null, null, LINE] }]]
            },
            layout: {
                hLineWidth: function (i) { return i === 1 ? 0.75 : 0; },
                vLineWidth: function () { return 0; },
                hLineColor: function () { return LINE; },
                paddingLeft: function () { return 0; },
                paddingRight: function () { return 0; },
                paddingTop: function () { return 2; },
                paddingBottom: function () { return 8; }
            },
            margin: [0, 6, 0, 10]
        };
    }

    function offerHeaderBand(oferta, color, isBest) {
        var titleParts = oferta.comercializadora || 'Comercializadora';
        if (oferta.productoTarifa) titleParts += ' — ' + oferta.productoTarifa;
        return {
            table: {
                widths: ['*'],
                body: [[{
                    text: [
                        { text: titleParts, bold: true, fontSize: 12, color: '#fff' },
                        isBest ? { text: '   — Mejor opción', italics: true, fontSize: 9.5, color: '#fff' } : ''
                    ],
                    fillColor: color,
                    margin: [10, 7, 10, 7]
                }]]
            },
            layout: 'noBorders',
            margin: [0, 0, 0, 0]
        };
    }

    function offerSavingHighlight(oferta, color) {
        var mainText = oferta.ahorroImporte
            ? ('Ahorras ' + oferta.ahorroImporte + (oferta.ahorroPorcentaje ? ' (' + oferta.ahorroPorcentaje + ')' : ''))
            : (oferta.ahorroPorcentaje ? ('Ahorro estimado (' + oferta.ahorroPorcentaje + ')') : 'Ahorro estimado no indicado');
        var subParts = [];
        subParts.push('Oferta: ' + (oferta.totalOferta || '—'));
        if (oferta.ahorroAnualEstimado) subParts.push('Ahorro anual estimado: ' + oferta.ahorroAnualEstimado);
        return {
            stack: [
                { text: mainText, fontSize: 17, bold: true, color: color, margin: [10, 10, 10, 2] },
                { text: subParts.join('   ·   '), fontSize: 9, color: MUTED, margin: [10, 0, 10, 10] }
            ]
        };
    }

    function desgloseTable(oferta) {
        var rows = (Array.isArray(oferta.desglose) ? oferta.desglose : []).map(function (row) {
            return [
                { text: row.concepto || '', fontSize: 9.5, color: INK },
                { text: row.importe || '', fontSize: 9.5, color: INK, alignment: 'right' }
            ];
        });
        rows.push([
            { text: 'TOTAL OFERTA', bold: true, fontSize: 10, color: '#fff', fillColor: NAVY, margin: [8, 5, 8, 5] },
            { text: oferta.totalOferta || '—', bold: true, fontSize: 10, color: '#fff', fillColor: NAVY, alignment: 'right', margin: [8, 5, 8, 5] }
        ]);
        return {
            table: { widths: ['*', 90], body: rows },
            layout: {
                hLineWidth: function () { return 0.5; },
                vLineWidth: function () { return 0; },
                hLineColor: function () { return LINE; },
                paddingLeft: function () { return 8; },
                paddingRight: function () { return 8; },
                paddingTop: function () { return 5; },
                paddingBottom: function () { return 5; }
            },
            margin: [0, 0, 0, 16]
        };
    }

    function offerSection(oferta, idx, isBest, multi) {
        var color = OFFER_COLORS[idx % OFFER_COLORS.length];
        var blocks = [];
        blocks.push(offerHeaderBand(oferta, color, multi && isBest));
        blocks.push(offerSavingHighlight(oferta, color));
        if (!multi) blocks.push(buildOfferFichaBlock(oferta));
        blocks.push(desgloseTable(oferta));
        return {
            stack: blocks,
            margin: [0, 0, 0, 20],
            unbreakable: true
        };
    }

    // Filete de color a la izquierda del bloque de recomendación — se construye con
    // una tabla de 2 columnas (borde vertical coloreado) en vez de un fondo de
    // tarjeta completo, para que se lea como una nota editorial, no como un widget.
    function accentRuleBlock(contentArray, color) {
        // Nota: un borde vertical contra una columna de ancho 0 no se pinta en
        // pdfmake (se probó y no renderiza). En su lugar, la "franja" es una
        // celda estrecha con fillColor sólido — misma técnica que ya funciona
        // en la fila TOTAL OFERTA — que se estira a la altura de la fila.
        return {
            table: {
                widths: [4, '*'],
                body: [[
                    { text: '', fillColor: color, border: [false, false, false, false] },
                    { stack: contentArray, border: [false, false, false, false], margin: [10, 4, 4, 4] }
                ]]
            },
            layout: {
                hLineWidth: function () { return 0; },
                vLineWidth: function () { return 0; },
                paddingLeft: function () { return 0; },
                paddingRight: function () { return 0; },
                paddingTop: function () { return 0; },
                paddingBottom: function () { return 0; }
            },
            margin: [0, 0, 0, 14],
            unbreakable: true
        };
    }

    function offerRecommendationBlock(oferta, idx, isBest, multi) {
        var color = OFFER_COLORS[idx % OFFER_COLORS.length];
        var nameLine = (multi && isBest ? 'Opción recomendada · ' : '') + (oferta.comercializadora || 'Comercializadora');
        var content = [{ text: nameLine, bold: true, fontSize: 11.5, color: NAVY_DARK, margin: [0, 0, 0, 4] }];
        if (oferta.resumenRecomendacion) {
            content.push({ text: oferta.resumenRecomendacion, fontSize: 9.5, color: '#2E3B45', lineHeight: 1.35, margin: [0, 0, 0, 6] });
        }
        var puntos = Array.isArray(oferta.puntosClave) ? oferta.puntosClave : [];
        if (puntos.length) {
            content.push({
                ul: puntos.map(function (p) { return { text: p, fontSize: 9.5, color: '#2E3B45' }; }),
                margin: [0, 0, 0, 0]
            });
        }
        return accentRuleBlock(content, color);
    }

    function buildFooter(record) {
        return function (currentPage, pageCount) {
            return {
                margin: [40, 8, 40, 0],
                stack: [
                    {
                        canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: LINE }],
                        margin: [0, 0, 0, 4]
                    },
                    {
                        columns: [
                            {
                                width: '*',
                                text: 'Informe generado automáticamente a partir de los documentos de oferta subidos. Verifica los importes con los documentos originales antes de presentarlo al cliente. Los precios quedan sujetos a las condiciones contractuales de cada comercializadora.',
                                fontSize: 6.5, italics: true, color: '#93A0AA', lineHeight: 1.3
                            },
                            { width: 42, text: currentPage + ' / ' + pageCount, fontSize: 7.5, color: '#93A0AA', alignment: 'right' }
                        ]
                    }
                ]
            };
        };
    }

    function buildDocDefinition(record, brand) {
        var norm = normalizeOfertas(record);
        var ofertas = norm.ofertas;
        var multi = norm.multi;

        var reportTitle = multi
            ? 'Comparativa de ' + ofertas.length + ' ofertas para tu suministro'
            : ('Propuesta de cambio: ' + (ofertas[0].comercializadora || 'Comercializadora') +
                (ofertas[0].productoTarifa ? ' — ' + ofertas[0].productoTarifa : ''));

        var content = [];
        content.push(buildHeaderBlock(record, brand));
        content.push({ text: reportTitle, fontSize: 19, bold: true, color: NAVY_DARK, margin: [0, 0, 0, 4] });
        var subtitleBits = [];
        if (record.tarifaAcceso) subtitleBits.push('Tarifa de acceso ' + record.tarifaAcceso);
        if (multi) subtitleBits.push('Comparando: ' + ofertas.map(function (o) { return o.comercializadora || 'Comercializadora'; }).join(' · '));
        else if (ofertas[0].fechaOferta) subtitleBits.push('Oferta del ' + ofertas[0].fechaOferta);
        if (subtitleBits.length) content.push({ text: subtitleBits.join('   ·   '), fontSize: 9.5, color: MUTED, margin: [0, 0, 0, 16] });

        var clientFicha = buildClientFichaBlock(record);
        if (clientFicha) content.push(clientFicha);

        // Cada título de sección se agrupa con SOLO su primer bloque de contenido
        // en un stack unbreakable — así el título nunca puede quedar huérfano al
        // final de una página, sin forzar la sección entera (que puede ser larga,
        // p.ej. 3 ofertas) a moverse en bloque y dejar un hueco en blanco grande.
        content.push({
            unbreakable: true,
            stack: [sectionTitleBlock('1 · Situación actual'), buildSituacionActualBlock(record)]
        });

        var notesFicha = buildNotesFichaBlock(record);
        if (notesFicha) content.push(notesFicha);

        var bestIdx = 0; // ofertas ya vienen ordenadas de mayor a menor ahorro
        var offerSections = ofertas.map(function (oferta, idx) {
            return offerSection(oferta, idx, idx === bestIdx, multi);
        });
        content.push({
            unbreakable: true,
            stack: [sectionTitleBlock(multi ? '2 · Las propuestas' : '2 · La propuesta'), offerSections[0]]
        });
        offerSections.slice(1).forEach(function (s) { content.push(s); });

        var recommendationBlocks = ofertas.map(function (oferta, idx) {
            return offerRecommendationBlock(oferta, idx, idx === bestIdx, multi);
        });
        content.push({
            unbreakable: true,
            stack: [sectionTitleBlock('3 · Recomendación'), recommendationBlocks[0]]
        });
        recommendationBlocks.slice(1).forEach(function (b) { content.push(b); });
        if (multi) {
            content.push({
                text: 'Te presentamos estas alternativas de forma imparcial, sin inclinarnos por ninguna comercializadora concreta — la decisión final es tuya.',
                fontSize: 9, italics: true, color: MUTED, margin: [0, 0, 0, 16]
            });
        }

        content.push({
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        { text: '¿Damos el siguiente paso?', bold: true, fontSize: 12, color: '#fff', margin: [0, 0, 0, 5] },
                        { text: 'Confirma tu decisión contactando con tu comercial asignado (datos arriba).', fontSize: 9, color: '#EAF3F0', margin: [0, 0, 0, 2] },
                        { text: 'Nos encargamos de toda la gestión del cambio: sin cortes de suministro ni papeleo por tu parte.', fontSize: 9, color: '#EAF3F0' }
                    ],
                    fillColor: NAVY_DARK,
                    margin: [14, 12, 14, 12]
                }]]
            },
            layout: 'noBorders',
            margin: [0, 4, 0, 0],
            unbreakable: true
        });

        var fuentes = ofertas.map(function (o) { return o.nombreArchivo; }).filter(Boolean).join(' · ');

        return {
            pageSize: 'A4',
            pageMargins: [40, 40, 40, 46],
            defaultStyle: { font: 'Roboto' },
            content: content,
            footer: buildFooter(record),
            info: {
                title: reportTitle,
                subject: 'Informe de ahorro energético'
            }
        };
    }

    var DIACRITIC_MARKS = /[̀-ͯ]/g;
    function slugify(str) {
        return String(str).toLowerCase().normalize('NFD').replace(DIACRITIC_MARKS, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }
    function fileNameFor(record) {
        // Informe-{cliente-o-generico}-{fecha}.pdf — sin fecha, dos informes sin
        // nombre de cliente relleno colisionarían en la carpeta de Descargas.
        var namePart = slugify(record.cliente || 'cliente') || 'cliente';
        var datePart = '';
        var d = new Date(record.fechaGenerado);
        if (!isNaN(d.getTime())) {
            var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
            datePart = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        }
        return ['Informe', namePart, datePart].filter(Boolean).join('-') + '.pdf';
    }

    function download(record, brand) {
        if (!record) return;
        var docDefinition = buildDocDefinition(record, brand || {});
        pdfMake.createPdf(docDefinition).download(fileNameFor(record));
    }

    function getBlob(record, brand, callback) {
        var docDefinition = buildDocDefinition(record, brand || {});
        pdfMake.createPdf(docDefinition).getBlob(callback);
    }

    window.PdfExport = {
        buildDocDefinition: buildDocDefinition,
        download: download,
        getBlob: getBlob
    };
})();
