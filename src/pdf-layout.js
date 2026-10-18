import diff from "fast-diff";
// PDF text geometry is kept locally and reused by the editable DOCX renderer.
// It is not included in AI requests. The original binary remains the baseline.
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export function readablePdfColor(color = "000000") {
  // Dark sidebar backgrounds are graphics and may not reconstruct. Keep their
  // white/pale labels visible on the draft's white paper.
  const rgb = color.match(/.{2}/g)?.map((v) => parseInt(v, 16));
  return rgb?.length === 3 && rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > 205
    ? "333333" : color;
}
export function pdfFont(name = "", fallback = "sans-serif") {
  const clean = name.replace(/^[A-Z]{6}\+/, "");
  let font = /georgia/i.test(clean)
    ? "Georgia"
    : /garamond/i.test(clean)
      ? "Garamond"
      : /cambria/i.test(clean)
        ? "Cambria"
        : /calibri|carlito/i.test(clean)
          ? "Calibri"
          : /courier|mono/i.test(clean + " " + fallback)
            ? "Courier New"
            : /verdana/i.test(clean)
              ? "Verdana"
              : /aptos/i.test(clean)
                ? "Aptos"
                : /times|serif/i.test(clean + " " + fallback) &&
                    !/sans/i.test(clean + " " + fallback)
                  ? "Times New Roman"
                  : "Arial";
  return {
    font,
    bold: /bold|black|heavy|semibold|demi/i.test(clean),
    italics: /italic|oblique/i.test(clean),
  };
}

export function pdfPaintedText(ops, OPS) {
  const runs = [],
    stack = [];
  let color = "000000";
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i],
      args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(color);
    else if (fn === OPS.restore) color = stack.pop() || "000000";
    else if (fn === OPS.setFillRGBColor)
      color = Array.from(args, (v) =>
        clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0"),
      )
        .join("")
        .toUpperCase();
    else if (fn === OPS.showText || fn === OPS.showSpacedText) {
      const text = (args[0] || [])
        .filter((g) => typeof g === "object")
        .map((g) => g.unicode || "")
        .join("");
      if (text) runs.push({ text, color });
    }
  }
  return runs;
}

export function pdfPageLines(content, page, fontNames = {}, paints = []) {
  const lines = [];
  const painted = paints
    .map((r) => r.text)
    .join("")
    .replace(/\u00a0/g, " ");
  let cursor = 0,
    offset = 0;
  const colors = paints.map((r) => {
    const span = { start: offset, end: offset + r.text.length, color: r.color };
    offset = span.end;
    return span;
  });
  let line = "",
    y = null,
    runs = [],
    x = Infinity,
    right = 0,
    maxSize = 0;
  function flush() {
    if (line.trim()) {
      const trimStart = line.length - line.trimStart().length;
      const trimEnd = line.trimEnd().length;
      let pos = 0;
      const trimmed = runs.flatMap((r) => {
        const start = Math.max(trimStart, pos),
          end = Math.min(trimEnd, pos + r.text.length);
        const result =
          end > start
            ? [{ ...r, text: r.text.slice(start - pos, end - pos) }]
            : [];
        pos += r.text.length;
        return result;
      });
      lines.push({
        text: line.trim(),
        x,
        right,
        y,
        size: maxSize,
        runs: trimmed,
      });
    }
    line = "";
    runs = [];
    x = Infinity;
    right = 0;
    maxSize = 0;
  }
  for (const item of content.items) {
    if (!("str" in item)) continue;
    if (y !== null && Math.abs(item.transform[5] - y) > 3) flush();
    const size = clamp(
      Math.hypot(item.transform[2], item.transform[3]) || item.height || 11,
      5,
      72,
    );
    const style = pdfFont(
      fontNames[item.fontName],
      content.styles[item.fontName]?.fontFamily,
    );
    const found = item.str
      ? painted.indexOf(item.str.replace(/\u00a0/g, " "), cursor)
      : -1;
    const color =
      found >= 0
        ? colors.find((r) => r.start <= found && r.end > found)?.color
        : undefined;
    if (found >= 0) cursor = found + item.str.length;
    const text = (line && !line.endsWith(" ") ? " " : "") + item.str;
    line += text;
    runs.push({ text, ...style, size, color: color || "000000" });
    x = Math.min(x, item.transform[4]);
    right = Math.max(right, item.transform[4] + item.width);
    maxSize = Math.max(maxSize, size);
    y = item.transform[5];
    if (item.hasEOL) flush();
  }
  flush();
  return { width: page.width, height: page.height, lines };
}

export async function readPdfLayout(original) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  const pdf = await pdfjs.getDocument({
    data: original.slice(0),
    isEvalSupported: false,
  }).promise;
  const pages = [],
    paragraphs = [];
  try {
    if (pdf.numPages > 30)
      throw new Error("Please use a resume with 30 pages or fewer.");
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const ops = await page.getOperatorList();
      const fonts = {};
      for (const item of content.items)
        if (item.fontName && !fonts[item.fontName]) {
          try {
            fonts[item.fontName] = page.commonObjs.get(item.fontName).name;
          } catch {
            /* Generic family remains available. */
          }
        }
      const viewport = page.getViewport({ scale: 1 });
      const layout = pdfPageLines(
        content,
        viewport,
        fonts,
        pdfPaintedText(ops, pdfjs.OPS),
      );
      for (const line of layout.lines) {
        line.id = `p${paragraphs.length}`;
        paragraphs.push({ id: line.id, text: line.text, editable: true });
      }
      pages.push(layout);
    }
  } finally {
    await pdf.destroy();
  }
  return { paragraphs, layout: { version: 1, pages } };
}

const layouts = new WeakMap();
export async function getPdfLayout(workspace) {
  if (!layouts.has(workspace.original))
    layouts.set(
      workspace.original,
      readPdfLayout(workspace.original).then(({ paragraphs, layout }) => {
        // Recover styles for existing saved resumes without changing paragraph IDs,
        // edits, versions or the immutable baseline.
        const baseline = workspace.baseline;
        if (
          paragraphs.length !== baseline.length ||
          paragraphs.some((p, i) => p.text !== baseline[i].text)
        )
          throw new Error(
            "Could not match PDF styling to the saved baseline. Export a backup and re-upload the original PDF to recover its design.",
          );
        for (const page of layout.pages)
          for (const line of page.lines)
            line.id = baseline[Number(line.id.slice(1))].id;
        return layout;
      }),
    );
  return layouts.get(workspace.original);
}

export function editedPdfRuns(line, text) {
  if (text === line.text) return line.runs;
  const owners = line.runs.flatMap((r, i) => Array(r.text.length).fill(i));
  const runs = line.runs.map((r) => ({ ...r, text: "" }));
  let pos = 0;
  for (const [op, chars] of diff(line.text, text)) {
    if (op === 0)
      for (const ch of chars.split("")) {
        runs[owners[pos] ?? 0].text += ch;
        pos++;
      }
    else if (op === -1) pos += chars.length;
    else runs[owners[Math.max(0, pos - 1)] ?? 0].text += chars;
  }
  return runs.filter((r) => r.text);
}
