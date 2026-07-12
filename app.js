        (function () {
            "use strict";

            // ---------------- state ----------------
            var mode = 'upload'; // upload | loading | error | report-new | report-detail | history-list | settings
            var currentRecord = null;
            var indexCache = [];
            var errorMsg = '';
            var saveTimer = null;
            var draftOfertas = []; // ofertas extraídas pendientes de combinar en un informe (máx. 3)
            var MAX_OFERTAS = 3;
            // Si window.storage no existe, no estamos dentro del visor de artefactos de Claude
            // (p.ej. se ha descargado y se sirve con Live Server u otro hosting) — modo standalone.
            var isStandalone = (typeof window.storage === 'undefined');
            var storageAvailable = true; // siempre hay algo (window.storage o localStorage)
            var API_KEY_LS = 'informes-ahorro-energia:api-key';
            var BRAND_NAME_KEY = 'brand-name';
            var BRAND_LOGO_KEY = 'brand-logo';
            var BRAND_LOGO_MAX_WIDTH = 320;
            var brandName = '';
            var brandLogo = '';

            var mainEl, navNewEl, navHistoryEl, navSettingsEl, historyCountEl, settingsBadgeEl, sidebarHintEl,
                brandMarkEl, brandTextEl, brandSubEl;

            // ---------------- utils ----------------
            function escapeHtml(v) {
                if (v === null || v === undefined) return '';
                return String(v)
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            }
            function formatDateTime(iso) {
                try {
                    var d = new Date(iso);
                    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' · ' +
                        d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                } catch (e) { return iso || ''; }
            }
            function parsePercent(str) {
                if (!str) return null;
                var m = String(str).replace(',', '.').match(/-?\d+(\.\d+)?/);
                return m ? parseFloat(m[0]) : null;
            }
            function firstValue(values, fallback) {
                for (var i = 0; i < values.length; i++) {
                    if (values[i]) return values[i];
                }
                return fallback || '';
            }
            function gaugeSVG(pct) {
                var size = 64, stroke = 7;
                var r = (size - stroke) / 2;
                var c = 2 * Math.PI * r;
                var p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
                var dash = (p / 100) * c;
                var color = p >= 15 ? 'var(--teal)' : (p > 0 ? 'var(--amber)' : '#C7CFCD');
                var label = pct === null ? '—' : (Math.round(p) + '%');
                return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" class="gauge">' +
                    '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="#E3E9E7" stroke-width="' + stroke + '"/>' +
                    '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + stroke + '" stroke-linecap="round" stroke-dasharray="' + dash + ' ' + (c - dash) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' +
                    '<text x="50%" y="52%" text-anchor="middle" dominant-baseline="central" class="gauge-text">' + label + '</text>' +
                    '</svg>';
            }
            function fileToBase64(file) {
                return new Promise(function (resolve, reject) {
                    var reader = new FileReader();
                    reader.onload = function () { resolve(String(reader.result).split(',')[1]); };
                    reader.onerror = function () { reject(new Error('No se pudo leer el archivo.')); };
                    reader.readAsDataURL(file);
                });
            }
            function getApiKey() {
                try { return localStorage.getItem(API_KEY_LS) || ''; } catch (e) { return ''; }
            }
            function setApiKey(value) {
                try { localStorage.setItem(API_KEY_LS, value || ''); return true; } catch (e) { return false; }
            }
            function clearApiKey() {
                try { localStorage.removeItem(API_KEY_LS); } catch (e) { }
            }
            function maskKey(key) {
                if (!key) return '';
                if (key.length <= 8) return '••••••••';
                return key.slice(0, 7) + '…' + key.slice(-4);
            }
            function resizeImageToDataUrl(file, maxWidth) {
                return new Promise(function (resolve, reject) {
                    var reader = new FileReader();
                    reader.onload = function () {
                        var img = new Image();
                        img.onload = function () {
                            var scale = Math.min(1, maxWidth / img.width);
                            var w = Math.max(1, Math.round(img.width * scale));
                            var h = Math.max(1, Math.round(img.height * scale));
                            var canvas = document.createElement('canvas');
                            canvas.width = w; canvas.height = h;
                            var ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0, w, h);
                            var mime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
                            try {
                                resolve(mime === 'image/jpeg' ? canvas.toDataURL(mime, 0.85) : canvas.toDataURL(mime));
                            } catch (e) { reject(e); }
                        };
                        img.onerror = function () { reject(new Error('No se pudo leer la imagen.')); };
                        img.src = String(reader.result);
                    };
                    reader.onerror = function () { reject(new Error('No se pudo leer el archivo.')); };
                    reader.readAsDataURL(file);
                });
            }
            async function loadBrand() {
                brandName = (await getStorage(BRAND_NAME_KEY)) || '';
                brandLogo = (await getStorage(BRAND_LOGO_KEY)) || '';
            }
            function applyBrand() {
                if (brandMarkEl) {
                    brandMarkEl.innerHTML = brandLogo
                        ? '<img src="' + brandLogo + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">'
                        : 'A';
                }
                if (brandTextEl) brandTextEl.textContent = brandName || 'Informes de Ahorro';
                if (brandSubEl) brandSubEl.style.display = brandName ? 'none' : '';
            }

            // ---------------- storage backend ----------------
            // Dentro de Claude: window.storage (persistente, gestionado por la plataforma).
            // Standalone: localStorage del navegador (persistente solo en ese navegador/máquina).
            var localBackendPrefix = 'informes-ahorro-energia:data:';
            var localStorageBackend = {
                async get(key) {
                    var v;
                    try { v = localStorage.getItem(localBackendPrefix + key); } catch (e) { v = null; }
                    if (v === null || v === undefined) throw new Error('not found');
                    return { key: key, value: v };
                },
                async set(key, value) {
                    localStorage.setItem(localBackendPrefix + key, value);
                    return { key: key, value: value };
                },
                async delete(key) {
                    var existed = false;
                    try { existed = localStorage.getItem(localBackendPrefix + key) !== null; } catch (e) { }
                    try { localStorage.removeItem(localBackendPrefix + key); } catch (e) { }
                    return { key: key, deleted: existed };
                },
                async list(prefix) {
                    var keys = [];
                    try {
                        for (var i = 0; i < localStorage.length; i++) {
                            var k = localStorage.key(i);
                            if (k && k.indexOf(localBackendPrefix) === 0) {
                                var stripped = k.slice(localBackendPrefix.length);
                                if (!prefix || stripped.indexOf(prefix) === 0) keys.push(stripped);
                            }
                        }
                    } catch (e) { }
                    return { keys: keys };
                }
            };
            var storageBackend = isStandalone ? localStorageBackend : window.storage;

            async function getStorage(key) {
                try {
                    var res = isStandalone ? await storageBackend.get(key) : await storageBackend.get(key, false);
                    return res ? res.value : null;
                } catch (e) { return null; }
            }
            async function setStorage(key, value) {
                try {
                    if (isStandalone) await storageBackend.set(key, value);
                    else await storageBackend.set(key, value, false);
                    return true;
                } catch (e) { console.error('storage set failed', e); return false; }
            }
            async function deleteStorageKey(key) {
                try {
                    if (isStandalone) await storageBackend.delete(key);
                    else await storageBackend.delete(key, false);
                } catch (e) { }
            }
            async function refreshIndex() {
                var raw = await getStorage('informes-index');
                try { indexCache = raw ? JSON.parse(raw) : []; } catch (e) { indexCache = []; }
                if (historyCountEl) historyCountEl.textContent = String(indexCache.length);
            }
            function summaryFromRecord(record) {
                var ofertas = Array.isArray(record.ofertas) && record.ofertas.length ? record.ofertas : [{
                    comercializadora: record.comercializadora,
                    productoTarifa: record.productoTarifa,
                    ahorroPorcentaje: record.ahorroPorcentaje,
                    totalOferta: record.totalOferta
                }];
                var best = ofertas[0];
                ofertas.forEach(function (o) {
                    var p = parsePercent(o.ahorroPorcentaje);
                    var bp = parsePercent(best.ahorroPorcentaje);
                    if (p !== null && (bp === null || p > bp)) best = o;
                });
                return {
                    id: record.id,
                    comercializadora: ofertas.length > 1
                        ? (ofertas.length + ' comercializadoras comparadas')
                        : best.comercializadora,
                    productoTarifa: ofertas.length > 1 ? null : best.productoTarifa,
                    cliente: record.cliente,
                    fechaGenerado: record.fechaGenerado,
                    ahorroPorcentaje: best.ahorroPorcentaje,
                    totalOferta: best.totalOferta
                };
            }
            async function persistRecord(record) {
                await setStorage('informe-detalle:' + record.id, JSON.stringify(record));
                var idx = indexCache.findIndex(function (r) { return r.id === record.id; });
                var summary = summaryFromRecord(record);
                if (idx >= 0) indexCache[idx] = summary; else indexCache.unshift(summary);
                await setStorage('informes-index', JSON.stringify(indexCache));
                if (historyCountEl) historyCountEl.textContent = String(indexCache.length);
            }
            function scheduleSave() {
                clearTimeout(saveTimer);
                saveTimer = setTimeout(function () { persistRecord(currentRecord); }, 600);
            }

            // ---------------- Claude API extraction ----------------
            async function extractWithClaude(base64) {
                if (isStandalone && !getApiKey()) {
                    var err = new Error('Esta copia se está ejecutando fuera de Claude (servidor local), así que necesita tu propia clave de la API de Anthropic. Configúrala en "Ajustes".');
                    err.needsApiKey = true;
                    throw err;
                }
                var prompt = [
                    'Eres un asistente que extrae datos de ofertas de comercializadoras eléctricas o de gas',
                    '(documentos tipo "propuesta de ahorro" o "simulación de oferta") para un asesor energético que las presenta a clientes finales.',
                    '',
                    'Lee el PDF adjunto y devuelve ÚNICAMENTE un objeto JSON válido (sin texto antes ni después, sin bloques de código con ```), con exactamente estas claves:',
                    '',
                    '{',
                    '"comercializadora": string,',
                    '"productoTarifa": string o null (nombre comercial de la tarifa/producto tal como lo presenta la comercializadora como título de su oferta, p.ej. "NIBA ZEN ENCHUFATE" o "PRECIO FIJO V31" — NUNCA un servicio adicional, complemento o línea del desglose económico como "Asistente Smart Hogar"; si el documento no da un nombre propio de tarifa, usa null: no tomes prestado el nombre de otro concepto),',
                    '"tarifaAcceso": string o null (p.ej. "2.0TD"),',
                    '"fechaOferta": string o null,',
                    '"referenciaOferta": string o null (número de oferta, factura o estudio),',
                    '"periodoDescripcion": string o null (días o fechas del periodo analizado),',
                    '"consumoAnualKwh": string o null,',
                    '"potenciaContratada": string o null,',
                    '"consumoPeriodo": string o null,',
                    '"notasInstalacion": string o null (p.ej. autoconsumo solar, excedentes, si se menciona),',
                    '"desglose": [ { "concepto": string, "importe": string } ] (SOLO conceptos de coste individuales: consumo por periodo, potencia por periodo, servicios adicionales con su propio importe, y CUALQUIER línea de impuesto o tasa que el documento muestre con su propio importe — IVA, IGIC, IEE/Impuesto Eléctrico, o cualquier otro nombre que use el documento. Transcribe el nombre y el porcentaje EXACTAMENTE como los indica el documento, letra por letra (nunca inventes, calcules ni asumas un tipo impositivo que el documento no indique explícitamente). Lo ÚNICO que se excluye es la fila que ya sea el TOTAL FINAL del documento tras aplicar impuestos — "Subtotal", "Total", "Total oferta" o un resumen tipo "Base Imponible + Impuesto = X" — nunca la línea del impuesto en sí; la plantilla del informe calcula y muestra ese total final ella misma, y repetirlo aquí lo duplica),',
                    '"totalOferta": string (importe total de la oferta),',
                    '"facturaActualEstimada": string o null (si el documento no da el importe de la factura actual pero sí el ahorro en euros, CALCÚLALO sumando total de la oferta + ahorro en euros e indícalo; si no hay datos suficientes, null),',
                    '"ahorroImporte": string o null,',
                    '"ahorroPorcentaje": string o null,',
                    '"ahorroAnualEstimado": string o null,',
                    '"permanencia": string o null (condiciones de permanencia si se mencionan),',
                    '"clienteNombre": string o null,',
                    '"clienteTelefono": string o null,',
                    '"clienteEmail": string o null,',
                    '"resumenRecomendacion": string (2-3 frases cortas en español, dirigidas al cliente final, valorando el cambio según los datos, tono profesional y cercano, sin tecnicismos),',
                    '"puntosClave": [string] (3 a 5 puntos clave, cada uno de menos de 15 palabras, en español)',
                    '}',
                    '',
                    'Reglas importantes:',
                    '- No inventes ni asumas datos que no estén en el documento: usa null si no aparecen.',
                    '- Importes en formato "12,34 €" (coma decimal, símbolo de euro).',
                    '- Sé conciso en los textos para no exceder el límite de salida.',
                    '- Redacta "resumenRecomendacion" como criterio de asesor energético: indica por qué conviene o no conviene, y menciona cautelas contractuales si aplican.',
                    '- En "puntosClave", prioriza ahorro, permanencia, servicios adicionales, impuestos, potencia/tarifa y próximo paso verificable.',
                    '- En "resumenRecomendacion" y "puntosClave", dirígete siempre al cliente de tú (tuteo): "tu factura", "ahorras", "tu potencia". No uses nunca la forma "usted".',
                    '- "desglose" no debe contener ninguna fila que sea el total final del documento (Subtotal/Total/Total oferta): si dudas si una línea es ese total final o un concepto individual, exclúyela. Esto NO aplica a líneas de impuesto o tasa con su propio importe (IVA, IGIC, IEE/Impuesto Eléctrico, o cualquier otro nombre): esas sí son conceptos individuales y deben incluirse siempre que tengan un importe propio, no un total acumulado.',
                    '- "productoTarifa" nunca debe coincidir textualmente con ninguna fila de "desglose": son campos distintos y no deben mezclarse.',
                    '- IVA, IGIC e IEE/Impuesto Eléctrico son impuestos distintos entre sí, nunca sinónimos ni intercambiables. Transcribe el nombre y el porcentaje de cada uno EXACTAMENTE como los indica el documento. Nunca asumas, calcules ni infieras qué impuesto aplica o a qué tipo (ni por ubicación, ni por tipo de contrato, ni por ningún otro criterio): si el documento no lo dice explícitamente, no lo pongas.'
                ].join('\n');

                var headers = { 'Content-Type': 'application/json' };
                if (isStandalone) {
                    headers['x-api-key'] = getApiKey();
                    headers['anthropic-version'] = '2023-06-01';
                    headers['anthropic-dangerous-direct-browser-access'] = 'true';
                }
                var response = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        model: 'claude-sonnet-4-6',
                        max_tokens: 2000,
                        messages: [{
                            role: 'user',
                            content: [
                                { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
                                { type: 'text', text: prompt }
                            ]
                        }]
                    })
                });

                if (!response.ok) {
                    var errText = '';
                    try { errText = await response.text(); } catch (e) { }
                    if (response.status === 401) {
                        throw new Error('La clave de la API no es válida o ha caducado. Revísala en "Ajustes".');
                    }
                    throw new Error('Error de la API (' + response.status + '). ' + errText.slice(0, 200));
                }
                var data = await response.json();
                var textBlocks = (data.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; });
                var raw = textBlocks.join('\n').trim();
                var cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
                var parsed;
                try { parsed = JSON.parse(cleaned); }
                catch (e) {
                    console.error('extractWithClaude: fallo al parsear JSON. stop_reason=' + data.stop_reason + ', longitud=' + cleaned.length + ', texto crudo:\n' + cleaned);
                    throw new Error('La respuesta no tiene el formato esperado. Prueba a generar el informe de nuevo.');
                }
                return parsed;
            }

            // ---------------- flow ----------------
            async function handleFile(file) {
                if (!file) return;
                if (draftOfertas.length >= MAX_OFERTAS) return;
                if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name || '')) {
                    errorMsg = 'Ese archivo no es un PDF. Sube el PDF original de la oferta.';
                    mode = 'error'; renderMain(); return;
                }
                if (file.size > 15 * 1024 * 1024) {
                    errorMsg = 'El archivo pesa demasiado (máx. ~15MB).';
                    mode = 'error'; renderMain(); return;
                }
                mode = 'loading'; renderMain();
                try {
                    var base64 = await fileToBase64(file);
                    var extracted = await extractWithClaude(base64);
                    extracted.nombreArchivo = file.name;
                    draftOfertas.push(extracted);
                    mode = 'upload';
                    renderMain();
                } catch (err) {
                    console.error(err);
                    errorMsg = (err && err.message) ? err.message : 'No se ha podido leer la oferta.';
                    if (err && err.needsApiKey) { mode = 'settings'; renderMain(); return; }
                    mode = 'error';
                    renderMain();
                }
            }

            function firstNonNullDraft(field) {
                for (var i = 0; i < draftOfertas.length; i++) {
                    if (draftOfertas[i][field]) return draftOfertas[i][field];
                }
                return null;
            }

            async function finalizeRecord() {
                if (draftOfertas.length === 0) return;
                var first = draftOfertas[0];
                var id = 'r' + Date.now();
                var record = {
                    id: id,
                    cliente: first.clienteNombre || '',
                    telefonoCliente: first.clienteTelefono || '',
                    emailCliente: first.clienteEmail || '',
                    comercial: '', telefonoComercial: '', emailComercial: '',
                    fechaGenerado: new Date().toISOString(),
                    tarifaAcceso: firstNonNullDraft('tarifaAcceso'),
                    periodoDescripcion: firstNonNullDraft('periodoDescripcion'),
                    consumoAnualKwh: firstNonNullDraft('consumoAnualKwh'),
                    potenciaContratada: firstNonNullDraft('potenciaContratada'),
                    consumoPeriodo: firstNonNullDraft('consumoPeriodo'),
                    notasInstalacion: firstNonNullDraft('notasInstalacion'),
                    facturaActualEstimada: firstNonNullDraft('facturaActualEstimada'),
                    ofertas: draftOfertas.map(function (o) {
                        return {
                            comercializadora: o.comercializadora,
                            productoTarifa: o.productoTarifa,
                            tarifaAcceso: o.tarifaAcceso,
                            fechaOferta: o.fechaOferta,
                            referenciaOferta: o.referenciaOferta,
                            permanencia: o.permanencia,
                            desglose: o.desglose,
                            totalOferta: o.totalOferta,
                            ahorroImporte: o.ahorroImporte,
                            ahorroPorcentaje: o.ahorroPorcentaje,
                            ahorroAnualEstimado: o.ahorroAnualEstimado,
                            resumenRecomendacion: o.resumenRecomendacion,
                            puntosClave: o.puntosClave,
                            nombreArchivo: o.nombreArchivo
                        };
                    })
                };
                currentRecord = record;
                draftOfertas = [];
                await persistRecord(record);
                mode = 'report-new';
                renderMain();
            }

            // ---------------- render: shell ----------------
            function buildShell() {
                mainEl = document.getElementById('main');
                navNewEl = document.getElementById('nav-new');
                navHistoryEl = document.getElementById('nav-history');
                navSettingsEl = document.getElementById('nav-settings');
                historyCountEl = document.getElementById('history-count');
                settingsBadgeEl = document.getElementById('settings-badge');
                sidebarHintEl = document.getElementById('sidebar-hint');
                brandMarkEl = document.getElementById('brand-mark');
                brandTextEl = document.getElementById('brand-text');
                brandSubEl = document.getElementById('brand-sub');
                navNewEl.addEventListener('click', function () {
                    mode = 'upload'; currentRecord = null; draftOfertas = []; renderMain();
                });
                navHistoryEl.addEventListener('click', async function () {
                    await refreshIndex(); mode = 'history-list'; renderMain();
                });
                navSettingsEl.addEventListener('click', function () {
                    mode = 'settings'; renderMain();
                });
                navSettingsEl.style.display = '';
                if (isStandalone) {
                    if (settingsBadgeEl) settingsBadgeEl.style.display = getApiKey() ? 'none' : '';
                    if (sidebarHintEl) sidebarHintEl.textContent = 'Ejecutándose fuera de Claude (modo standalone). Necesitas tu propia clave de la API de Anthropic — configúrala en "Ajustes".';
                }
            }
            function updateNavActive() {
                var newActive = (mode === 'upload' || mode === 'loading' || mode === 'error' || mode === 'report-new');
                var histActive = (mode === 'history-list' || mode === 'report-detail');
                var settingsActive = (mode === 'settings');
                navNewEl.classList.toggle('active', newActive);
                navHistoryEl.classList.toggle('active', histActive);
                navSettingsEl.classList.toggle('active', settingsActive);
                if (isStandalone && settingsBadgeEl) settingsBadgeEl.style.display = getApiKey() ? 'none' : '';
            }

            // ---------------- render: dispatch ----------------
            function renderMain() {
                if (mode === 'upload') renderUpload();
                else if (mode === 'loading') renderLoading();
                else if (mode === 'error') renderErrorScreen();
                else if (mode === 'report-new' || mode === 'report-detail') renderReport();
                else if (mode === 'history-list') renderHistory();
                else if (mode === 'settings') renderSettings();
                updateNavActive();
            }

            // ---------------- render: settings ----------------
            function renderSettings() {
                var existing = getApiKey();
                var brandPreviewHtml = brandLogo
                    ? '<img src="' + brandLogo + '" alt="" style="display:block; max-width:160px; max-height:70px; margin-bottom:12px; border-radius:8px; border:1px solid var(--line); background:#fff;">'
                    : '';

                var apiKeySectionHtml = isStandalone ?
                    ('<h2 class="section-title">Clave de la API de Anthropic</h2>' +
                        '<p class="page-sub">Esta copia se está ejecutando fuera de Claude (servidor local u otro hosting), así que necesita tu propia clave para poder leer las ofertas. Se guarda solo en este navegador — nunca se escribe en el archivo ni se envía a ningún sitio salvo a la API de Anthropic.</p>' +
                        '<div class="ficha" style="max-width:520px;">' +
                        '<div class="ficha-row">' +
                        '<span class="ficha-label">Estado</span>' +
                        '<span class="ficha-value ' + (existing ? '' : 'missing') + '">' + (existing ? ('Configurada (' + escapeHtml(maskKey(existing)) + ')') : 'Sin configurar') + '</span>' +
                        '</div>' +
                        '</div>' +
                        '<div style="max-width:520px; margin-top:18px;">' +
                        '<input type="password" id="api-key-input" placeholder="sk-ant-…" style="width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:8px; font-family:var(--font-mono); font-size:13px; margin-bottom:10px;" autocomplete="off" spellcheck="false">' +
                        '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
                        '<button class="btn btn-primary btn-sm" id="btn-save-key">Guardar clave</button>' +
                        '<button class="btn btn-ghost btn-sm" id="btn-test-key">Probar conexión</button>' +
                        '<button class="btn btn-danger btn-sm" id="btn-clear-key">Borrar clave</button>' +
                        '</div>' +
                        '<p id="key-test-result" style="font-size:12.5px; margin-top:12px;"></p>' +
                        '</div>' +
                        '<p class="helper-note" style="max-width:520px; margin-top:24px;">' +
                        '¿No tienes clave? Consíguela en <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com/settings/keys</a> (necesita un método de pago; el uso se factura por tokens en tu cuenta de Anthropic, aparte de tu plan de Claude.ai).' +
                        '</p>')
                    : '';

                mainEl.innerHTML =
                    '<p class="eyebrow">Ajustes</p>' +
                    '<h1 class="page-title">Marca</h1>' +
                    '<p class="page-sub">Personaliza el nombre de tu empresa y el logo. Se usan en la barra lateral y en la cabecera del informe que le entregas al cliente.</p>' +

                    '<div style="max-width:520px;">' +
                    '<label style="display:block; font-size:12.5px; font-weight:600; color:var(--muted); margin-bottom:6px;">Nombre de la empresa</label>' +
                    '<input type="text" id="brand-name-input" placeholder="Nombre de tu empresa" value="' + escapeHtml(brandName) + '" style="width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:8px; font-family:var(--font-body); font-size:13px; margin-bottom:10px;">' +
                    '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:26px;">' +
                    '<button class="btn btn-primary btn-sm" id="btn-save-brand-name">Guardar nombre</button>' +
                    '</div>' +

                    '<label style="display:block; font-size:12.5px; font-weight:600; color:var(--muted); margin-bottom:6px;">Logo</label>' +
                    brandPreviewHtml +
                    '<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">' +
                    '<input type="file" id="brand-logo-input" accept="image/png,image/jpeg,image/webp" hidden>' +
                    '<button class="btn btn-ghost btn-sm" id="btn-choose-logo">' + (brandLogo ? 'Cambiar logo' : 'Subir logo') + '</button>' +
                    (brandLogo ? '<button class="btn btn-danger btn-sm" id="btn-remove-logo">Quitar logo</button>' : '') +
                    '</div>' +
                    '<p id="brand-msg" style="font-size:12.5px; margin-top:10px;"></p>' +
                    '<p class="helper-note" style="margin-top:2px;">PNG, JPEG o WEBP. Se redimensiona automáticamente.</p>' +
                    '</div>' +

                    apiKeySectionHtml;

                document.getElementById('btn-save-brand-name').addEventListener('click', async function () {
                    var msgEl = document.getElementById('brand-msg');
                    var nameInput = document.getElementById('brand-name-input');
                    var newName = nameInput.value.trim();
                    var ok = await setStorage(BRAND_NAME_KEY, newName);
                    if (!ok) { msgEl.textContent = 'No se ha podido guardar el nombre.'; msgEl.style.color = 'var(--red)'; return; }
                    brandName = newName;
                    applyBrand();
                    msgEl.textContent = 'Nombre guardado.'; msgEl.style.color = 'var(--teal-dark)';
                });
                document.getElementById('btn-choose-logo').addEventListener('click', function () {
                    document.getElementById('brand-logo-input').click();
                });
                document.getElementById('brand-logo-input').addEventListener('change', async function (e) {
                    var file = e.target.files && e.target.files[0];
                    if (!file) return;
                    var msgEl = document.getElementById('brand-msg');
                    if (['image/png', 'image/jpeg', 'image/webp'].indexOf(file.type) === -1) {
                        msgEl.textContent = 'Formato no soportado. Sube una imagen PNG, JPEG o WEBP.';
                        msgEl.style.color = 'var(--red)';
                        return;
                    }
                    msgEl.textContent = 'Procesando logo…'; msgEl.style.color = 'var(--muted)';
                    try {
                        var dataUrl = await resizeImageToDataUrl(file, BRAND_LOGO_MAX_WIDTH);
                        var ok = await setStorage(BRAND_LOGO_KEY, dataUrl);
                        if (!ok) throw new Error('storage set failed');
                        brandLogo = dataUrl;
                        applyBrand();
                        renderSettings();
                    } catch (err) {
                        console.error(err);
                        msgEl.textContent = 'No se ha podido guardar el logo (puede que se haya superado el espacio disponible).';
                        msgEl.style.color = 'var(--red)';
                    }
                });
                var btnRemoveLogo = document.getElementById('btn-remove-logo');
                if (btnRemoveLogo) btnRemoveLogo.addEventListener('click', async function () {
                    await deleteStorageKey(BRAND_LOGO_KEY);
                    brandLogo = '';
                    applyBrand();
                    renderSettings();
                });

                if (!isStandalone) return;

                var input = document.getElementById('api-key-input');
                if (existing) input.value = existing;

                document.getElementById('btn-save-key').addEventListener('click', function () {
                    setApiKey(input.value.trim());
                    if (sidebarHintEl) sidebarHintEl.textContent = 'Ejecutándose fuera de Claude (modo standalone). Sube el PDF de la oferta cuando quieras.';
                    updateNavActive();
                    renderSettings();
                });
                document.getElementById('btn-clear-key').addEventListener('click', function () {
                    clearApiKey();
                    updateNavActive();
                    renderSettings();
                });
                document.getElementById('btn-test-key').addEventListener('click', async function () {
                    var resultEl = document.getElementById('key-test-result');
                    var keyToTest = input.value.trim();
                    if (!keyToTest) { resultEl.textContent = 'Escribe una clave primero.'; resultEl.style.color = 'var(--red)'; return; }
                    resultEl.textContent = 'Probando…'; resultEl.style.color = 'var(--muted)';
                    try {
                        var resp = await fetch('https://api.anthropic.com/v1/messages', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'x-api-key': keyToTest,
                                'anthropic-version': '2023-06-01',
                                'anthropic-dangerous-direct-browser-access': 'true'
                            },
                            body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 16, messages: [{ role: 'user', content: 'Responde solo "ok".' }] })
                        });
                        if (resp.ok) {
                            resultEl.textContent = '✓ Conexión correcta.'; resultEl.style.color = 'var(--teal-dark)';
                        } else if (resp.status === 401) {
                            resultEl.textContent = '✗ Clave inválida o caducada.'; resultEl.style.color = 'var(--red)';
                        } else {
                            resultEl.textContent = '✗ Error de la API (' + resp.status + ').'; resultEl.style.color = 'var(--red)';
                        }
                    } catch (e) {
                        resultEl.textContent = '✗ No se pudo conectar (revisa tu red).'; resultEl.style.color = 'var(--red)';
                    }
                });
            }


            // ---------------- render: upload ----------------
            function renderUpload() {
                var hasOffers = draftOfertas.length > 0;
                var canAddMore = draftOfertas.length < MAX_OFERTAS;

                var chips = draftOfertas.map(function (o, idx) {
                    return '<div class="offer-chip">' +
                        '<div class="offer-chip-info">' +
                        '<span class="offer-chip-name">' + escapeHtml(o.comercializadora || 'Comercializadora') + (o.productoTarifa ? ' — ' + escapeHtml(o.productoTarifa) : '') + '</span>' +
                        '<span class="offer-chip-meta">' + escapeHtml(o.totalOferta || '—') + (o.ahorroPorcentaje ? ' · ahorro ' + escapeHtml(o.ahorroPorcentaje) : '') + '</span>' +
                        '</div>' +
                        '<button class="btn-chip-remove" data-idx="' + idx + '" title="Quitar oferta">✕</button>' +
                        '</div>';
                }).join('');

                var dropzoneHtml = canAddMore ?
                    '<div class="dropzone' + (hasOffers ? ' dropzone-sm' : '') + '" id="dropzone" tabindex="0">' +
                    '<svg width="' + (hasOffers ? 28 : 40) + '" height="' + (hasOffers ? 28 : 40) + '" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0-12l-4 4m4-4l4 4M5 17v2a2 2 0 002 2h10a2 2 0 002-2v-2" stroke="#0E7C6B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                    '<p class="dropzone-title">' + (hasOffers ? 'Añadir otra oferta (opcional)' : 'Arrastra el PDF aquí') + '</p>' +
                    '<p class="dropzone-sub">' + (hasOffers ? ('Puedes añadir hasta ' + (MAX_OFERTAS - draftOfertas.length) + ' más · o haz clic') : 'o haz clic para elegirlo desde tu ordenador') + '</p>' +
                    (!hasOffers ? '<div class="dropzone-meta">Solo PDF</div>' : '') +
                    '<input type="file" id="file-input" accept="application/pdf" hidden>' +
                    '</div>'
                    : '<p class="helper-note">Máximo ' + MAX_OFERTAS + ' ofertas por informe.</p>';

                mainEl.innerHTML =
                    '<p class="eyebrow">Nuevo informe</p>' +
                    '<h1 class="page-title">' + (hasOffers ? 'Ofertas añadidas' : 'Sube la oferta') + '</h1>' +
                    '<p class="page-sub">' + (hasOffers
                        ? 'Compara hasta ' + MAX_OFERTAS + ' comercializadoras en el mismo informe, para que el cliente vea todas las alternativas de forma imparcial.'
                        : 'Funciona con el PDF de cualquier comercializadora (NIBA, Repsol, o cualquier otra). Puedes comparar hasta ' + MAX_OFERTAS + ' ofertas distintas en un mismo informe.') + '</p>' +
                    (hasOffers ? '<div class="offer-chip-list">' + chips + '</div>' : '') +
                    dropzoneHtml +
                    (hasOffers ? '<div style="margin-top:20px;"><button class="btn btn-primary" id="btn-generate">Generar informe con ' + draftOfertas.length + ' oferta' + (draftOfertas.length > 1 ? 's' : '') + '</button></div>' : '');

                if (canAddMore) {
                    var dz = document.getElementById('dropzone');
                    var input = document.getElementById('file-input');
                    dz.addEventListener('click', function () { input.click(); });
                    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') input.click(); });
                    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag'); });
                    dz.addEventListener('dragleave', function () { dz.classList.remove('drag'); });
                    dz.addEventListener('drop', function (e) {
                        e.preventDefault(); dz.classList.remove('drag');
                        var f = e.dataTransfer.files && e.dataTransfer.files[0];
                        if (f) handleFile(f);
                    });
                    input.addEventListener('change', function (e) {
                        var f = e.target.files && e.target.files[0];
                        if (f) handleFile(f);
                    });
                }
                document.querySelectorAll('.btn-chip-remove').forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        var idx = parseInt(btn.getAttribute('data-idx'), 10);
                        draftOfertas.splice(idx, 1);
                        renderUpload();
                    });
                });
                var btnGen = document.getElementById('btn-generate');
                if (btnGen) btnGen.addEventListener('click', finalizeRecord);
            }

            // ---------------- render: loading ----------------
            function renderLoading() {
                mainEl.innerHTML =
                    '<div class="center-screen">' +
                    '<div class="spinner"></div>' +
                    '<p class="loading-text">Leyendo la oferta…</p>' +
                    '<p class="loading-sub">Esto tarda unos segundos</p>' +
                    '</div>';
            }

            // ---------------- render: error ----------------
            function renderErrorScreen() {
                var settingsBtn = isStandalone ? '<button class="btn btn-ghost btn-sm" id="btn-goto-settings">Ir a Ajustes</button>' : '';
                mainEl.innerHTML =
                    '<div class="center-screen">' +
                    '<div class="error-box">' +
                    '<p class="error-title">No se ha podido generar el informe</p>' +
                    '<p class="error-msg">' + escapeHtml(errorMsg) + '</p>' +
                    '<div style="display:flex; gap:8px;"><button class="btn btn-primary btn-sm" id="btn-retry">Volver a intentar</button>' + settingsBtn + '</div>' +
                    '</div>' +
                    '</div>';
                document.getElementById('btn-retry').addEventListener('click', function () {
                    mode = 'upload'; renderMain();
                });
                var gs = document.getElementById('btn-goto-settings');
                if (gs) gs.addEventListener('click', function () { mode = 'settings'; renderMain(); });
            }

            // ---------------- render: report ----------------
            function editableRow(label, field, placeholder) {
                var value = currentRecord[field] || '';
                return '<div class="ficha-row' + (value ? '' : ' ficha-row-empty') + '">' +
                    '<span class="ficha-label">' + label + '</span>' +
                    '<span class="ficha-value">' +
                    '<input class="field-edit" type="text" data-field="' + field + '" value="' + escapeHtml(value) + '" placeholder="' + escapeHtml(placeholder) + '">' +
                    '<span class="field-print">' + (value ? escapeHtml(value) : '') + '</span>' +
                    '</span>' +
                    '</div>';
            }
            function extractedRow(label, value) {
                var missing = !value;
                return '<div class="ficha-row"><span class="ficha-label">' + label + '</span>' +
                    '<span class="ficha-value ' + (missing ? 'missing' : '') + '">' +
                    (missing ? 'No especificado en el documento' : escapeHtml(value)) + '</span></div>';
            }
            function infoRow(label, value) {
                var missing = !value;
                return '<div class="ficha-row"><span class="ficha-label">' + label + '</span>' +
                    '<span class="ficha-value ' + (missing ? 'missing-info' : '') + '">' +
                    (missing ? 'No indicado en la oferta' : escapeHtml(value)) + '</span></div>';
            }

            function renderReport() {
                var r = currentRecord;
                // compat: informes antiguos guardaban una sola oferta a nivel plano del record
                var ofertas = (Array.isArray(r.ofertas) && r.ofertas.length) ? r.ofertas : [{
                    comercializadora: r.comercializadora, productoTarifa: r.productoTarifa,
                    tarifaAcceso: r.tarifaAcceso, fechaOferta: r.fechaOferta, referenciaOferta: r.referenciaOferta,
                    permanencia: r.permanencia, desglose: r.desglose, totalOferta: r.totalOferta,
                    ahorroImporte: r.ahorroImporte, ahorroPorcentaje: r.ahorroPorcentaje,
                    ahorroAnualEstimado: r.ahorroAnualEstimado, resumenRecomendacion: r.resumenRecomendacion,
                    puntosClave: r.puntosClave, nombreArchivo: r.nombreArchivo
                }];
                var multi = ofertas.length > 1;
                if (multi) {
                    // ordenadas de mayor a menor ahorro para que el badge "mayor ahorro",
                    // el orden de las tarjetas y el orden de las recomendaciones coincidan
                    // siempre — evita que el cliente vea una oferta destacada y otra distinta
                    // encabezando la recomendación.
                    ofertas = ofertas.slice().sort(function (a, b) {
                        var pa = parsePercent(a.ahorroPorcentaje);
                        var pb = parsePercent(b.ahorroPorcentaje);
                        if (pa === null && pb === null) return 0;
                        if (pa === null) return 1;
                        if (pb === null) return -1;
                        return pb - pa;
                    });
                }
                var recommendedOffer = ofertas[0] || {};
                var recommendedName = recommendedOffer.comercializadora || 'la oferta recomendada';
                var advisorVerdict = multi
                    ? 'Recomendamos valorar ' + escapeHtml(recommendedName) + ' como primera opci&oacute;n por ser la alternativa con mayor ahorro estimado dentro de las ofertas analizadas.'
                    : 'La propuesta analizada presenta una oportunidad de ahorro frente a tu situaci&oacute;n actual, siempre que las condiciones contractuales se confirmen antes de firmar.';
                var advisorSaving = recommendedOffer.ahorroImporte
                    ? escapeHtml(recommendedOffer.ahorroImporte) + (recommendedOffer.ahorroPorcentaje ? ' (' + escapeHtml(recommendedOffer.ahorroPorcentaje) + ')' : '')
                    : (recommendedOffer.ahorroPorcentaje ? escapeHtml(recommendedOffer.ahorroPorcentaje) : 'Pendiente de confirmar');
                var advisorAnnual = recommendedOffer.ahorroAnualEstimado || 'No indicado';
                var advisorTariff = firstValue([recommendedOffer.productoTarifa, recommendedOffer.tarifaAcceso, r.tarifaAcceso], 'Oferta analizada');

                var title = multi
                    ? 'Informe de asesor&iacute;a energ&eacute;tica'
                    : ('Informe de asesor&iacute;a energ&eacute;tica: ' + escapeHtml(ofertas[0].comercializadora || 'Comercializadora') +
                        (ofertas[0].productoTarifa ? ' — ' + escapeHtml(ofertas[0].productoTarifa) : ''));
                var subtitleParts = [];
                if (r.tarifaAcceso) subtitleParts.push('Tarifa de acceso ' + escapeHtml(r.tarifaAcceso));
                if (!multi && ofertas[0].fechaOferta) subtitleParts.push('Oferta del ' + escapeHtml(ofertas[0].fechaOferta));
                var subtitle = subtitleParts.join(' · ') || 'Simulación basada en el consumo real del cliente';
                var comparingLine = multi ? ofertas.map(function (o) {
                    return escapeHtml(o.comercializadora || 'Comercializadora') + (o.productoTarifa ? ' (' + escapeHtml(o.productoTarifa) + ')' : '');
                }).join(' · ') : '';

                var advisorSummaryHtml =
                    '<section class="advisor-summary">' +
                    '<div class="advisor-verdict">' +
                    '<p class="advisor-eyebrow">Dictamen del asesor</p>' +
                    '<h2>' + escapeHtml(recommendedName) + '</h2>' +
                    '<p>' + advisorVerdict + '</p>' +
                    '</div>' +
                    '<div class="advisor-metrics">' +
                    '<div class="advisor-metric"><span>Ahorro estimado</span><strong>' + advisorSaving + '</strong></div>' +
                    '<div class="advisor-metric"><span>Ahorro anual</span><strong>' + escapeHtml(advisorAnnual) + '</strong></div>' +
                    '<div class="advisor-metric"><span>Producto / tarifa</span><strong>' + escapeHtml(advisorTariff) + '</strong></div>' +
                    '</div>' +
                    '<div class="advisor-rationale">' +
                    '<p><strong>Criterio aplicado:</strong> comparaci&oacute;n del coste del periodo analizado frente a la factura actual, revisando t&eacute;rmino de energ&iacute;a, potencia, servicios, impuestos y coste final.</p>' +
                    '<p><strong>Antes de contratar:</strong> confirmar permanencia, servicios incluidos, vigencia de precios, IVA aplicado y condiciones de renovaci&oacute;n.</p>' +
                    '</div>' +
                    '</section>';

                // ---- intro de factura actual (una sola vez, no repetida por tarjeta) ----
                var facturaIntroHtml = (multi && r.facturaActualEstimada)
                    ? '<p class="section-intro">Tu factura actual de referencia es de <strong>' + escapeHtml(r.facturaActualEstimada) + '</strong>' +
                        (r.periodoDescripcion ? ' en un periodo de ' + escapeHtml(r.periodoDescripcion) : '') +
                        '. Así queda cada alternativa frente a ese importe:</p>'
                    : '';

                // ---- tarjetas de ahorro (una por oferta, color de acento por posición) ----
                var bestIdx = -1, bestPct = null;
                ofertas.forEach(function (o, i) {
                    var p = parsePercent(o.ahorroPorcentaje);
                    if (p !== null && (bestPct === null || p > bestPct)) { bestPct = p; bestIdx = i; }
                });
                var savingsCardsHtml = ofertas.map(function (o, i) {
                    var pct = parsePercent(o.ahorroPorcentaje);
                    var isBest = multi && i === bestIdx;
                    var accentClass = multi ? ' offer-accent-' + (i + 1) : '';
                    var subParts = [];
                    if (!multi && r.facturaActualEstimada) subParts.push('Factura actual: ' + escapeHtml(r.facturaActualEstimada));
                    subParts.push('Oferta: ' + escapeHtml(o.totalOferta || '—'));
                    if (o.ahorroAnualEstimado) subParts.push('Ahorro anual estimado: ' + escapeHtml(o.ahorroAnualEstimado));
                    return '<div class="savings-card' + accentClass + (isBest ? ' savings-card-best' : '') + '">' +
                        gaugeSVG(pct) +
                        '<div class="savings-copy">' +
                        (multi ? '<p class="savings-crm">' + escapeHtml(o.comercializadora || 'Comercializadora') + (isBest ? '<span class="best-tag">Mayor ahorro</span>' : '') + '</p>' : '') +
                        '<p class="savings-main">' + (o.ahorroImporte ? 'Ahorras ' + escapeHtml(o.ahorroImporte) : 'Ahorro estimado') + (o.ahorroPorcentaje ? ' (' + escapeHtml(o.ahorroPorcentaje) + ')' : '') + '</p>' +
                        '<p class="savings-sub">' + subParts.join(' · ') + '</p>' +
                        '</div>' +
                        '</div>';
                }).join('');

                // ---- desglose por oferta (bloque con borde de acento a juego con la tarjeta) ----
                var desgloseHtml = ofertas.map(function (o, i) {
                    var rows = (Array.isArray(o.desglose) ? o.desglose : []).map(function (row) {
                        return '<tr><td>' + escapeHtml(row.concepto) + '</td><td class="num">' + escapeHtml(row.importe) + '</td></tr>';
                    }).join('');
                    var heading = multi
                        ? '<h3 class="subsection-title">2.' + (i + 1) + ' · ' + escapeHtml(o.comercializadora || 'Oferta') + (o.productoTarifa ? ' — ' + escapeHtml(o.productoTarifa) : '') + '</h3>'
                        : '<p class="section-intro" style="margin-top:2px;">Desglose del importe ofertado:</p>';
                    var accentClass = multi ? ' offer-accent-' + (i + 1) : '';
                    return '<div class="offer-block' + accentClass + '">' + heading + '<table class="data-table">' + rows +
                        '<tr class="total"><td class="label">TOTAL OFERTA</td><td class="num">' + escapeHtml(o.totalOferta || '—') + '</td></tr></table></div>';
                }).join('');

                // ---- recomendación (fichas comparables cuando hay varias ofertas) ----
                var recomendacionHtml;
                if (multi) {
                    var alternativeHtml = ofertas.slice(1).map(function (o) {
                        return '<li><strong>' + escapeHtml(o.comercializadora || 'Oferta') + ':</strong> ' +
                            (o.ahorroImporte ? 'ahorro estimado de ' + escapeHtml(o.ahorroImporte) : 'alternativa analizada') +
                            (o.ahorroPorcentaje ? ' (' + escapeHtml(o.ahorroPorcentaje) + ')' : '') +
                            (o.totalOferta ? ', con total ofertado de ' + escapeHtml(o.totalOferta) : '') +
                            '.</li>';
                    }).join('');
                    recomendacionHtml = '<div class="professional-recommendation">' +
                        '<p class="offer-recommendation-name">Recomendaci&oacute;n profesional</p>' +
                        '<p class="section-intro">' + advisorVerdict + ' El ahorro estimado es de <strong>' + advisorSaving + '</strong>' +
                        (recommendedOffer.totalOferta ? ' con un coste ofertado de <strong>' + escapeHtml(recommendedOffer.totalOferta) + '</strong>' : '') +
                        '. Es la opci&oacute;n que mejor equilibra coste previsto y simplicidad de cambio con los datos disponibles.</p>' +
                        (recommendedOffer.resumenRecomendacion ? '<p class="section-intro">' + escapeHtml(recommendedOffer.resumenRecomendacion) + '</p>' : '') +
                        '</div>' +
                        (alternativeHtml ? '<div class="alternatives-note"><p class="offer-recommendation-name">Lectura de alternativas</p><ul>' + alternativeHtml + '</ul></div>' : '') +
                        ofertas.map(function (o, i) {
                        var puntos = Array.isArray(o.puntosClave) ? o.puntosClave : [];
                        var puntosLi = puntos.map(function (p) { return '<li>' + escapeHtml(p) + '</li>'; }).join('');
                        return '<div class="offer-recommendation offer-accent-' + (i + 1) + '">' +
                            '<p class="offer-recommendation-name">' + (i === 0 ? 'Opci&oacute;n recomendada · ' : '') + escapeHtml(o.comercializadora || 'Comercializadora') + '</p>' +
                            (o.resumenRecomendacion ? '<p class="section-intro">' + escapeHtml(o.resumenRecomendacion) + '</p>' : '') +
                            (puntosLi ? '<ul class="key-points">' + puntosLi + '</ul>' : '') +
                            '</div>';
                    }).join('') +
                        '<p class="section-intro">La recomendaci&oacute;n se formula con criterio econ&oacute;mico y operativo. La decisi&oacute;n final debe tomarse tras validar las condiciones contractuales definitivas de la comercializadora elegida.</p>';
                } else {
                    var puntos = Array.isArray(ofertas[0].puntosClave) ? ofertas[0].puntosClave : [];
                    var puntosLi = puntos.map(function (p) { return '<li>' + escapeHtml(p) + '</li>'; }).join('');
                    recomendacionHtml = '<p class="section-intro">' + escapeHtml(ofertas[0].resumenRecomendacion || '') + '</p>' +
                        (puntosLi ? '<ul class="key-points">' + puntosLi + '</ul>' : '');
                }

                var fuentes = ofertas.map(function (o) { return o.nombreArchivo; }).filter(Boolean).join(' · ');

                var brandHeaderHtml = (brandName || brandLogo)
                    ? '<div class="report-brand-header">' +
                        (brandLogo ? '<img src="' + brandLogo + '" alt="" class="report-brand-logo">' : '') +
                        (brandName ? '<span class="report-brand-name">' + escapeHtml(brandName) + '</span>' : '') +
                        '</div>'
                    : '';

                var backBtn = (mode === 'report-detail')
                    ? '<button class="btn btn-ghost btn-sm" id="btn-back-history">‹ Volver al historial</button>'
                    : '';

                mainEl.innerHTML =
                    '<div class="report-toolbar no-print">' +
                    '<div class="toolbar-left">' + backBtn +
                    '<span class="autosave-note">' + (storageAvailable ? 'Los cambios se guardan automáticamente' : 'Histórico no disponible en este entorno') + '</span>' +
                    '</div>' +
                    '<div class="toolbar-left">' +
                    '<button class="btn btn-danger btn-sm" id="btn-delete">Eliminar</button>' +
                    '<button class="btn btn-ghost btn-sm" id="btn-print" title="Vista previa en pantalla — no es el documento final">Vista previa (imprimir)</button>' +
                    '<button class="btn btn-primary btn-sm" id="btn-download-pdf">Descargar informe para el cliente</button>' +
                    '</div>' +
                    '</div>' +
                    '<div class="report-printable" id="report-printable">' +
                    brandHeaderHtml +
                    '<p class="report-kicker">Informe profesional · Asesor&iacute;a energ&eacute;tica</p>' +
                    '<h1 class="report-title">' + title + '</h1>' +
                    '<p class="report-subtitle">' + subtitle + '</p>' +
                    (multi ? '<p class="report-subtitle" style="margin-top:-16px;">Comparando: ' + comparingLine + '</p>' : '') +

                    '<div class="ficha ficha-client">' +
                    editableRow('Cliente', 'cliente', '[Nombre del cliente]') +
                    editableRow('Contacto cliente', 'telefonoCliente', '[Teléfono cliente]') +
                    editableRow('Email cliente', 'emailCliente', '[Email cliente]') +
                    editableRow('Comercial asignado', 'comercial', '[Nombre comercial]') +
                    editableRow('Contacto comercial', 'telefonoComercial', '[Teléfono comercial] · [Email comercial]') +
                    (multi ? '' :
                        extractedRow('Comercializadora', ofertas[0].comercializadora) +
                        extractedRow('Producto / tarifa', ofertas[0].productoTarifa) +
                        extractedRow('Permanencia', ofertas[0].permanencia) +
                        extractedRow('Referencia de la oferta', ofertas[0].referenciaOferta)) +
                    '</div>' +
                    '<p class="helper-note no-print">En rojo, los campos que no vienen en el documento de oferta o que puedes completar tú.</p>' +

                    advisorSummaryHtml +

                    '<h2 class="section-title">1 · Diagn&oacute;stico de partida</h2>' +
                    '<div class="ficha">' +
                    infoRow('Tarifa de acceso', r.tarifaAcceso) +
                    infoRow('Periodo analizado', r.periodoDescripcion) +
                    infoRow('Consumo anual', r.consumoAnualKwh) +
                    infoRow('Potencia contratada', r.potenciaContratada) +
                    infoRow('Consumo del periodo', r.consumoPeriodo) +
                    infoRow('Instalación', r.notasInstalacion) +
                    infoRow('Coste estimado factura actual', r.facturaActualEstimada) +
                    '</div>' +

                    '<h2 class="section-title">' + (multi ? '2 · An&aacute;lisis de propuestas' : '2 · An&aacute;lisis de la propuesta') + '</h2>' +
                    facturaIntroHtml +

                    '<div class="savings-cards-row">' + savingsCardsHtml + '</div>' +

                    desgloseHtml +

                    '<h2 class="section-title">3 · Recomendaci&oacute;n y condiciones</h2>' +
                    recomendacionHtml +
                    '<div class="cta-box">' +
                    '<p class="cta-title">Siguiente paso recomendado</p>' +
                    '<p class="cta-line">Validamos contigo las condiciones finales de la oferta elegida y dejamos constancia de permanencia, servicios incluidos e impuestos aplicados.</p>' +
                    '<p class="cta-line">Si confirmas el cambio, coordinamos la gesti&oacute;n sin cortes de suministro ni papeleo innecesario por tu parte.</p>' +
                    '</div>' +

                    '<p class="disclaimer">Informe generado automáticamente a partir de los documentos de oferta subidos. Verifica los importes con los documentos originales antes de presentarlo al cliente. Los precios quedan sujetos a las condiciones contractuales de cada comercializadora.</p>' +
                    '<p class="meta-note">Fuente: ' + escapeHtml(fuentes || '—') + ' · generado el ' + formatDateTime(r.fechaGenerado) + '</p>' +
                    '</div>';

                // handlers
                document.querySelectorAll('.field-edit').forEach(function (input) {
                    input.addEventListener('input', function (e) {
                        var field = e.target.dataset.field;
                        currentRecord[field] = e.target.value;
                        var printSpan = e.target.parentElement.querySelector('.field-print');
                        if (printSpan) printSpan.textContent = e.target.value || '';
                        var row = e.target.closest('.ficha-row');
                        if (row) row.classList.toggle('ficha-row-empty', !e.target.value);
                        scheduleSave();
                    });
                });
                var btnPrint = document.getElementById('btn-print');
                if (btnPrint) btnPrint.addEventListener('click', function () { window.print(); });
                var btnDownloadPdf = document.getElementById('btn-download-pdf');
                if (btnDownloadPdf) btnDownloadPdf.addEventListener('click', function () {
                    if (window.PdfExport && window.PdfExport.download) {
                        try {
                            window.PdfExport.download(currentRecord, { name: brandName, logo: brandLogo });
                        } catch (err) {
                            console.error(err);
                            alert('No se ha podido generar el PDF. Inténtalo de nuevo.');
                        }
                    } else {
                        alert('No se ha podido cargar el generador de PDF. Recarga la página e inténtalo de nuevo.');
                    }
                });
                var btnDelete = document.getElementById('btn-delete');
                if (btnDelete) btnDelete.addEventListener('click', async function () {
                    if (!confirm('¿Eliminar este informe del historial? No se puede deshacer.')) return;
                    await deleteStorageKey('informe-detalle:' + currentRecord.id);
                    indexCache = indexCache.filter(function (x) { return x.id !== currentRecord.id; });
                    await setStorage('informes-index', JSON.stringify(indexCache));
                    if (historyCountEl) historyCountEl.textContent = String(indexCache.length);
                    currentRecord = null; mode = 'history-list'; renderMain();
                });
                var btnBack = document.getElementById('btn-back-history');
                if (btnBack) btnBack.addEventListener('click', function () { mode = 'history-list'; renderMain(); });
            }

            // ---------------- render: history ----------------
            function renderHistory() {
                if (!storageAvailable) {
                    mainEl.innerHTML =
                        '<p class="eyebrow">Historial</p><h1 class="page-title">No disponible</h1>' +
                        '<p class="page-sub">El histórico persistente no está disponible en este entorno de vista previa.</p>';
                    return;
                }
                if (indexCache.length === 0) {
                    mainEl.innerHTML =
                        '<p class="eyebrow">Historial</p><h1 class="page-title">Todavía no hay informes</h1>' +
                        '<div class="empty-state"><p>Los informes que generes aparecerán aquí.</p>' +
                        '<button class="btn btn-primary" id="btn-empty-new">Crear el primer informe</button></div>';
                    document.getElementById('btn-empty-new').addEventListener('click', function () { mode = 'upload'; renderMain(); });
                    return;
                }
                var sorted = indexCache.slice().sort(function (a, b) { return new Date(b.fechaGenerado) - new Date(a.fechaGenerado); });
                var cards = sorted.map(function (item) {
                    var pct = parsePercent(item.ahorroPorcentaje);
                    return '<div class="history-card" data-id="' + item.id + '">' +
                        gaugeSVG(pct) +
                        '<div class="history-info">' +
                        '<div class="history-top">' +
                        '<span class="history-crm">' + escapeHtml(item.comercializadora || 'Comercializadora') + (item.productoTarifa ? ' — ' + escapeHtml(item.productoTarifa) : '') + '</span>' +
                        '<span class="history-client">' + (item.cliente ? escapeHtml(item.cliente) : 'Sin nombre de cliente') + '</span>' +
                        '</div>' +
                        '<div class="history-meta">' + formatDateTime(item.fechaGenerado) + '</div>' +
                        '</div>' +
                        '<div class="history-amount">' + escapeHtml(item.totalOferta || '') + '</div>' +
                        '</div>';
                }).join('');

                mainEl.innerHTML =
                    '<p class="eyebrow">Historial</p>' +
                    '<h1 class="page-title">Informes generados</h1>' +
                    '<p class="page-sub">Haz clic en un informe para reabrirlo, editarlo o exportarlo de nuevo.</p>' +
                    '<div class="history-grid">' + cards + '</div>';

                document.querySelectorAll('.history-card').forEach(function (card) {
                    card.addEventListener('click', async function () {
                        var id = card.getAttribute('data-id');
                        var raw = await getStorage('informe-detalle:' + id);
                        if (!raw) { alert('No se ha podido cargar este informe.'); return; }
                        try { currentRecord = JSON.parse(raw); } catch (e) { alert('Este informe está dañado.'); return; }
                        mode = 'report-detail'; renderMain();
                    });
                });
            }

            // ---------------- init ----------------
            document.addEventListener('DOMContentLoaded', async function () {
                buildShell();
                await loadBrand();
                applyBrand();
                await refreshIndex();
                renderMain();
            });
        })();
