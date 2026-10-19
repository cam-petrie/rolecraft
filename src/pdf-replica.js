// A flowing resume copied from a PDF's main style, not its coordinates.
// New uploads edit this copy. Older line-by-line drafts still use pdf-docx.js.
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  LineRuleType,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
} from "docx";
import { readablePdfColor } from "./pdf-layout.js";

const ROLES = ["name", "contact", "heading", "entry", "body"];
const MARGIN = 54;
const twips = (n) => Math.round(n * 20);

function clamp(n, min, max, fallback) {
  const value = Number(n);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function hexColor(value, fallback = "000000") {
  return /^[0-9A-Fa-f]{6}$/.test(value || "") ? value.toUpperCase() : fallback;
}

function lettersOf(text) {
  return text.replace(/[^A-Za-z]/g, "");
}

function allCaps(text) {
  const letters = lettersOf(text);
  return letters.length >= 3 && letters === letters.toUpperCase();
}

function readingOrder(page) {
  const lines = page.lines || [];
  const byPos = (a, b) => b.y - a.y || a.x - b.x;
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
  if (bodyY === null) return [...lines].sort(byPos);
  const header = lines.filter((l) => l.y > bodyY + 8);
  const body = lines.filter((l) => !header.includes(l));
  const columns = body.every((l) => l.x >= split - 8 || l.right <= split - 8);
  if (!columns) return [...lines].sort(byPos);
  const left = body.filter((l) => l.x < split - 8).sort(byPos);
  const right = body.filter((l) => l.x >= split - 8).sort(byPos);
  return [...header.sort(byPos), ...left, ...right];
}

function dominantFont(lines) {
  const counts = new Map();
  for (const line of lines)
    for (const run of line.runs || []) {
      const font = run.font || "Calibri";
      counts.set(font, (counts.get(font) || 0) + (run.text?.length || 1));
    }
  let best = "Calibri",
    n = -1;
  for (const [font, count] of counts)
    if (count > n) {
      best = font;
      n = count;
    }
  return best;
}

function bodySizeOf(lines) {
  const counts = new Map();
  for (const line of lines) {
    const size = Math.max(8, Math.round(line.size || 11));
    counts.set(size, (counts.get(size) || 0) + 1);
  }
  let best = 11,
    n = -1;
  for (const [size, count] of counts)
    if (count > n || (count === n && size < best)) {
      best = size;
      n = count;
    }
  return best;
}

function neutralColor(color) {
  const rgb = hexColor(color, "").match(/.{2}/g)?.map((v) => parseInt(v, 16));
  if (!rgb || rgb.length !== 3) return true;
  const max = Math.max(...rgb),
    min = Math.min(...rgb);
  return max < 45 || min > 210 || max - min < 24;
}

function accentOf(lines) {
  const counts = new Map();
  for (const line of lines)
    for (const run of line.runs || []) {
      const color = hexColor(run.color, "000000");
      if (neutralColor(color)) continue;
      counts.set(color, (counts.get(color) || 0) + (run.text?.length || 1));
    }
  let best = "000000",
    n = 0;
  for (const [color, count] of counts)
    if (count > n) {
      best = color;
      n = count;
    }
  return best;
}

function isCentered(line, pageWidth) {
  const width = line.right - line.x;
  const mid = (line.x + line.right) / 2;
  return width < pageWidth * 0.8 && Math.abs(mid - pageWidth / 2) < pageWidth * 0.08;
}

export function isHeadingLine(line) {
  const text = line.text.trim();
  if (!text || text.length > 80) return false;
  if (line.rule) return true;
  if (text.length > 42 || /(?:19|20)\d{2}/.test(text)) return false;
  return allCaps(text);
}

function isNameLine(line, bodySize) {
  const text = line.text.trim();
  return (
    text.length > 0 && text.length <= 80 && line.size >= bodySize + 4
  );
}

function looksLikeContact(text) {
  if (text.length > 160) return false;
  return (
    /@/.test(text) ||
    /\b(?:\+?\d[\d\s().-]{7,}\d)\b/.test(text) ||
    (/[|•·]/.test(text) && text.length < 140)
  );
}

function looksLikeEntry(line, bodySize) {
  const text = line.text.trim();
  if (text.length < 3 || text.length >= 90) return false;
  if (/^[•\-–—*▪◦]/.test(text)) return false;
  if (/(?:19|20)\d{2}/.test(text)) return true;
  const runs = line.runs || [];
  const bold = runs.reduce(
    (n, run) => n + (run.bold ? run.text?.length || 0 : 0),
    0,
  );
  return (
    bold >= text.length * 0.7 &&
    text.length <= 80 &&
    Math.abs((line.size || bodySize) - bodySize) <= 1.5 &&
    !/[.!?]$/.test(text)
  );
}

function classify(line, previous, bodySize) {
  if (!previous.length && isNameLine(line, bodySize) && !line.rule)
    return "name";
  if (isHeadingLine(line)) return "heading";
  const seenHeading = previous.some((p) => p.role === "heading");
  if (
    !seenHeading &&
    previous.some((p) => p.role === "name") &&
    looksLikeContact(line.text.trim())
  )
    return "contact";
  if (looksLikeEntry(line, bodySize)) return "entry";
  return "body";
}

function canMerge(open, line, role, pageWidth) {
  if (open.role !== "body" || role !== "body") return false;
  const prev = open.line;
  if (Math.abs((prev.size || 11) - (line.size || 11)) > 1) return false;
  if (Math.abs(prev.x - line.x) > 10) return false;
  if (/^[•\-–—*▪◦]/.test(line.text.trim())) return false;
  if (Number.isFinite(prev.y) && Number.isFinite(line.y)) {
    const gap = prev.y - line.y;
    if (!(gap > 0 && gap <= Math.max(prev.size || 11, line.size || 11) * 1.85))
      return false;
  }
  const ended = /[.!?:]$/.test(open.text.trim());
  const full = prev.right > pageWidth * 0.72;
  return full || !ended;
}

export function normalizePdfStyle(style = {}) {
  const accent = hexColor(style.accent, "000000");
  const font =
    typeof style.font === "string" &&
    style.font.trim() &&
    style.font.length <= 80
      ? style.font.trim()
      : "Calibri";
  const nameFont =
    typeof style.nameFont === "string" &&
    style.nameFont.trim() &&
    style.nameFont.length <= 80
      ? style.nameFont.trim()
      : font;
  return {
    font,
    nameFont,
    bodySize: clamp(style.bodySize, 8, 28, 11),
    nameSize: clamp(style.nameSize, 12, 48, 20),
    headingSize: clamp(style.headingSize, 9, 36, 13),
    contactSize: clamp(style.contactSize, 8, 18, 10),
    accent,
    rules: Boolean(style.rules),
    nameAlign: style.nameAlign === "center" ? "center" : "left",
    headingCaps: Boolean(style.headingCaps),
    pageWidth: clamp(style.pageWidth, 400, 1000, 612),
    pageHeight: clamp(style.pageHeight, 400, 1400, 792),
    ruleColor: hexColor(style.ruleColor, accent),
  };
}

export function inferPdfStyle(layout) {
  const pages = (layout?.pages || []).filter((page) => page.lines?.length);
  const lines = pages.flatMap((page) => readingOrder(page));
  const bodySize = lines.length ? bodySizeOf(lines) : 11;
  const first = lines[0];
  const page = pages[0] || { width: 612, height: 792 };
  const headings = lines.filter((line) => isHeadingLine(line));
  const headingSizes = headings.map((line) => line.size).sort((a, b) => a - b);
  const ruleColors = new Map();
  for (const line of lines)
    if (line.rule?.color) {
      const color = hexColor(line.rule.color, "000000");
      ruleColors.set(color, (ruleColors.get(color) || 0) + 1);
    }
  let ruleColor = null,
    ruleCount = 0;
  for (const [color, count] of ruleColors)
    if (count > ruleCount) {
      ruleColor = color;
      ruleCount = count;
    }
  const named = first && isNameLine(first, bodySize) && !first.rule;
  return normalizePdfStyle({
    font: lines.length ? dominantFont(lines) : "Calibri",
    nameFont:
      named && first.runs?.[0]?.font ? first.runs[0].font : undefined,
    bodySize,
    nameSize: named ? first.size : Math.max(bodySize + 8, 20),
    headingSize: headingSizes.length
      ? headingSizes[Math.floor(headingSizes.length / 2)]
      : bodySize + 1,
    contactSize: Math.max(8, bodySize - 1),
    accent: lines.length ? accentOf(lines) : "000000",
    rules: lines.some((line) => line.rule),
    nameAlign: named && isCentered(first, page.width || 612) ? "center" : "left",
    headingCaps:
      headings.length > 0 &&
      headings.filter((line) => allCaps(line.text)).length >= headings.length / 2,
    pageWidth: page.width,
    pageHeight: page.height,
    ruleColor: ruleColor || undefined,
  });
}

export function replicaFromLayout(layout) {
  const style = inferPdfStyle(layout);
  const paragraphs = [];
  let open = null;
  const flush = () => {
    if (!open) return;
    paragraphs.push({
      id: open.id,
      text: open.text,
      editable: true,
      role: open.role,
    });
    open = null;
  };
  for (const page of layout?.pages || []) {
    for (const line of readingOrder(page)) {
      const text = line.text.trim();
      if (!text || !line.id) continue;
      const role = classify(line, open ? [...paragraphs, open] : paragraphs, style.bodySize);
      if (open && canMerge(open, line, role, open.pageWidth || page.width || 612)) {
        open.text = `${open.text} ${text}`;
        open.line = line;
        continue;
      }
      flush();
      open = {
        id: line.id,
        text,
        role: ROLES.includes(role) ? role : "body",
        line,
        pageWidth: page.width || 612,
      };
    }
  }
  flush();
  return { style, paragraphs };
}

function entryParts(text) {
  const match = text.match(
    /^(.*\S)(\s{2,})((?:\S+\s+)?(?:19|20)\d{2}\b.*)$/,
  );
  if (!match || match[1].length >= 60 || text.length > 90) return null;
  return match;
}

function replicaParagraph(style, paragraph, contentWidth, index) {
  const role = paragraph.role || "body";
  const align =
    (role === "name" || role === "contact") && style.nameAlign === "center"
      ? AlignmentType.CENTER
      : AlignmentType.LEFT;
  const accent = readablePdfColor(style.accent);
  const before =
    index === 0
      ? 0
      : role === "heading"
        ? 14
        : role === "entry"
          ? 8
          : role === "contact"
            ? 2
            : 1;
  const after = role === "name" ? 2 : role === "heading" ? 3 : role === "entry" ? 2 : 3;
  const size =
    role === "name"
      ? style.nameSize
      : role === "heading"
        ? style.headingSize
        : role === "contact"
          ? style.contactSize
          : style.bodySize;
  const color =
    role === "name" || role === "heading"
      ? accent
      : role === "contact"
        ? "333333"
        : "000000";
  const parts = role === "entry" ? entryParts(paragraph.text) : null;
  const font = role === "name" ? style.nameFont || style.font : style.font;
  const runs = parts
    ? [
        new TextRun({
          text: parts[1],
          font,
          size: size * 2,
          bold: true,
          color,
        }),
        new TextRun({ children: [new Tab()] }),
        new TextRun({
          text: parts[2] + parts[3],
          font,
          size: size * 2,
          color: "333333",
        }),
      ]
    : [
        new TextRun({
          text: paragraph.text,
          font,
          size: size * 2,
          bold: role === "name" || role === "heading" || role === "entry",
          color,
          allCaps: role === "heading" && style.headingCaps ? true : undefined,
        }),
      ];
  return new Paragraph({
    alignment: align,
    spacing: {
      before: twips(before),
      after: twips(after),
      line: 240,
      lineRule: LineRuleType.AUTO,
    },
    tabStops: parts
      ? [{ type: TabStopType.RIGHT, position: twips(contentWidth) }]
      : undefined,
    border:
      role === "heading" && style.rules
        ? {
            bottom: {
              color: readablePdfColor(style.ruleColor || style.accent),
              size: 8,
              space: 1,
              style: BorderStyle.SINGLE,
            },
          }
        : undefined,
    children: [
      new Bookmark({
        id: "rolecraft_source_" + paragraph.id,
        children: runs,
      }),
    ],
  });
}

export async function buildReplicaDocx(rawStyle, paragraphs) {
  const style = normalizePdfStyle(rawStyle);
  const contentWidth = style.pageWidth - MARGIN * 2;
  return Packer.toBlob(
    new Document({
      sections: [
        {
          properties: {
            page: {
              size: {
                width: twips(style.pageWidth),
                height: twips(style.pageHeight),
              },
              margin: {
                top: twips(MARGIN),
                bottom: twips(MARGIN),
                left: twips(MARGIN),
                right: twips(MARGIN),
              },
            },
          },
          children: paragraphs.map((paragraph, index) =>
            replicaParagraph(style, paragraph, contentWidth, index),
          ),
        },
      ],
    }),
  );
}
