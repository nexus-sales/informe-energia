const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, AlignmentType, HeadingLevel,
  ImageRun, PageBreak, VerticalAlign, Header, Footer, PageNumber,
} = require("docx");

// ---------- palette ----------
const NAVY = "1B2A41";
const NAVY_DARK = "10192A";
const TEAL = "0E6E5C";
const GREEN = "1E7A3D";
const GREEN_BG = "E7F4EA";
const GRAY_TEXT = "5B6472";
const LIGHT_BG = "F4F6F8";
const LINE = "D9DEE4";
const WHITE = "FFFFFF";
const RED_SOFT = "B23B3B";

const FONT = "Calibri";

// ---------- helpers ----------
function kicker(text) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({ text: text.toUpperCase(), bold: true, color: TEAL, font: FONT, size: 18, characterSpacing: 20 }),
    ],
  });
}

function h1(text) {
  return new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text, bold: true, color: NAVY_DARK, font: FONT, size: 40 })],
  });
}

function h2(text) {
  return new Paragraph({
    spacing: { before: 320, after: 160 },
    border: { bottom: { color: LINE, space: 4, style: BorderStyle.SINGLE, size: 6 } },
    children: [new TextRun({ text, bold: true, color: NAVY, font: FONT, size: 26 })],
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 120 },
    children: [new TextRun({ text, font: FONT, size: opts.size ?? 21, color: opts.color ?? "2B2B2B", italics: opts.italics, bold: opts.bold })],
  });
}

function bullet(text) {
  return new Paragraph({
    spacing: { after: 80 },
    indent: { left: 260 },
    children: [
      new TextRun({ text: "—  ", bold: true, color: TEAL, font: FONT, size: 21 }),
      new TextRun({ text, font: FONT, size: 21, color: "2B2B2B" }),
    ],
  });
}

function noBorders() {
  return {
    top: { style: BorderStyle.NONE, size: 0, color: WHITE },
    bottom: { style: BorderStyle.NONE, size: 0, color: WHITE },
    left: { style: BorderStyle.NONE, size: 0, color: WHITE },
    right: { style: BorderStyle.NONE, size: 0, color: WHITE },
  };
}

function cell(text, { bold = false, color = "2B2B2B", shade = null, align = AlignmentType.LEFT, size = 20, width } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: shade ? { type: ShadingType.CLEAR, color: "auto", fill: shade } : undefined,
    margins: { top: 90, bottom: 90, left: 140, right: 140 },
    verticalAlign: VerticalAlign.CENTER,
    borders: noBorders(),
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text, bold, color, font: FONT, size })],
    })],
  });
}

function infoTable(rows) {
  // rows: [label, value]
  const colA = 3000, colB = 6300;
  return new Table({
    width: { size: colA + colB, type: WidthType.DXA },
    columnWidths: [colA, colB],
    rows: rows.map((r, i) => new TableRow({
      children: [
        cell(r[0], { bold: true, color: GRAY_TEXT, shade: i % 2 === 0 ? LIGHT_BG : WHITE, width: colA }),
        cell(r[1], { bold: true, color: NAVY_DARK, shade: i % 2 === 0 ? LIGHT_BG : WHITE, width: colB }),
      ],
    })),
  });
}

function fichaTable(rows) {
  // rows: [label, value, isEditable]
  const colA = 3000, colB = 6300;
  return new Table({
    width: { size: colA + colB, type: WidthType.DXA },
    columnWidths: [colA, colB],
    rows: rows.map((r, i) => new TableRow({
      children: [
        cell(r[0], { bold: true, color: GRAY_TEXT, shade: i % 2 === 0 ? LIGHT_BG : WHITE, width: colA }),
        cell(r[1], { bold: true, color: r[2] ? RED_SOFT : NAVY_DARK, shade: i % 2 === 0 ? LIGHT_BG : WHITE, width: colB }),
      ],
    })),
  });
}

function compareTable(header, rows) {
  // header: [c1,c2,c3,c4]; rows: array of arrays of 4 strings, last row highlighted
  const widths = [3400, 2050, 2050, 1800];
  const headerRow = new TableRow({
    tableHeader: true,
    children: header.map((h, i) => cell(h, { bold: true, color: WHITE, shade: NAVY, width: widths[i], align: i === 0 ? AlignmentType.LEFT : AlignmentType.CENTER })),
  });
  const bodyRows = rows.map((r, idx) => {
    const isTotal = idx === rows.length - 1;
    return new TableRow({
      children: r.map((val, i) => cell(val, {
        bold: isTotal,
        color: isTotal ? NAVY_DARK : "2B2B2B",
        shade: isTotal ? GREEN_BG : (idx % 2 === 0 ? LIGHT_BG : WHITE),
        width: widths[i],
        align: i === 0 ? AlignmentType.LEFT : AlignmentType.CENTER,
        size: isTotal ? 21 : 20,
      })),
    });
  });
  return new Table({ width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths, rows: [headerRow, ...bodyRows] });
}

function breakdownTable(rows, totalLabel, totalValue) {
  const widths = [6300, 3000];
  const bodyRows = rows.map((r, idx) => new TableRow({
    children: [
      cell(r[0], { color: "2B2B2B", shade: idx % 2 === 0 ? LIGHT_BG : WHITE, width: widths[0] }),
      cell(r[1], { color: "2B2B2B", shade: idx % 2 === 0 ? LIGHT_BG : WHITE, width: widths[1], align: AlignmentType.RIGHT }),
    ],
  }));
  bodyRows.push(new TableRow({
    children: [
      cell(totalLabel, { bold: true, color: WHITE, shade: NAVY, width: widths[0] }),
      cell(totalValue, { bold: true, color: WHITE, shade: NAVY, width: widths[1], align: AlignmentType.RIGHT }),
    ],
  }));
  return new Table({ width: { size: widths[0] + widths[1], type: WidthType.DXA }, columnWidths: widths, rows: bodyRows });
}

function savingsCallout(mainText, subText) {
  const widths = [9300];
  return new Table({
    width: { size: widths[0], type: WidthType.DXA },
    columnWidths: widths,
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: widths[0], type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, color: "auto", fill: GREEN_BG },
        margins: { top: 220, bottom: 220, left: 260, right: 260 },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 4, color: GREEN },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: GREEN },
          left: { style: BorderStyle.SINGLE, size: 24, color: GREEN },
          right: { style: BorderStyle.SINGLE, size: 4, color: GREEN },
        },
        children: [
          new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: mainText, bold: true, color: GREEN, font: FONT, size: 30 })] }),
          new Paragraph({ children: [new TextRun({ text: subText, color: NAVY_DARK, font: FONT, size: 20 })] }),
        ],
      })],
    })],
  });
}

function ctaBox(title, lines) {
  const widths = [9300];
  return new Table({
    width: { size: widths[0], type: WidthType.DXA },
    columnWidths: widths,
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: widths[0], type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, color: "auto", fill: NAVY },
        margins: { top: 240, bottom: 240, left: 280, right: 280 },
        borders: noBorders(),
        children: [
          new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: title, bold: true, color: WHITE, font: FONT, size: 26 })] }),
          ...lines.map(l => new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: l, color: "DCE4EC", font: FONT, size: 20 })] })),
        ],
      })],
    })],
  });
}

function imageParagraph(path, widthPx, alignment = AlignmentType.CENTER) {
  const data = fs.readFileSync(path);
  const sizeOf = require("image-size");
  const dim = sizeOf(path);
  const h = Math.round(widthPx * (dim.height / dim.width));
  return new Paragraph({
    alignment,
    spacing: { after: 160 },
    children: [new ImageRun({ type: "jpg", data, transformation: { width: widthPx, height: h } })],
  });
}

function caption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text, italics: true, color: GRAY_TEXT, font: FONT, size: 18 })],
  });
}

function disclaimer(text) {
  return new Paragraph({
    spacing: { before: 260 },
    border: { top: { color: LINE, space: 6, style: BorderStyle.SINGLE, size: 4 } },
    children: [new TextRun({ text, italics: true, color: GRAY_TEXT, font: FONT, size: 16 })],
  });
}

function footerBrand() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "Informe elaborado por tu asesoría energética · Página ", color: GRAY_TEXT, font: FONT, size: 16 }),
        new TextRun({ children: [PageNumber.CURRENT], color: GRAY_TEXT, font: FONT, size: 16 }),
      ],
    })],
  });
}

// ---------- build one report ----------
function buildReport(cfg) {
  const children = [];

  children.push(kicker("Informe ejecutivo · Propuesta de cambio de comercializadora"));
  children.push(h1(cfg.title));
  children.push(body(cfg.subtitle, { color: GRAY_TEXT, size: 21, after: 200 }));

  // Ficha del informe
  children.push(fichaTable(cfg.fichaRows));
  children.push(body("En rojo, los campos que no vienen en el documento de oferta: complétalos antes de enviar el informe.", { italics: true, color: GRAY_TEXT, size: 17, after: 220 }));

  // Section 1
  children.push(h2("1 · Tu situación actual"));
  children.push(body(cfg.section1Intro, { after: 160 }));
  children.push(infoTable(cfg.currentInfoRows));

  // Section 2
  children.push(h2(`2 · La propuesta: ${cfg.offerName}`));
  children.push(body(cfg.section2Intro, { after: 160 }));
  children.push(imageParagraph(cfg.bannerImage, 470));
  children.push(caption(cfg.bannerCaption));

  children.push(body("Comparativa económica del periodo analizado:", { bold: true, after: 100 }));
  children.push(compareTable(["Concepto", "Factura actual", cfg.offerShortName, "Diferencia"], cfg.compareRows));
  children.push(new Paragraph({ spacing: { before: 200, after: 200 }, children: [] }));
  children.push(savingsCallout(cfg.savingsMain, cfg.savingsSub));

  children.push(body("Desglose del importe ofertado:", { bold: true, size: 21, after: 100 }));
  children.push(breakdownTable(cfg.breakdownRows, cfg.breakdownTotalLabel, cfg.breakdownTotalValue));

  if (cfg.section2Note) {
    children.push(body(cfg.section2Note, { after: 120, italics: true, color: GRAY_TEXT, size: 19 }));
  }

  // Section 3
  children.push(h2("3 · Nuestra recomendación"));
  cfg.recommendationParas.forEach(p => children.push(body(p, { after: 120 })));
  cfg.recommendationBullets.forEach(b => children.push(bullet(b)));
  children.push(new Paragraph({ spacing: { before: 200 }, children: [] }));
  children.push(ctaBox(cfg.ctaTitle, cfg.ctaLines(cfg)));

  children.push(disclaimer(cfg.disclaimerText));

  // Appendix page
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(kicker("Anexo"));
  children.push(h1(`Documento original de la oferta — ${cfg.offerName}`));
  children.push(body(cfg.appendixIntro, { after: 200 }));
  children.push(imageParagraph(cfg.fullImage, 500));
  children.push(caption(cfg.appendixCaption));

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 900, bottom: 900, left: 900, right: 900 },
        },
      },
      footers: { default: footerBrand() },
      children,
    }],
    styles: {
      default: {
        document: { run: { font: FONT, size: 21, color: "2B2B2B" } },
      },
    },
  });

  return doc;
}

module.exports = { buildReport, imageParagraph };
