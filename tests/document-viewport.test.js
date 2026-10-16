import test from "node:test";
import assert from "node:assert/strict";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import {
  markPreviewParagraphs,
  normalizeInlineEdit,
  canEditRenderedParagraph,
} from "../src/document-markers.js";
import { extractDocx, patchDocxXml } from "../src/documents.js";
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const xml =
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Alex Morgan</w:t></w:r></w:p><w:p/><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Built an API</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Protected</w:t><w:tab/></w:r></w:p></w:body></w:document>';
test("preview markers map original XML indices through empty paragraphs and tables", () => {
  const ps = extractDocx(xml);
  assert.deepEqual(
    ps.map((p) => p.id),
    ["p0", "p2", "p3"],
  );
  const marked = markPreviewParagraphs(xml, ps, "test_");
  const doc = new DOMParser().parseFromString(marked, "text/xml");
  const starts = Array.from(
    doc.getElementsByTagNameNS(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "bookmarkStart",
    ),
  );
  assert.deepEqual(
    starts.map((n) => n.getAttribute("w:name")),
    ["test_p0", "test_p2", "test_p3"],
  );
  assert.deepEqual(extractDocx(marked), ps);
  assert.ok(marked.includes('w:pStyle w:val="Title"'));
  assert.ok(marked.includes("w:b"));
  const p = doc.getElementsByTagNameNS(
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "p",
  )[0];
  assert.equal(p.firstChild.localName, "pPr");
});
test("rendered paragraphs are editable only with an exact safe source match", () => {
  const source = { id: "p0", text: "Built an API", editable: true };
  assert.equal(canEditRenderedParagraph(source, "Built an API"), true);
  assert.equal(canEditRenderedParagraph(source, "Built an API "), false);
  assert.equal(
    canEditRenderedParagraph({ ...source, editable: false }, source.text),
    false,
  );
  assert.equal(canEditRenderedParagraph(null, source.text), false);
  assert.equal(
    canEditRenderedParagraph({ ...source, text: "Line\nbreak" }, "Line\nbreak"),
    false,
  );
});
test("inline editing normalizes pasted line breaks without altering other text", () => {
  assert.equal(
    normalizeInlineEdit("First\r\nsecond\nthird\u00a0item"),
    "First second third\u00a0item",
  );
  assert.equal(
    normalizeInlineEdit("  Preserve spacing & <text>  "),
    "  Preserve spacing & <text>  ",
  );
});
test("preview annotations never enter the original export XML", () => {
  const ps = extractDocx(xml);
  ps[1].text = "Built a reliable API";
  markPreviewParagraphs(patchDocxXml(xml, ps), ps, "temporary_");
  const exported = patchDocxXml(xml, ps);
  assert.ok(!exported.includes("temporary_"));
  assert.equal(extractDocx(exported)[1].text, "Built a reliable API");
  assert.ok(exported.includes("w:b"));
  assert.ok(exported.includes("w:tbl"));
});
