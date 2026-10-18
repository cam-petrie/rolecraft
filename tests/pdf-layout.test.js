import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  readablePdfColor,
  pdfFont,
  pdfPaintedText,
  pdfPageLines,
  editedPdfRuns,
} from "../src/pdf-layout.js";

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
