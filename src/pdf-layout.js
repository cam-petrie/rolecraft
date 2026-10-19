import diff from "fast-diff";
// PDF text geometry is kept locally and reused by the editable DOCX renderer.
// It is not included in AI requests. The original binary remains the baseline.
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export function readablePdfColor(color = "000000") {
  // Dark sidebar backgrounds are graphics and may not reconstruct. Keep their
  // white/pale labels visible on the draft's white paper.
  const rgb = color.match(/.{2}/g)?.map((v) => parseInt(v, 16));
  return rgb?.length === 3 &&
    rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 205
    ? "333333"
    : color;
}
export function pdfFont(name = "", fallback = "sans-serif") {
  const clean = name.replace(/^[A-Z]{6}\+/, "");
  let font = /georgia/i.test(clean)
    ? "Georgia"
    : /times/i.test(clean)
      ? "Times New Roman"
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

export function pdfHorizontalRules(ops, OPS) {
  const rules = [],
    stack = [];
  let matrix = [1, 0, 0, 1, 0, 0],
    color = "000000",
    bounds = null;
  const point = (x, y) => [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5],
  ];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i],
      args = ops.argsArray[i];
    if (fn === OPS.save) stack.push({ matrix: [...matrix], color });
    else if (fn === OPS.restore) {
      const saved = stack.pop();
      if (saved) ({ matrix, color } = saved);
    } else if (fn === OPS.transform) {
      const [a, b, c, d, e, f] = matrix,
        [g, h, j, k, l, m] = args;
      matrix = [
        a * g + c * h,
        b * g + d * h,
        a * j + c * k,
        b * j + d * k,
        a * l + c * m + e,
        b * l + d * m + f,
      ];
    } else if (fn === OPS.setFillRGBColor)
      color = Array.from(args, (v) =>
        clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0"),
      )
        .join("")
        .toUpperCase();
    else if (fn === OPS.constructPath && args[2]?.length === 4) {
      const [x0, y0, x1, y1] = args[2];
      const points = [
        point(x0, y0),
        point(x1, y0),
        point(x0, y1),
        point(x1, y1),
      ];
      bounds = {
        x: Math.min(...points.map((p) => p[0])),
        right: Math.max(...points.map((p) => p[0])),
        y: Math.min(...points.map((p) => p[1])),
        top: Math.max(...points.map((p) => p[1])),
      };
    } else if (
      [
        OPS.fill,
        OPS.eoFill,
        OPS.fillStroke,
        OPS.eoFillStroke,
        OPS.stroke,
      ].includes(fn)
    ) {
      if (bounds && bounds.right - bounds.x > 25 && bounds.top - bounds.y <= 3)
        rules.push({
          ...bounds,
          color,
          thickness: Math.max(0.5, bounds.top - bounds.y),
        });
      bounds = null;
    } else if (fn === OPS.endPath) bounds = null;
  }
  return rules;
}
export function applyPdfRules(layout, rules) {
  for (const rule of rules) {
    if (rule.right - rule.x < layout.width * 0.45) {
      for (const line of layout.lines.filter(
        (l) => l.y >= rule.y - 1 && l.y - rule.y < l.size,
      ))
        for (const run of line.runs || [])
          if (
            run.x >= rule.x - 1 &&
            run.right <= rule.right + 1 &&
            run.color === rule.color
          )
            run.underline = true;
      continue;
    }
    const heading = layout.lines
      .filter(
        (l) =>
          l.y >= rule.y - 1 &&
          l.y - rule.y < l.size * 1.5 &&
          Math.abs(l.x - rule.x) < 12,
      )
      .sort((a, b) => Math.abs(a.y - rule.y) - Math.abs(b.y - rule.y))[0];
    if (heading) heading.rule = rule;
  }
  return layout;
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
    const prefix = line && !line.endsWith(" ") ? " " : "";
    const gap = item.transform[4] - right;
    // PDF.js turns a large positioning gap into one space glyph whose width is
    // the whole gap. Keep a normal space in the text and tab the next glyph.
    const wideSpace = !item.str.trim() && item.width > Math.max(24, size * 2);
    const tabX =
      line && item.str.trim() && gap > 24 ? item.transform[4] : undefined;
    const text = prefix + item.str;
    line += text;
    runs.push({
      text,
      ...style,
      size,
      color: color || "000000",
      tabX,
      x: item.transform[4],
      right: item.transform[4] + (wideSpace ? 0 : item.width),
      squashPrefix: Boolean(
        prefix && !wideSpace && (gap < size * 0.12 || item.str.startsWith(" ")),
      ),
    });
    x = Math.min(x, item.transform[4]);
    right = Math.max(
      right,
      item.transform[4] + (wideSpace ? 0 : item.width),
    );
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
      applyPdfRules(layout, pdfHorizontalRules(ops, pdfjs.OPS));
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

function typography(run, size = 11) {
  return {
    font: run?.font || "Arial",
    size: run?.size || size,
    bold: Boolean(run?.bold),
    italics: Boolean(run?.italics),
    color: run?.color || "000000",
    underline: Boolean(run?.underline),
  };
}
function runIndexAt(runs, index) {
  let pos = 0;
  for (let i = 0; i < runs.length; i++) {
    if (index < pos + runs[i].text.length) return i;
    pos += runs[i].text.length;
  }
  return Math.max(0, runs.length - 1);
}
function sameProps(a, b) {
  const flags = ["bold", "italics", "underline", "squashPrefix"];
  if (flags.some((key) => Boolean(a[key]) !== Boolean(b[key]))) return false;
  return (
    (a.font || "Arial") === (b.font || "Arial") &&
    (a.size || 11) === (b.size || 11) &&
    (a.color || "000000") === (b.color || "000000") &&
    a.tabX === b.tabX
  );
}
function insertionTypography(source, lineText, pos, size) {
  let previous = pos - 1;
  while (previous >= 0 && /\s/.test(lineText[previous])) previous--;
  let next = pos;
  while (next < lineText.length && /\s/.test(lineText[next])) next++;
  const nextStartsRun =
    next < lineText.length &&
    source.some(
      (_, index) =>
        source.slice(0, index).reduce((n, item) => n + item.text.length, 0) ===
        next,
    );
  const index =
    nextStartsRun && previous !== next
      ? runIndexAt(source, next)
      : previous >= 0
        ? runIndexAt(source, previous)
        : 0;
  return typography(source[index], size);
}
function reseatTabs(source, pieces) {
  for (const run of source) {
    if (run.tabX === undefined) continue;
    const payload = run.text.trim();
    for (const piece of pieces) if (piece.tabX === run.tabX) delete piece.tabX;
    if (!payload) continue;
    const host = [...pieces]
      .reverse()
      .find((piece) => piece.text.includes(payload));
    if (!host) continue;
    const at = host.text.lastIndexOf(payload);
    if (at > 0) {
      const head = { ...host, text: host.text.slice(0, at) };
      delete head.tabX;
      host.text = host.text.slice(at);
      pieces.splice(pieces.indexOf(host), 0, head);
    }
    host.tabX = run.tabX;
  }
}
// Unchanged characters keep their original run, including a date tab.
// Inserted characters continue the neighboring typeface, weight, color and
// underline, but they do not inherit tab stops or kerning-only spaces.
export function editedPdfRuns(line, text) {
  const source = line.runs?.length
    ? line.runs
    : [
        {
          text: line.text,
          font: "Arial",
          size: line.size || 11,
          bold: false,
          color: "000000",
        },
      ];
  if (text === line.text) return source.map((run) => ({ ...run }));
  const pieces = [];
  const tabUsed = new Set();
  const push = (props, chars) => {
    if (!chars) return;
    const last = pieces[pieces.length - 1];
    if (last && sameProps(last, props)) last.text += chars;
    else pieces.push({ ...props, text: chars });
  };
  let pos = 0;
  for (const [op, chars] of diff(line.text || "", text || "")) {
    if (op === 0) {
      let rest = chars;
      while (rest) {
        const index = runIndexAt(source, Math.min(pos, line.text.length - 1));
        const run = source[index];
        const start = source
          .slice(0, index)
          .reduce((n, item) => n + item.text.length, 0);
        const within = pos - start;
        const take = Math.min(rest.length, run.text.length - within);
        if (take <= 0) {
          push(typography(run, line.size), rest);
          pos += rest.length;
          break;
        }
        const slice = rest.slice(0, take);
        const props = { ...run };
        if (tabUsed.has(index) || within > 0) delete props.tabX;
        if (props.squashPrefix && !slice.startsWith(" "))
          delete props.squashPrefix;
        if (props.tabX !== undefined) tabUsed.add(index);
        push(props, slice);
        rest = rest.slice(take);
        pos += take;
      }
    } else if (op === -1) pos += chars.length;
    else {
      push(insertionTypography(source, line.text || "", pos, line.size), chars);
    }
  }
  reseatTabs(source, pieces);
  const tabbed = source.filter((run) => run.tabX !== undefined);
  if (tabbed.length === 1 && !pieces.some((piece) => piece.tabX !== undefined)) {
    const last = pieces[pieces.length - 1];
    if (
      last &&
      (pieces.length > 1 || last.text.trim() === tabbed[0].text.trim())
    )
      last.tabX = tabbed[0].tabX;
  }
  return pieces.filter((piece) => piece.text);
}

export function pdfRunsWidth(runs) {
  return runs.reduce((sum, run) => {
    const narrow = /times|georgia|garamond|cambria|courier/i.test(run.font || "");
    const factor = (run.bold ? 0.56 : 0.5) * (narrow ? 0.92 : 1);
    return sum + [...run.text].length * (run.size || 11) * factor;
  }, 0);
}

// Edited lines that no longer fit their original tab slot wrap as normal text.
// Unchanged lines keep the exact PDF spacing.
export function pdfEditFlow(line, text, box) {
  const runs = editedPdfRuns(line, text);
  if (text === line.text) return { runs, lines: 1, lineRule: "exact" };
  const indent = Math.max(0, line.x - box.left);
  const available = Math.max(box.width - indent, (line.size || 11) * 4);
  const lines = Math.max(
    1,
    Math.ceil(pdfRunsWidth(runs) / available - 1e-6),
  );
  const tab = runs.find((run) => run.tabX !== undefined);
  let dropTabs = lines > 1;
  if (tab && !dropTabs) {
    const before = [];
    for (const run of runs) {
      if (run === tab) break;
      before.push(run);
    }
    const slot = tab.tabX - (box.left + indent);
    if (pdfRunsWidth(before) > slot - 4) dropTabs = true;
  }
  const flowed = dropTabs
    ? runs.map((run) => {
        const next = { ...run };
        delete next.tabX;
        return next;
      })
    : runs;
  return {
    runs: flowed,
    lines,
    lineRule: lines > 1 || dropTabs ? "auto" : "exact",
  };
}
