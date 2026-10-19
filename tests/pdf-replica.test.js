import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { paragraphSchema } from "../shared/contracts.js";
import {
  buildReplicaDocx,
  inferPdfStyle,
  replicaFromLayout,
} from "../src/pdf-replica.js";

function run(text, extra = {}) {
  return {
    text,
    font: extra.font || "Calibri",
    size: extra.size || 11,
    bold: Boolean(extra.bold),
    italics: false,
    color: extra.color || "000000",
  };
}

function line(id, text, extra = {}) {
  const size = extra.size || 11;
  return {
    id,
    text,
    x: extra.x ?? 72,
    right: extra.right ?? 400,
    y: extra.y ?? 700,
    size,
    rule: extra.rule,
    runs: extra.runs || [run(text, { ...extra, size })],
  };
}

function layout(lines, width = 612, height = 792) {
  return { pages: [{ width, height, lines }] };
}

const resume = layout([
  line("p0", "Alex Morgan", {
    x: 200,
    right: 412,
    y: 740,
    size: 22,
    bold: true,
    font: "Times New Roman",
    color: "0E6B5C",
  }),
  line("p1", "alex@example.com | 555-010-1234", {
    x: 160,
    right: 450,
    y: 710,
    size: 10,
    color: "333333",
  }),
  line("p2", "EXPERIENCE", {
    y: 680,
    size: 12,
    bold: true,
    color: "0E6B5C",
    rule: { color: "0E6B5C", thickness: 0.8 },
  }),
  line("p3", "Example Company  2025", {
    y: 650,
    right: 540,
    size: 11,
    bold: true,
  }),
  line("p4", "Built reliable checkout", {
    y: 632,
    right: 520,
    size: 11,
  }),
  line("p5", "systems for payments.", {
    y: 618,
    right: 280,
    size: 11,
  }),
  line("p6", "• Shipped the API.", { y: 590, right: 250, size: 11 }),
  line("p7", "EDUCATION", {
    y: 540,
    size: 12,
    bold: true,
    color: "0E6B5C",
    rule: { color: "0E6B5C", thickness: 0.8 },
  }),
]);

test("a PDF style copy keeps type, accent, rules, and groups wrapped lines", () => {
  const { style, paragraphs } = replicaFromLayout(resume);
  assert.equal(style.font, "Calibri");
  assert.equal(style.nameFont, "Times New Roman");
  assert.equal(style.bodySize, 11);
  assert.equal(style.nameSize, 22);
  assert.equal(style.headingSize, 12);
  assert.equal(style.accent, "0E6B5C");
  assert.equal(style.rules, true);
  assert.equal(style.ruleColor, "0E6B5C");
  assert.equal(style.nameAlign, "center");
  assert.equal(style.headingCaps, true);
  assert.deepEqual(
    paragraphs.map((p) => [p.role, p.text]),
    [
      ["name", "Alex Morgan"],
      ["contact", "alex@example.com | 555-010-1234"],
      ["heading", "EXPERIENCE"],
      ["entry", "Example Company  2025"],
      ["body", "Built reliable checkout systems for payments."],
      ["body", "• Shipped the API."],
      ["heading", "EDUCATION"],
    ],
  );
  const parsed = paragraphSchema.array().parse(paragraphs);
  assert.equal(JSON.stringify(parsed), JSON.stringify(paragraphs));
});

test("a finished short line stays separate from the next bullet", () => {
  const { paragraphs } = replicaFromLayout(
    layout([
      line("p0", "Built APIs.", { y: 400, right: 180 }),
      line("p1", "Improved latency.", { y: 386, right: 200 }),
    ]),
  );
  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs[0].text, "Built APIs.");
  assert.equal(paragraphs[1].text, "Improved latency.");
});

test("a wide vertical gap starts a new paragraph", () => {
  const { paragraphs } = replicaFromLayout(
    layout([
      line("p0", "Built reliable checkout", { y: 400, right: 520 }),
      line("p1", "systems for payments.", { y: 360, right: 280 }),
    ]),
  );
  assert.equal(paragraphs.length, 2);
});

test("two columns are read down the left side, then the right", () => {
  const lines = [
    line("name", "Alex Morgan", { x: 40, right: 220, y: 740, size: 22, bold: true }),
    ...[0, 1, 2].flatMap((i) => [
      line("l" + i, "Left " + i + ".", { x: 40, right: 180, y: 680 - 40 * i }),
      line("r" + i, "Right " + i + ".", { x: 330, right: 520, y: 680 - 40 * i }),
    ]),
  ];
  const { paragraphs } = replicaFromLayout(layout(lines));
  assert.deepEqual(
    paragraphs.map((p) => p.id),
    ["name", "l0", "l1", "l2", "r0", "r1", "r2"],
  );
});

async function xmlOf(style, paragraphs) {
  const blob = await buildReplicaDocx(style, paragraphs);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return zip.file("word/document.xml").async("string");
}

function visibleText(xml) {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
    .map((match) => match[1])
    .join("");
}

test("the flowing copy uses automatic spacing and tabs only a short dated line", async () => {
  const { style, paragraphs } = replicaFromLayout(resume);
  const xml = await xmlOf(style, paragraphs);
  assert.match(xml, /w:lineRule="auto"/);
  assert.equal(xml.includes('w:lineRule="exact"'), false);
  assert.match(xml, /w:tab w:val="right"/);
  assert.match(xml, /<w:tab\/>/);
  assert.match(xml, /w:pBdr/);
  assert.match(xml, /Times New Roman/);
  assert.match(xml, /w:color w:val="0E6B5C"/);
  assert.match(xml, /w:caps/);
  for (const paragraph of paragraphs) {
    assert.ok(xml.includes("rolecraft_source_" + paragraph.id));
    assert.ok(visibleText(xml).includes(paragraph.text.replace(/\s+/g, " ").trim()) || visibleText(xml).includes(paragraph.text));
  }
  assert.equal(
    visibleText(xml).includes("Example Company  2025"),
    true,
  );
  const long = paragraphs.map((p) =>
    p.role === "entry"
      ? {
          ...p,
          text: "Example Company expanded across several regions, teams, and products  2025",
        }
      : p,
  );
  const grown = await xmlOf(style, long);
  assert.equal(grown.includes("<w:tab/>"), false);
  assert.equal(grown.includes('w:lineRule="exact"'), false);
  assert.ok(visibleText(grown).includes(long.find((p) => p.role === "entry").text));
});

test("black body text does not become the accent", () => {
  const style = inferPdfStyle(
    layout([
      line("p0", "Alex Morgan", { y: 740, size: 22, color: "111111" }),
      line("p1", "Built reliable systems for payments teams.", {
        y: 700,
        color: "000000",
      }),
    ]),
  );
  assert.equal(style.accent, "000000");
});

test("paragraph schema keeps a layout role and still accepts older paragraphs", () => {
  const parsed = paragraphSchema.parse({
    id: "p0",
    text: "Hello",
    editable: true,
    role: "body",
    tabX: 10,
  });
  assert.deepEqual(parsed, {
    id: "p0",
    text: "Hello",
    editable: true,
    role: "body",
  });
  assert.equal(
    paragraphSchema.parse({ id: "p1", text: "Older", editable: false }).role,
    undefined,
  );
});
