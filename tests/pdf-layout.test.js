import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { renderedParagraphText } from "../src/document-markers.js";
import {
  readablePdfColor,
  pdfHorizontalRules,
  applyPdfRules,
  pdfFont,
  pdfPaintedText,
  pdfPageLines,
  editedPdfRuns,
} from "../src/pdf-layout.js";

test("embedded Times faces override the PDF engine's generic sans-serif fallback", () => {
  assert.equal(
    pdfFont("AAAAAG+TimesNewRomanPSMT", "sans-serif").font,
    "Times New Roman",
  );
  assert.deepEqual(pdfFont("AAAAAE+TimesNewRomanPS-BoldMT", "sans-serif"), {
    font: "Times New Roman",
    bold: true,
    italics: false,
  });
  assert.equal(
    pdfFont("AAAAAK+TimesNewRomanPS-ItalicMT", "sans-serif").italics,
    true,
  );
});

test("thin filled PDF rectangles become section rules with graphics transforms respected", () => {
  const OPS = {
    save: 1,
    restore: 2,
    transform: 3,
    constructPath: 4,
    fill: 5,
    setFillRGBColor: 6,
    endPath: 7,
    stroke: 8,
    eoFill: 9,
    fillStroke: 10,
    eoFillStroke: 11,
  };
  const rules = pdfHorizontalRules(
    {
      fnArray: [1, 3, 4, 5, 2],
      argsArray: [
        [],
        [2, 0, 0, 2, 10, 20],
        [[], [], [10, 320, 285, 320.35]],
        null,
        [],
      ],
    },
    OPS,
  );
  assert.equal(rules[0].x, 30);
  assert.equal(rules[0].right, 580);
  const page = { width: 612, lines: [{ x: 30, y: 665, size: 10 }] };
  applyPdfRules(page, rules);
  assert.equal(page.lines[0].rule, rules[0]);
});

test("layout tabs do not change the exact source text used by the PDF editor", () => {
  const el = new DOMParser().parseFromString(
    '<p>Company  <span class="docx-tab-stop">&#8195;</span>2025</p>',
    "text/xml",
  ).documentElement;
  assert.equal(renderedParagraphText(el, true), "Company  2025");
  assert.ok(renderedParagraphText(el, false).includes("\u2003"));
  assert.ok(el.textContent.includes("\u2003"));
});

test("pale PDF labels remain readable when a graphical background is absent", () => {
  assert.equal(readablePdfColor("FFFFFF"), "333333");
  assert.equal(readablePdfColor("125C52"), "125C52");
});
import { buildStyledPdfDocx, pdfPageDesign } from "../src/pdf-docx.js";

test("PDF text paint keeps typed-array RGB colors and restores graphic state", () => {
  const OPS = { save: 1, restore: 2, setFillRGBColor: 3, showText: 4 };
  const ops = {
    fnArray: [3, 1, 3, 4, 2, 4],
    argsArray: [
      new Uint8Array([18, 92, 82]),
      [],
      new Uint8Array([0, 0, 0]),
      [[{ unicode: "Body" }]],
      [],
      [[{ unicode: "Heading" }]],
    ],
  };
  assert.deepEqual(pdfPaintedText(ops, OPS), [
    { text: "Body", color: "000000" },
    { text: "Heading", color: "125C52" },
  ]);
});

test("PDF import retains text alongside mixed typography and exact run colors", () => {
  const content = {
    styles: { f1: { fontFamily: "serif" }, f2: { fontFamily: "sans-serif" } },
    items: [
      {
        str: "ALEX",
        fontName: "f1",
        transform: [25, 0, 0, 25, 180, 740],
        width: 70,
        hasEOL: true,
      },
      {
        str: "Built",
        fontName: "f2",
        transform: [11, 0, 0, 11, 48, 680],
        width: 25,
      },
      {
        str: "APIs.",
        fontName: "f2",
        transform: [11, 0, 0, 11, 77, 680],
        width: 25,
        hasEOL: true,
      },
    ],
  };
  const page = pdfPageLines(
    content,
    { width: 612, height: 792 },
    { f1: "ABCDEF+Times-Bold", f2: "Helvetica" },
    [
      { text: "ALEX", color: "125C52" },
      { text: "BuiltAPIs.", color: "000000" },
    ],
  );
  assert.deepEqual(
    page.lines.map((l) => l.text),
    ["ALEX", "Built APIs."],
  );
  assert.equal(page.lines[0].runs[0].font, "Times New Roman");
  assert.equal(page.lines[0].runs[0].bold, true);
  assert.equal(page.lines[0].runs[0].color, "125C52");
  assert.equal(page.lines[1].x, 48);
  assert.equal(pdfFont("Helvetica-Oblique").italics, true);
});

test("PDF edits inherit neighboring run styles while retaining unchanged emphasis", () => {
  const line = {
    text: "Built APIs.",
    runs: [
      { text: "Built ", bold: true, font: "Arial", color: "125C52", size: 11 },
      { text: "APIs.", bold: false, font: "Arial", color: "000000", size: 11 },
    ],
  };
  const runs = editedPdfRuns(line, "Built reliable APIs.");
  assert.equal(runs.map((r) => r.text).join(""), "Built reliable APIs.");
  assert.equal(runs[0].bold, true);
  assert.equal(runs[0].color, "125C52");
  assert.equal(runs.at(-1).bold, false);
});

const line = (id, text, x, right, y, size = 11, bold = false) => ({
  id,
  text,
  x,
  right,
  y,
  size,
  runs: [{ text, size, bold, font: "Arial", color: "125C52" }],
});
test("styled PDF DOCX preserves page size, hierarchy, visual order and stable source markers", async () => {
  const lines = [
    line("p0", "NAME", 200, 412, 740, 25, true),
    line("p1", "SKILLS", 48, 110, 550, 12, true),
    line("p2", "Built APIs.", 60, 180, 660),
  ];
  const paragraphs = lines.map((l) => ({
    id: l.id,
    text: l.text,
    editable: true,
  }));
  paragraphs[2].text = "Built reliable APIs.";
  const blob = await buildStyledPdfDocx(
    { pages: [{ width: 612, height: 792, lines }] },
    paragraphs,
  );
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /w:w="12240"/);
  assert.match(xml, /w:h="15840"/);
  assert.match(xml, /w:color w:val="125C52"/);
  assert.match(xml, /w:sz w:val="50"/);
  assert.ok(
    xml.indexOf("rolecraft_source_p2") < xml.indexOf("rolecraft_source_p1"),
  );
  for (const p of paragraphs)
    assert.ok(xml.includes("rolecraft_source_" + p.id));
  assert.ok(xml.includes("Built reliable APIs."));
});

test("simple PDF columns use a borderless table without mixing source paragraphs", async () => {
  const lines = [
    line("p0", "NAME", 40, 250, 746, 24, true),
    ...[0, 1, 2].flatMap((i) => [
      line("l" + i, "Left " + i, 40, 180, 680 - 20 * i),
      line("r" + i, "Right " + i, 230, 550, 680 - 20 * i),
    ]),
  ];
  const page = { width: 612, height: 792, lines };
  assert.equal(pdfPageDesign(page).columns.length, 2);
  const blob = await buildStyledPdfDocx(
    { pages: [page] },
    lines.map((l) => ({ id: l.id, text: l.text, editable: true })),
  );
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /w:tblLayout w:type="fixed"/);
  assert.match(xml, /w:val="none"/);
  assert.ok(
    xml.indexOf("rolecraft_source_l2") < xml.indexOf("rolecraft_source_r0"),
  );
});

test("embedded-font exports retain section borders, link underlines and right-aligned dates", async () => {
  const heading = line("p0", "EXPERIENCE", 35, 150, 700, 10, true);
  heading.rule = { color: "000000", thickness: 0.72 };
  const job = line("p1", "Example Company  2025", 35, 580, 684);
  job.runs = [
    {
      text: "Example Company ",
      font: "Times New Roman",
      size: 10,
      bold: true,
      color: "000000",
    },
    {
      text: " 2025",
      font: "Times New Roman",
      size: 10,
      bold: true,
      color: "000000",
      tabX: 550,
    },
  ];
  const link = line("p2", "example.com", 35, 100, 670);
  link.runs[0].underline = true;
  const lines = [heading, job, link];
  const blob = await buildStyledPdfDocx(
    { pages: [{ width: 612, height: 792, lines }] },
    lines.map((l) => ({ id: l.id, text: l.text, editable: true })),
  );
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /w:pBdr/);
  assert.match(xml, /w:lineRule="exact"/);
  assert.match(xml, /w:tab w:val="right"/);
  assert.match(xml, /<w:tab\/>/);
  assert.match(xml, /w:u w:val="single"/);
  assert.ok(xml.includes("Times New Roman"));
});

test("edited PDF bullets keep hanging indentation and body font after a symbol run", async () => {
  const source = { ...line("p0", "• Built APIs.", 48, 230, 700), runs: [
    { text: "• ", size: 11, font: "Symbol", x: 48, right: 53 },
    { text: "Built APIs.", size: 11, font: "Times New Roman", x: 60, right: 230 },
  ] };
  const runs = editedPdfRuns(source, "• Designed APIs.");
  assert.equal(runs.find((r) => r.text.includes("Designed")).font, "Times New Roman");
  const blob = await buildStyledPdfDocx({ pages: [{ width: 612, height: 792, lines: [source] }] }, [{ id: "p0", text: "• Designed APIs.", editable: true }]);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /w:hanging="240"/);
  assert.match(xml, /• /);
  assert.match(xml, /Designed/);
});
