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
import { getPdfLayout, pdfEditFlow, readablePdfColor } from "./pdf-layout.js";
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
      function paragraph(line, before, left, width, keepNext) {
        const p = current.get(line.id);
        if (!p) throw new Error("A PDF source paragraph is missing.");
        const center = (line.x + line.right) / 2;
        const centered =
          line.right - line.x < width * 0.9 &&
          Math.abs(center - (left + width / 2)) < 6;
        const alignedRight =
          !centered &&
          line.x > left + width * 0.35 &&
          Math.abs(line.right - (left + width)) < 5;
        const indent = centered || alignedRight ? 0 : Math.max(0, line.x - left);
        const flow = pdfEditFlow(line, p.text, { left, width });
        const runs = flow.runs;
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
                r.tabX > page.width * 0.6 ? TabStopType.RIGHT : TabStopType.LEFT,
              position: twips(r.tabX > page.width * 0.6 ? width : r.tabX - left),
            })),
          spacing: {
            before: twips(before),
            after: 0,
            line:
              flow.lineRule === "auto" ? 276 : twips(line.size * 1.15),
            lineRule:
              flow.lineRule === "auto" ? LineRuleType.AUTO : LineRuleType.EXACT,
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
          keepNext,
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
      }
      function blocks(lines, left, width, startY) {
        let previousBottom = startY;
        const ordered = [...lines].sort((a, b) => b.y - a.y || a.x - b.x);
        return ordered.map((line, index) => {
          const top = page.height - line.y - line.size;
          const before = Math.max(0, Math.min(90, top - previousBottom));
          previousBottom = page.height - line.y + line.size * 0.15;
          const source = current.get(line.id);
          return paragraph(
            line,
            before,
            left,
            width,
            index + 1 < ordered.length &&
              source?.text.length < 65 &&
              line.text.length < 65 &&
              line.runs.every((r) => r.bold),
          );
        });
      }
      function columnRows(columns) {
        const left = [...columns[0]].sort((a, b) => b.y - a.y || a.x - b.x);
        const right = [...columns[1]].sort((a, b) => b.y - a.y || a.x - b.x);
        const rows = [];
        let i = 0,
          j = 0;
        while (i < left.length || j < right.length) {
          const l = left[i],
            r = right[j];
          if (l && r && Math.abs(l.y - r.y) <= 3) {
            rows.push([l, r]);
            i++;
            j++;
          } else if (l && (!r || l.y > r.y)) {
            rows.push([l, null]);
            i++;
          } else {
            rows.push([null, r]);
            j++;
          }
        }
        return rows;
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
            rows: (() => {
              let previousBottom = columnStart;
              const lefts = [design.left, design.split];
              const widths = [splitWidth - 14, contentWidth - splitWidth];
              return columnRows(design.columns).map((pair) => {
                const present = pair.filter(Boolean);
                const topLine = present.reduce((a, b) => (a.y > b.y ? a : b));
                const low = present.reduce((a, b) => (a.y < b.y ? a : b));
                const top = page.height - topLine.y - topLine.size;
                const before = Math.max(0, Math.min(90, top - previousBottom));
                previousBottom = page.height - low.y + low.size * 0.15;
                return new TableRow({
                  cantSplit: false,
                  children: pair.map(
                    (line, i) =>
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
                        children: [
                          line
                            ? paragraph(line, before, lefts[i], widths[i], false)
                            : new Paragraph({
                                spacing: { before: 0, after: 0 },
                              }),
                        ],
                      }),
                  ),
                });
              });
            })(),
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
