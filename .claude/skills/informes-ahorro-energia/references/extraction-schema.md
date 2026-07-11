# Esquema de extracción (fuente única de verdad)

Este esquema se usa tanto para generar el `.docx` como dentro de la app interactiva
(`assets/app-template.html`). Si se cambia uno, hay que mantener el otro alineado.

Al leer el PDF de una oferta (de cualquier comercializadora/CRM), extrae estos campos.
**Nunca inventes ni asumas un valor que no esté en el documento: usa `null` / "No
especificado en el documento".** Si el ahorro en euros y el total de la oferta están
pero no la factura actual, calcúlala sumando ambos y dilo explícitamente como estimado.

```
comercializadora       string
productoTarifa         string | null   (nombre comercial de la tarifa, si lo da)
tarifaAcceso           string | null   (p.ej. "2.0TD")
fechaOferta            string | null
referenciaOferta       string | null   (nº de oferta / factura / estudio)
periodoDescripcion     string | null   (días o fechas del periodo analizado)
consumoAnualKwh        string | null
potenciaContratada     string | null
consumoPeriodo         string | null
notasInstalacion       string | null   (autoconsumo solar, excedentes, etc.)
desglose               [ { concepto, importe } ]   (líneas del desglose económico, en orden)
totalOferta            string
facturaActualEstimada  string | null   (derivado si hace falta: total + ahorro €)
ahorroImporte          string | null
ahorroPorcentaje       string | null
ahorroAnualEstimado    string | null
permanencia            string | null
clienteNombre          string | null
clienteTelefono        string | null
clienteEmail           string | null
resumenRecomendacion   string          (2-3 frases, tono cercano, sin tecnicismos)
puntosClave            [string]        (3-5 puntos, <15 palabras cada uno)
```

Campos que casi nunca vienen en la oferta del CRM y que el humano debe rellenar a mano
(en la app quedan como inputs editables; en el Word, como fila en rojo dentro de la
ficha): `clienteNombre`, `clienteTelefono`, `clienteEmail`, comercial asignado (nombre/
teléfono/email — no forma parte del PDF, es dato interno de la asesoría), `permanencia`
(muy pocas ofertas la indican).

Importes siempre en formato `"12,34 €"` (coma decimal, símbolo €).
