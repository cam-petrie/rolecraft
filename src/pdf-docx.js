import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Bookmark,
  Table,
  TableRow,
  TableCell,
  WidthType,
  TableLayoutType,
  BorderStyle,
  AlignmentType,
  SectionType,
  Tab,
  TabStopType,
  UnderlineType,
  LineRuleType,
} from "docx";
import { getPdfLayout, editedPdfRuns, readablePdfColor } from "./pdf-layout.js";
const twips = (n) => Math.round(n * 20);
const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

export function pdfPageDesign(page) {
  const lines = page.lines;
  const left = Math.max(12, Math.min(...lines.map((l) => l.x)));
  const right = Math.max(
    12,
    page.width - Math.max(...lines.map((l) => l.right)),
  );
  const top = Math.max(
    12,
    Math.min(...lines.map((l) => page.height - l.y - l.size)),
  );
  // Identify repeated right-column starts; full-width headings stay above them.
  const rightLines = lines.filter(
    (l) => l.x > page.width * 0.33 && l.x < page.width * 0.8,
  );
  const split =
    rightLines.length >= 3 ? Math.min(...rightLines.map((l) => l.x)) : null;
  const leftLines = split
    ? lines.filter((l) => l.x < split - 30 && l.right < split - 8)
    : [];
  const bodyY =
    split && leftLines.length >= 3
      ? Math.max(...rightLines.map((l) => l.y))
      : null;
  const header = bodyY === null ? [] : lines.filter((l) => l.y > bodyY + 8);
  const body = lines.filter((l) => !header.includes(l));
  const columns =
    bodyY !== null &&
    body.every((l) => l.x >= split - 8 || l.right <= split - 8)
      ? [
          body.filter((l) => l.x < split - 8),
          body.filter((l) => l.x >= split - 8),
        ]
      : null;
  return { left, right, top, header: columns ? header : [], columns, split };
}

export async function exportStyledPdfDocx(workspace, paragraphs) {
  const layout = await getPdfLayout(workspace);
  return buildStyledPdfDocx(layout, paragraphs);
}

export async function buildStyledPdfDocx(layout, paragraphs) {
  const current = new Map(paragraphs.map((p) => [p.id, p]));
  const sections = layout.pages
    .filter((page) => page.lines.length)
    .map((page) => {
      const design = pdfPageDesign(page);
      const contentWidth = page.width - design.left - design.right;
      function blocks(lines, left, width, startY) {
        let previousBottom = startY;
        const ordered = [...lines].sort((a, b) => b.y - a.y || a.x - b.x);
        return ordered.map((line, index) => {
          const p = current.get(line.id);
          if (!p) throw new Error("A PDF source paragraph is missing.");
          const top = page.height - line.y - line.size;
          const before = Math.max(0, Math.min(90, top - previousBottom));
          previousBottom = page.height - line.y + line.size * 0.15;
          const center = (line.x + line.right) / 2;
          const centered =
            line.right - line.x < width * 0.9 &&
            Math.abs(center - (left + width / 2)) < 6;
          const alignedRight =
            !centered &&
            line.x > left + width * 0.35 &&
            Math.abs(line.right - (left + width)) < 5;
          const indent =
            centered || alignedRight ? 0 : Math.max(0, line.x - left);
          const runs = editedPdfRuns(line, p.text);
          return new Paragraph({
            run: {
              font: line.runs[0]?.font || "Arial",
              size: Math.round(line.size * 2),
            },
            alignment: centered
              ? AlignmentType.CENTER
              : alignedRight
                ? AlignmentType.RIGHT
                : AlignmentType.LEFT,
            indent: { left: twips(indent) },
            tabStops: runs
              .filter((r) => r.tabX !== undefined)
              .map((r) => ({
                type:
                  r.tabX > page.width * 0.6
                    ? TabStopType.RIGHT
                    : TabStopType.LEFT,
                position: twips(
                  r.tabX > page.width * 0.6 ? width : r.tabX - left,
                ),
              })),
            spacing: {
              before: twips(before),
              after: 0,
              line: twips(line.size * 1.15),
              lineRule: LineRuleType.EXACT,
            },
            border: line.rule
              ? {
                  bottom: {
                    color: line.rule.color,
                    size: Math.round(line.rule.thickness * 8),
                    space: 0,
                    style: BorderStyle.SINGLE,
                  },
                }
              : undefined,
            keepNext:
              index + 1 < ordered.length &&
              line.text.length < 65 &&
              line.runs.every((r) => r.bold),
            children: [
              new Bookmark({
                id: "rolecraft_source_" + p.id,
                children: runs.flatMap((r) => {
                  const prefix = r.squashPrefix && r.text.startsWith(" ");
                  return [
                    ...(r.tabX !== undefined
                      ? [new TextRun({ children: [new Tab()] })]
                      : []),
                    ...(prefix ? [new TextRun({ text: " ", size: 1 })] : []),
                    new TextRun({
                      text: prefix ? r.text.slice(1) : r.text,
                      font: r.font,
                      size: Math.round(r.size * 2),
                      bold: r.bold,
                      italics: r.italics,
                      color: readablePdfColor(r.color),
                      underline: r.underline
                        ? { type: UnderlineType.SINGLE }
                        : undefined,
                    }),
                  ];
                }),
              }),
            ],
          });
        });
      }
      let children;
      if (design.columns) {
        const columnStart = design.header.length
          ? Math.max(
              ...design.header.map((l) => page.height - l.y + l.size * 0.15),
            )
          : design.top;
        const splitWidth = design.split - design.left;
        children = [
          ...blocks(design.header, design.left, contentWidth, design.top),
          new Table({
            width: { size: twips(contentWidth), type: WidthType.DXA },
            columnWidths: [twips(splitWidth), twips(contentWidth - splitWidth)],
            layout: TableLayoutType.FIXED,
            borders: {
              top: none,
              bottom: none,
              left: none,
              right: none,
              insideHorizontal: none,
              insideVertical: none,
            },
            rows: [
              new TableRow({
                cantSplit: false,
                children: design.columns.map(
                  (column, i) =>
                    new TableCell({
                      margins: {
                        top: 0,
                        bottom: 0,
                        left: 0,
                        right: i === 0 ? twips(14) : 0,
                      },
                      width: {
                        size: twips(
                          i === 0 ? splitWidth : contentWidth - splitWidth,
                        ),
                        type: WidthType.DXA,
                      },
                      children: blocks(
                        column,
                        i === 0 ? design.left : design.split,
                        i === 0 ? splitWidth - 14 : contentWidth - splitWidth,
                        columnStart,
                      ),
                    }),
                ),
              }),
            ],
          }),
        ];
      } else
        children = blocks(page.lines, design.left, contentWidth, design.top);
      return {
        properties: {
          type: SectionType.NEXT_PAGE,
          page: {
            size: { width: twips(page.width), height: twips(page.height) },
            margin: {
              top: twips(design.top),
              bottom: 240,
              left: twips(design.left),
              right: twips(design.right),
            },
          },
        },
        children,
      };
    });
  return Packer.toBlob(new Document({ sections }));
}
