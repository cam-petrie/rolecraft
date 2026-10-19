// Preserve document structure independently of the model's wording.
const bullet = /^(\s*[•●○▪▫◦‣⁃\uf0b7\uf0a7\u25a0\u25a1–—*-]\s*)/u;
const skillsHeading = /^(?:(?:technical|core|key|professional|additional)\s+)?(?:skills|competencies|technologies|technical expertise)\s*:?$/i;
const sectionHeading = /^(?:professional summary|summary|profile|(?:professional |work )?experience|employment|(?:relevant |selected )?projects|(?:relevant )?awards|education|certifications|publications)\s*:?$/i;
const prose = /^(?:i\b|we\b|experienced\b|proficient\b|skilled\b|expertise\b|knowledge\b|ability\b|built\b|developed\b|designed\b|managed\b|implemented\b|worked\b|used\b|utilized\b|leveraged\b|demonstrated\b|supported\b|led\b|architected\b)/i;
function skillItems(text) {
  let depth = 0, start = 0;
  const items = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    if (text[i] === ")") depth = Math.max(0, depth - 1);
    if (text[i] === "," && !depth) { items.push(text.slice(start, i).trim()); start = i + 1; }
  }
  items.push(text.slice(start).trim());
  return items;
}
export function paragraphStructures(paragraphs) {
  let inSkills = false;
  return new Map(paragraphs.map((p) => {
    const text = p.text.trim().replace(/\s+/g, " ");
    if (skillsHeading.test(text)) inSkills = true;
    else if (sectionHeading.test(text)) inSkills = false;
    const marker = p.text.match(bullet)?.[1] || "";
    const body = p.text.slice(marker.length);
    const label = body.match(/^([^:\n]{1,65}:\s*)/)?.[1] || "";
    const values = body.slice(label.length);
    const trailingSeparator = values.match(/,\s*$/)?.[0] || "";
    const entries = skillItems(trailingSeparator ? values.slice(0, -trailingSeparator.length) : values);
    const list = (!marker || inSkills) && entries.length >= 2 && entries.every((s) => s.trim() && s.trim().split(/\s+/).length <= 8) &&
      !prose.test(values.trim()) && (inSkills || label || entries.every((s) => s.trim().split(/\s+/).length <= 3));
    return [p.id, { kind: list ? "skills-list" : marker || p.list ? "bullet" : "paragraph", marker, label,
      separator: values.match(/,\s*/)?.[0] || ", ", trailingSeparator, nativeList: Boolean(p.list) }];
  }));
}
export function preserveRewriteStructure(paragraphs, rewrite) {
  const format = paragraphStructures(paragraphs).get(rewrite.paragraphId);
  if (!format) return rewrite;
  let after = rewrite.after.trim().replace(bullet, "");
  if (format.kind === "skills-list") {
    // The generated label may use different spaces around its colon. Keep the
    // source label exactly once, including its original formatting whitespace.
    after = after.replace(/^[^:\n]{1,65}:\s*/, "");
    const entries = skillItems(after.replace(/,\s*$/, ""));
    if (entries.length < 2 || entries.some((s) => !s || s.split(/\s+/).length > 8 || prose.test(s) || /[\n\r]|[.!?](?:\s|$)/.test(s)))
      throw new Error("This skills suggestion changed a list into prose. Request a new suggestion using comma-separated skill names. No edits were applied.");
    after = format.label + entries.join(format.separator) + format.trailingSeparator;
  }
  if (format.marker) after = format.marker + after;
  // Native Word list markers live in paragraph properties, never in text.
  if (format.kind === "paragraph") return rewrite;
  return { ...rewrite, after };
}
export function rewriteFormatHints(paragraphs) {
  return Object.fromEntries([...paragraphStructures(paragraphs)].map(([id, f]) => [id, {
    kind: f.kind,
    ...(f.label ? { label: f.label } : {}),
    instruction: f.kind === "skills-list"
      ? "Return the original label followed by comma-separated skill names or short noun phrases. Preserve the list structure and only use skills evidenced in the resume. Never turn this into a sentence."
      : f.kind === "bullet"
        ? "Keep a single concise achievement bullet. Keep its existing marker if present; do not add a marker to a native Word list."
        : "Keep the source paragraph's structure.",
  }]));
}
