import { Document, Packer, Paragraph, TextRun, Bookmark, AlignmentType, BorderStyle } from "docx";
import { getPdfLayout, editedPdfRuns } from "./pdf-layout.js";

export const resumeLayouts = [
  { id: "original", name: "Keep default", description: "Keep your uploaded styling", font: "Times New Roman", accent: "454C46" },
  { id: "modern", name: "Modern", description: "Clean type · teal accents", font: "Arial", accent: "176B5B", size: 21, nameSize: 44, margin: 850 },
  { id: "editorial", name: "Editorial", description: "Classic serif · centered header", font: "Times New Roman", accent: "373330", size: 21, nameSize: 42, margin: 900, centered: true },
  { id: "executive", name: "Executive", description: "Navy headings · shaded sections", font: "Arial", accent: "244563", size: 21, nameSize: 44, margin: 850, shaded: true },
  { id: "compact", name: "Compact", description: "Tighter spacing · more room", font: "Arial", accent: "343E44", size: 19, nameSize: 36, margin: 650, compact: true },
  { id: "minimal", name: "Minimal", description: "Quiet headings · open space", font: "Arial", accent: "343E44", size: 21, nameSize: 42, margin: 1000, minimal: true },
];
export function selectedResumeLayout(id) {
  return resumeLayouts.find((l) => l.id === id) || resumeLayouts[0];
}
export function hasResumeLayout(workspace) {
  return selectedResumeLayout(workspace.resumeLayout).id !== "original";
}
export function isResumeHeading(text) {
  const s = text.trim().replace(/\s+/g, " ").replace(/:$/, "");
  return s.length < 75 && (/^(?:professional summary|summary|profile|(?:technical |core |key |professional |additional )?skills|competencies|technologies|(?:professional |work )?experience|employment|(?:relevant |selected )?projects|(?:relevant )?awards|education|certifications|publications|interests)$/i.test(s) || (s.length > 3 && /^[A-Z &/]+$/.test(s)));
}
const bulletMarker = /^[•●○▪▫◦‣⁃\uf0b7\uf0a7\u25a0\u25a1–—*-]\s*/u;
const sourceLabel = (text) => text.match(/^([^:\n]{1,65}:\s*)/)?.[0];
export function groupLayoutParagraphs(paragraphs, pdfLines) {
  const groups = [];
  for (const p of paragraphs) {
    const previous = groups.at(-1)?.at(-1);
    const a = previous && pdfLines.get(previous.id), b = pdfLines.get(p.id);
    const previousText = a?.text ?? previous?.text, currentText = b?.text ?? p.text;
    const gap = a && b ? a.y - b.y : 0;
    const bold = (line) => line?.runs?.every((r) => r.bold || !r.text.trim());
    const contact = (text) => /@|https?:|^(?:email|mobile|phone|portfolio|github|linkedin)\s*:/i.test(text);
    const continuation = previous && a && b && a.pageIndex === b.pageIndex && gap > 0 && gap < Math.max(a.size, b.size) * 1.8 &&
      Math.abs(a.size - b.size) < 1 && !bold(a) && !bold(b) &&
      !isResumeHeading(previousText) && !isResumeHeading(currentText) &&
      !bulletMarker.test(currentText) && !p.list && !sourceLabel(currentText) &&
      !contact(previousText) && !contact(currentText) && !/[.!?]\s*$/.test(previousText);
    if (continuation) groups.at(-1).push(p);
    else groups.push([p]);
  }
  return groups;
}
export async function buildResumeLayout(workspace, paragraphs) {
  const layout = selectedResumeLayout(workspace.resumeLayout);
  if (layout.id === "original") throw new Error("Choose a new layout before rebuilding a resume.");
  const pdfLines = workspace.kind === "pdf" && workspace.original
    ? new Map((await getPdfLayout(workspace)).pages.flatMap((page, pageIndex) => page.lines.map((line) => [line.id, { ...line, pageIndex }])))
    : new Map();
  const children = groupLayoutParagraphs(paragraphs, pdfLines).map((group, i) => {
    const p = group[0];
    const title = i === 0;
    const heading = !title && isResumeHeading(p.text);
    const marker = p.text.match(bulletMarker)?.[0];
    const hanging = marker ? 210 : 0;
    const inlineContent = group.flatMap((sourceParagraph, groupIndex) => {
    const label = !heading && sourceLabel(sourceParagraph.text);
    const source = pdfLines.get(sourceParagraph.id);
    const spans = source ? editedPdfRuns(source, sourceParagraph.text) : [{ text: sourceParagraph.text }];
    let position = 0;
    const parts = spans.flatMap((span) => {
      const result = [];
      let text = span.text;
      if (span.squashPrefix && text.startsWith(" ")) {
        result.push({ text: " ", tiny: true }); position++; text = text.slice(1);
      }
      const labelLength = Math.max(0, Math.min(text.length, (label?.length || 0) - position));
      if (labelLength) result.push({ text: text.slice(0, labelLength), label: true });
      if (labelLength < text.length) result.push({ text: text.slice(labelLength) });
      position += text.length;
      return result;
    });
    return [
      ...(groupIndex ? [new Bookmark({ id: "rolecraft_separator_" + sourceParagraph.id, children: [new TextRun({ text: " ", font: layout.font, size: layout.size })] })] : []),
      new Bookmark({ id: "rolecraft_source_" + sourceParagraph.id, children: parts.map((part) => new TextRun({
        text: part.text, font: layout.font,
        size: part.tiny ? 1 : title ? layout.nameSize : heading ? layout.size + 1 : layout.size,
        bold: title || heading || Boolean(part.label),
        color: title || heading ? layout.accent : "252B2A",
      })) }),
    ];
    });
    return new Paragraph({
      alignment: title && layout.centered ? AlignmentType.CENTER : AlignmentType.LEFT,
      run: { font: layout.font, size: layout.size },
      ...(p.list && !marker ? { bullet: { level: 0 } } : {}),
      ...(hanging ? { indent: { left: hanging, hanging } } : {}),
      spacing: { before: heading ? (layout.compact ? 110 : 180) : 0,
        after: title ? 110 : heading ? 65 : layout.compact ? 25 : layout.minimal ? 100 : 55,
        line: layout.compact ? 230 : 250 },
      keepNext: title || heading,
      ...(heading && !layout.minimal && !layout.shaded ? { border: { bottom: { color: layout.accent, size: 4, space: 3, style: BorderStyle.SINGLE } } } : {}),
      ...(heading && layout.shaded ? { shading: { fill: "EDF2F7" } } : {}),
      children: inlineContent,
    });
  });
  return Packer.toBlob(new Document({ sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: layout.margin, bottom: layout.margin, left: layout.margin, right: layout.margin } } }, children }] }));
}
