import JSZip from "jszip";
import diff from "fast-diff";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { readPdfLayout } from "./pdf-layout.js";
import { exportStyledPdfDocx } from "./pdf-docx.js";
import { alignPdfTabs } from "./pdf-preview.js";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const nodes = (e, name) => Array.from(e.getElementsByTagNameNS(W, name));
function parse(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    throw new Error("This Word file has invalid XML.");
  return doc;
}
function protectedAncestor(p) {
  for (let el = p.parentNode; el; el = el.parentNode)
    if (["sdt", "drawing", "txbxContent", "del", "ins"].includes(el.localName))
      return true;
  return false;
}
export function extractDocx(xml) {
  const doc = parse(xml);
  return nodes(doc, "p")
    .map((p, index) => ({
      id: `p${index}`,
      ...(nodes(p, "numPr").length ? { list: true } : {}),
      text: nodes(p, "t")
        .map((t) => t.textContent)
        .join(""),
      editable:
        ![
          "tab",
          "br",
          "fldChar",
          "instrText",
          "drawing",
          "pict",
          "del",
          "ins",
          "sdt",
          "sym",
          "object",
          "footnoteReference",
          "endnoteReference",
        ].some((t) => nodes(p, t).length) && !protectedAncestor(p),
    }))
    .filter((p) => p.text.trim());
}
// Keep all existing Word runs, styles, sections, tables, images and relationships.
// Equal characters remain in their original run; inserted text inherits its neighboring run.
export function patchDocxXml(xml, paragraphs) {
  const doc = parse(xml);
  const all = nodes(doc, "p");
  for (const p of paragraphs) {
    const el = all[Number(p.id.slice(1))];
    if (!el) throw new Error("A source paragraph is missing.");
    const ts = nodes(el, "t");
    const old = ts.map((t) => t.textContent).join("");
    if (old === p.text) continue;
    if (!p.editable || !ts.length)
      throw new Error(
        "This paragraph contains unsupported Word objects and cannot be edited safely.",
      );
    const owners = [];
    ts.forEach((t, i) => {
      for (let j = 0; j < t.textContent.length; j++) owners.push(i);
    });
    const updated = ts.map(() => "");
    let pos = 0;
    for (const [op, text] of diff(old, p.text)) {
      if (op === 0) {
        for (const ch of text.split("")) {
          updated[owners[pos] ?? 0] += ch;
          pos++;
        }
      } else if (op === -1) pos += text.length;
      else updated[owners[Math.max(0, pos - 1)] ?? owners[pos] ?? 0] += text;
    }
    ts.forEach((t, i) => {
      t.textContent = updated[i];
      t.setAttributeNS(
        "http://www.w3.org/XML/1998/namespace",
        "xml:space",
        "preserve",
      );
    });
  }
  return new XMLSerializer().serializeToString(doc);
}
export async function importResume(file) {
  if (file.size > 15 * 1024 * 1024)
    throw new Error("Please upload a resume smaller than 15 MB.");
  const kind = file.name.toLowerCase().endsWith(".docx")
    ? "docx"
    : file.name.toLowerCase().endsWith(".pdf")
      ? "pdf"
      : null;
  if (!kind)
    throw new Error(
      "Choose a .docx or .pdf file. Legacy .doc files must first be saved as .docx in Word.",
    );
  const original = await file.arrayBuffer();
  let paragraphs;
  if (kind === "docx") {
    const zip = await JSZip.loadAsync(original);
    const entry = zip.file("word/document.xml");
    if (!entry) throw new Error("This is not a valid Word document.");
    const xml = await entry.async("string");
    if (xml.length > 8_000_000)
      throw new Error(
        "The Word document is too complex. Please use a simpler copy.",
      );
    paragraphs = extractDocx(xml);
  } else {
    ({ paragraphs } = await readPdfLayout(original));
  }
  if (paragraphs.map((p) => p.text).join("").length < 40)
    throw new Error(
      "No usable text found. Scanned PDFs need OCR first; upload a text-based PDF or DOCX.",
    );
  return {
    id: crypto.randomUUID(),
    filename: file.name,
    kind,
    original,
    baseline: structuredClone(paragraphs),
    paragraphs,
    versions: [],
    role: { title: "", company: "", url: "", text: "" },
    analysis: null,
    prep: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
export async function exportResume(
  workspace,
  paragraphs = workspace.paragraphs,
) {
  if (workspace.kind === "docx") {
    const zip = await JSZip.loadAsync(workspace.original);
    const xml = await zip.file("word/document.xml").async("string");
    zip.file("word/document.xml", patchDocxXml(xml, paragraphs));
    return zip.generateAsync({
      type: "blob",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  }
  if (workspace.kind === "pdf")
    return exportStyledPdfDocx(workspace, paragraphs);
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 },
          },
        },
        children: paragraphs.map(
          (p, i) =>
            new Paragraph({
              spacing: { after: 140 },
              children: [
                new TextRun({
                  text: p.text,
                  font: "Calibri",
                  size: i === 0 ? 32 : 22,
                  bold: i === 0,
                }),
              ],
            }),
        ),
      },
    ],
  });
  return Packer.toBlob(doc);
}
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function printResume(
  workspace,
  paragraphs = workspace.paragraphs,
) {
  const blob = await exportResume(workspace, paragraphs);
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0";
  document.body.append(frame);
  const d = frame.contentDocument;
  d.open();
  d.write(
    "<!doctype html><html><head><title>Resume</title></head><body></body></html>",
  );
  d.close();
  try {
    const { renderAsync } = await import("docx-preview");
    await renderAsync(blob, d.body, undefined, {
      inWrapper: true,
      breakPages: true,
      useBase64URL: true,
      renderAltChunks: false,
      experimental: workspace.kind === "pdf",
    });
    const style = d.createElement("style");
    style.textContent =
      "@page{margin:0}html,body{margin:0!important;padding:0!important}.docx-wrapper{padding:0!important;background:white!important}.docx-wrapper>section.docx{box-shadow:none!important;margin:0!important;break-after:page}.docx-wrapper>section.docx:last-child{break-after:auto}";
    d.head.append(style);
    await d.fonts.ready;
    if (workspace.kind === "pdf") {
      await new Promise((resolve) => setTimeout(resolve, 550));
      alignPdfTabs(d.body);
    }
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  } catch (e) {
    frame.remove();
    throw e;
  }
}
