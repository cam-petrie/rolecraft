import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { resumeLayouts, selectedResumeLayout, buildResumeLayout } from "../src/resume-layouts.js";
import { exportResume } from "../src/documents.js";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const paragraphs = [
  { id: "p0", text: "Alex Example", editable: true },
  { id: "p4", text: "TECHNICAL SKILLS", editable: true },
  { id: "p7", text: "Languages: Python, SQL, C++", editable: true },
  { id: "p10", text: "EXPERIENCE", editable: true },
  { id: "p11", text: "• Designed reliable APIs.", editable: true },
  { id: "p14", text: "Added integration tests.", editable: true, list: true },
];
test("layout choices include the original first and exactly five alternatives", () => {
  assert.equal(resumeLayouts.length, 6);
  assert.equal(resumeLayouts[0].id, "original");
  assert.equal(selectedResumeLayout(undefined).id, "original");
  assert.equal(selectedResumeLayout("invalid").id, "original");
});
test("all five layouts preserve edited text, source mapping, skills lists and bullets in exports", async () => {
  for (const layout of resumeLayouts.slice(1)) {
    const blob = await exportResume({ kind: "pdf", resumeLayout: layout.id, paragraphs });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file("word/document.xml").async("string");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const ps = Array.from(doc.getElementsByTagNameNS(W, "p"));
    assert.equal(ps.length, paragraphs.length);
    ps.forEach((p, i) => {
      const text = Array.from(p.getElementsByTagNameNS(W, "t")).map((t) => t.textContent).join("");
      assert.equal(text, paragraphs[i].text);
      const marker = p.getElementsByTagNameNS(W, "bookmarkStart")[0];
      assert.equal(marker.getAttributeNS(W, "name"), "rolecraft_source_" + paragraphs[i].id);
    });
    assert.match(xml, /w:hanging="210"/);
    assert.match(xml, /w:numPr/);
    assert.ok(xml.includes(layout.font));
    assert.ok(xml.includes(layout.accent));
    assert.equal(paragraphs[4].text, "• Designed reliable APIs.");
  }
});
test("default Word layout keeps source XML and assets after switching away from templates", async () => {
  const xml = `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:shd w:fill="FFFF00"/></w:pPr><w:r><w:t>Alex Example</w:t></w:r></w:p></w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  zip.file("word/media/logo.png", new Uint8Array([1, 2, 3]));
  const workspace = { kind: "docx", original: await zip.generateAsync({ type: "arraybuffer" }), paragraphs: [paragraphs[0]], resumeLayout: "modern" };
  await buildResumeLayout(workspace, workspace.paragraphs);
  const result = await JSZip.loadAsync(await (await exportResume({ ...workspace, resumeLayout: "original" })).arrayBuffer());
  assert.equal(await result.file("word/document.xml").async("string"), xml);
  assert.deepEqual(await result.file("word/media/logo.png").async("uint8array"), new Uint8Array([1, 2, 3]));
});

test("PDF source lines flow together without merging headings, distinct bullets or list labels", async () => {
  const { groupLayoutParagraphs } = await import("../src/resume-layouts.js");
  const ps = [
    { id: "p0", text: "EXPERIENCE" },
    { id: "p1", text: "• Built scalable services across" },
    { id: "p2", text: "multiple regions." },
    { id: "p3", text: "• Added automated tests." },
    { id: "p4", text: "Languages: Python, SQL," },
    { id: "p5", text: "JavaScript, C++" },
    { id: "p6", text: "Tools: Docker, Git" },
  ];
  const lines = new Map(ps.map((p, i) => [p.id, { text: p.text, y: 700-i*12, size: 10, pageIndex: 0, runs: [{ text: p.text, bold: i === 0 }] }]));
  assert.deepEqual(groupLayoutParagraphs(ps, lines).map((g) => g.map((p) => p.id)), [["p0"], ["p1", "p2"], ["p3"], ["p4", "p5"], ["p6"]]);
  const edited = ps.map((p) => p.id === "p1" ? { ...p, text: "• Designed scalable services." } : p);
  assert.equal(groupLayoutParagraphs(edited, lines)[1].length, 2);
});

test("flowing template edit targets exclude separator spaces and adjacent source text", async () => {
  const { wrapTemplateSource, renderedParagraphText } = await import("../src/document-markers.js");
  const doc = new DOMParser().parseFromString('<p><span id="rolecraft_source_p1"/><span>• Built APIs</span><span id="rolecraft_separator_p2"/><span> </span><span id="rolecraft_source_p2"/><span>across regions.</span></p>', "text/xml");
  const spans = Array.from(doc.getElementsByTagName("span"));
  const first = wrapTemplateSource(spans[0]);
  const second = wrapTemplateSource(spans[4]);
  assert.equal(renderedParagraphText(first), "• Built APIs");
  assert.equal(renderedParagraphText(second), "across regions.");
  assert.equal(doc.documentElement.textContent, "• Built APIs across regions.");
});
