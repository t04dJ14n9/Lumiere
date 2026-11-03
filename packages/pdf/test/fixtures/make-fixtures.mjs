// Writes the PDFs the tests open into test/fixtures/generated/.
//
// short.pdf: 3 pages, no outline. one.pdf, five.pdf and landscape.pdf: 1, 5 and 4 (400 x 300) pages.
// figure.pdf: one page with a diagram, a bar chart and a picture (FIGURE).
// outline.pdf: 12 pages of 300 x 400 points. Every page says "Synthetic page N"
// in 18 pt Helvetica on a baseline 100 points below the top (x 72 to about
// 206), and "Second line N" on a baseline 130 points below the top. It has a
// nested outline, page 1 links to page 5, and page 2 links to a web address.
// "Section 2.1" and the link to page 5 open 130 points down their page, at
// "Second line N"; the other entries open at the top of their page.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const PAGE_SIZE = { width: 300, height: 400 };
export const PAGE_COUNT = 12;
export const OUTLINE = [
  { title: 'Part One', page: 1, children: [
    { title: 'Section 1.1', page: 2, children: [] },
    { title: 'Section 1.2', page: 3, children: [] },
  ] },
  { title: 'Part Two', page: 6, children: [
    { title: 'Section 2.1', page: 9, top: 130, children: [] },
  ] },
];
export const INTERNAL_LINK = { page: 1, target: 5, top: 130, rect: [72, 300, 228, 330] };
export const WEB_LINK = { page: 2, url: 'https://example.com/paper', rect: [72, 300, 228, 330] };

/** A PDF assembled object by object; `add` returns the object's number. */
class PdfWriter {
  objects = [];

  add(body) {
    this.objects.push(body);
    return this.objects.length;
  }

  set(number, body) {
    this.objects[number - 1] = body;
  }

  reserve() {
    return this.add(null);
  }

  toBuffer(rootNumber) {
    let out = '%PDF-1.7\n';
    const offsets = [];
    this.objects.forEach((body, index) => {
      offsets.push(Buffer.byteLength(out, 'latin1'));
      out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {out += `${String(offset).padStart(10, '0')} 00000 n \n`;}
    out += `trailer\n<< /Size ${this.objects.length + 1} /Root ${rootNumber} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
}

/** PDF rectangles count up from the bottom; the fixtures are described from the top. */
function fromTop([left, top, right, bottom]) {
  return [left, PAGE_SIZE.height - bottom, right, PAGE_SIZE.height - top].join(' ');
}

function stream(content) {
  return `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
}

export function outlinePdf() {
  const pdf = new PdfWriter();
  const catalog = pdf.reserve();
  const pagesNode = pdf.reserve();
  const font = pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pages = Array.from({ length: PAGE_COUNT }, () => pdf.reserve());

  pages.forEach((pageObject, index) => {
    const number = index + 1;
    const text = [
      `BT /F1 18 Tf 72 ${PAGE_SIZE.height - 100} Td (Synthetic page ${number}) Tj ET`,
      `BT /F1 14 Tf 72 ${PAGE_SIZE.height - 130} Td (Second line ${number}) Tj ET`,
    ].join('\n');
    const contents = pdf.add(stream(text));
    const annotations = [];
    if (number === INTERNAL_LINK.page) {
      annotations.push(pdf.add(`<< /Type /Annot /Subtype /Link /Rect [${fromTop(INTERNAL_LINK.rect)}] /Border [0 0 0] /Dest [${pages[INTERNAL_LINK.target - 1]} 0 R /XYZ 0 ${PAGE_SIZE.height - INTERNAL_LINK.top} 0] >>`));
    }
    if (number === WEB_LINK.page) {
      annotations.push(pdf.add(`<< /Type /Annot /Subtype /Link /Rect [${fromTop(WEB_LINK.rect)}] /Border [0 0 0] /A << /S /URI /URI (${WEB_LINK.url}) >> >>`));
    }
    const annots = annotations.length ? ` /Annots [${annotations.map(n => `${n} 0 R`).join(' ')}]` : '';
    pdf.set(pageObject, `<< /Type /Page /Parent ${pagesNode} 0 R /MediaBox [0 0 ${PAGE_SIZE.width} ${PAGE_SIZE.height}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contents} 0 R${annots} >>`);
  });

  const outlineRoot = pdf.reserve();
  const writeLevel = (items, parent) => {
    const numbers = items.map(() => pdf.reserve());
    items.forEach((item, index) => {
      const children = item.children.length ? writeLevel(item.children, numbers[index]) : undefined;
      const links = [
        `/Title (${item.title})`,
        `/Parent ${parent} 0 R`,
        `/Dest [${pages[item.page - 1]} 0 R /XYZ 0 ${PAGE_SIZE.height - (item.top ?? 0)} 0]`,
        index > 0 ? `/Prev ${numbers[index - 1]} 0 R` : '',
        index < items.length - 1 ? `/Next ${numbers[index + 1]} 0 R` : '',
        children ? `/First ${children.first} 0 R /Last ${children.last} 0 R /Count ${item.children.length}` : '',
      ];
      pdf.set(numbers[index], `<< ${links.filter(Boolean).join(' ')} >>`);
    });
    return { first: numbers[0], last: numbers.at(-1) };
  };
  const top = writeLevel(OUTLINE, outlineRoot);
  pdf.set(outlineRoot, `<< /Type /Outlines /First ${top.first} 0 R /Last ${top.last} 0 R /Count ${OUTLINE.length} >>`);
  pdf.set(pagesNode, `<< /Type /Pages /Kids [${pages.map(n => `${n} 0 R`).join(' ')}] /Count ${PAGE_COUNT} >>`);
  pdf.set(catalog, `<< /Type /Catalog /Pages ${pagesNode} 0 R /Outlines ${outlineRoot} 0 R /PageMode /UseOutlines >>`);
  return pdf.toBuffer(catalog);
}

/** A PDF of `count` pages of `size` without an outline; each page says "<label> page N". */
function plainPdf(count, size, label, rotations = []) {
  const pdf = new PdfWriter();
  const catalog = pdf.reserve();
  const pagesNode = pdf.reserve();
  const font = pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pages = Array.from({ length: count }, (_, index) => {
    const contents = pdf.add(stream(`BT /F1 18 Tf 72 ${size.height - 100} Td (${label} page ${index + 1}) Tj ET`));
    return pdf.add(`<< /Type /Page /Parent ${pagesNode} 0 R /MediaBox [0 0 ${size.width} ${size.height}]${rotations[index] ? ` /Rotate ${rotations[index]}` : ''} /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contents} 0 R >>`);
  });
  pdf.set(pagesNode, `<< /Type /Pages /Kids [${pages.map(n => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pdf.set(catalog, `<< /Type /Catalog /Pages ${pagesNode} 0 R >>`);
  return pdf.toBuffer(catalog);
}

/** A 3-page PDF without an outline; the reload test swaps it in. */
export function shortPdf() {
  return plainPdf(3, PAGE_SIZE, 'Short');
}

/** One, five and four landscape pages: the page counts and shapes the spread layouts must handle. */
export const onePagePdf = () => plainPdf(1, PAGE_SIZE, 'Only');
export const fivePagePdf = () => plainPdf(5, PAGE_SIZE, 'Five');
export const landscapePdf = () => plainPdf(4, { width: 400, height: 300 }, 'Landscape');

/** Portrait 300 x 400 pages with /Rotate 0, 90, 180 and 270: pages 2 and 4 are shown landscape. */
export const ROTATIONS = [0, 90, 180, 270];
export const rotatedPdf = () => plainPdf(4, { width: 300, height: 400 }, 'Rotated', ROTATIONS);

/** A long PDF of text pages, for load-time measurements. */
export function largePdf(pageCount = 600) {
  const pdf = new PdfWriter();
  const catalog = pdf.reserve();
  const pagesNode = pdf.reserve();
  const font = pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pages = Array.from({ length: pageCount }, (_, index) => {
    const lines = Array.from({ length: 30 }, (_, line) =>
      `BT /F1 11 Tf 40 ${PAGE_SIZE.height - 40 - line * 11} Td (Page ${index + 1} line ${line + 1}: the quick brown fox jumps over the lazy dog) Tj ET`);
    const contents = pdf.add(stream(lines.join('\n')));
    return pdf.add(`<< /Type /Page /Parent ${pagesNode} 0 R /MediaBox [0 0 ${PAGE_SIZE.width} ${PAGE_SIZE.height}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contents} 0 R >>`);
  });
  pdf.set(pagesNode, `<< /Type /Pages /Kids [${pages.map(n => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pdf.set(catalog, `<< /Type /Catalog /Pages ${pagesNode} 0 R >>`);
  return pdf.toBuffer(catalog);
}

/**
 * figure.pdf: one 420 x 300 page with a diagram and a chart, the kind of
 * figure dark paper must keep readable. Its areas are [left, top, right,
 * bottom] in points from the page's top-left corner, as the other fixtures
 * are described.
 */
export const FIGURE = {
  size: { width: 420, height: 300 },
  /** Part of a light grey (0.9) node box, beside its label and clear of its rounded corners. */
  box: [90, 64, 110, 96],
  /** The black label "Pending" on that box, 11 pt Helvetica. */
  label: [45, 75, 86, 87],
  /** The filled black head of the arrow between the boxes. */
  arrowhead: [163, 77, 169, 83],
  /** A black rule 0.6 pt thick, as LaTeX draws one, with paper above and below. */
  rule: [40, 116, 380, 124],
  /** Bars filled red, blue and green, without their edges. */
  bars: { red: [44, 190, 66, 250], blue: [94, 210, 116, 250], green: [144, 170, 166, 250] },
  /** A raster picture (a colour ramp with a dot grid), without its edges. */
  picture: [306, 144, 392, 194],
  /** Bare paper. */
  paper: [200, 10, 280, 50],
};

export function figurePdf() {
  const rounded = (x, y, w, h, r) =>
    `${x + r} ${y} m ${x + w - r} ${y} l ${x + w} ${y} ${x + w} ${y} ${x + w} ${y + r} c ` +
    `${x + w} ${y + h - r} l ${x + w} ${y + h} ${x + w} ${y + h} ${x + w - r} ${y + h} c ` +
    `${x + r} ${y + h} l ${x} ${y + h} ${x} ${y + h} ${x} ${y + h - r} c ` +
    `${x} ${y + r} l ${x} ${y} ${x} ${y} ${x + r} ${y} c h`;
  const content = [
    // Node boxes: light grey fill, black labels on them, an arrow between.
    '0.9 0.9 0.9 rg',
    `${rounded(30, 200, 90, 40, 8)} f`,
    `${rounded(170, 200, 90, 40, 8)} f`,
    '0 g BT /F1 11 Tf 45 216 Td (Pending) Tj ET',
    'BT /F1 11 Tf 188 216 Td (Running) Tj ET',
    '0 G 1 w 120 220 m 170 220 l S',
    '0 g 170 220 m 162 225 l 162 215 l h f',
    // A thin rule, as LaTeX draws one.
    '0 g 30 180 360 0.6 re f',
    // A bar chart with an axis and labels.
    '0.85 0.2 0.2 rg 40 40 30 80 re f',
    '0.2 0.4 0.85 rg 90 40 30 60 re f',
    '0.2 0.65 0.3 rg 140 40 30 100 re f',
    '0 G 0.8 w 30 40 m 190 40 l S 30 40 m 30 140 l S',
    '0 g BT /F1 9 Tf 40 28 Td (red) Tj ET BT /F1 9 Tf 92 28 Td (blue) Tj ET BT /F1 9 Tf 140 28 Td (green) Tj ET',
    // The picture, drawn at an odd scale.
    'q 97.3 0 0 61.7 300 100 cm /Im1 Do Q',
  ].join('\n');
  const side = 32;
  let pixels = '';
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const dot = x % 4 === 0 && y % 4 === 0 ? 255 : 0;
      const ramp = Math.round((x / (side - 1)) * 255);
      pixels += String.fromCharCode(Math.min(255, ramp + dot), Math.round((y / (side - 1)) * 255), 255 - ramp);
    }
  }
  const pdf = new PdfWriter();
  const catalog = pdf.reserve();
  const pagesNode = pdf.reserve();
  const font = pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const image = pdf.add(`<< /Type /XObject /Subtype /Image /Width ${side} /Height ${side} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n${pixels}\nendstream`);
  const contents = pdf.add(stream(content));
  const { width, height } = FIGURE.size;
  const pageObject = pdf.add(`<< /Type /Page /Parent ${pagesNode} 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Im1 ${image} 0 R >> >> /Contents ${contents} 0 R >>`);
  pdf.set(pagesNode, `<< /Type /Pages /Kids [${pageObject} 0 R] /Count 1 >>`);
  pdf.set(catalog, `<< /Type /Catalog /Pages ${pagesNode} 0 R >>`);
  return pdf.toBuffer(catalog);
}

export const GENERATED = path.join(path.dirname(new URL(import.meta.url).pathname), 'generated');

if (process.argv[1] === new URL(import.meta.url).pathname) {
  mkdirSync(GENERATED, { recursive: true });
  writeFileSync(path.join(GENERATED, 'outline.pdf'), outlinePdf());
  writeFileSync(path.join(GENERATED, 'short.pdf'), shortPdf());
  writeFileSync(path.join(GENERATED, 'one.pdf'), onePagePdf());
  writeFileSync(path.join(GENERATED, 'five.pdf'), fivePagePdf());
  writeFileSync(path.join(GENERATED, 'landscape.pdf'), landscapePdf());
  writeFileSync(path.join(GENERATED, 'rotated.pdf'), rotatedPdf());
  writeFileSync(path.join(GENERATED, 'large.pdf'), largePdf());
  writeFileSync(path.join(GENERATED, 'figure.pdf'), figurePdf());
  console.log(`Wrote test PDFs to ${GENERATED}`);
}
