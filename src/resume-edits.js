import { applyRewrite } from "../shared/contracts.js";
import { normalizeInlineEdit } from "./document-markers.js";
import { paragraphStructures } from "../shared/resume-structure.js";
export function editParagraph(paragraphs, id, before, text) {
  const after = normalizeInlineEdit(text);
  if (after.length > 12000) throw new Error("A paragraph cannot exceed 12,000 characters.");
  // Manual and AI edits pass through the same source/format checks.
  if (!after.trim()) {
    const source = paragraphs.find((p) => p.id === id);
    if (!source?.editable || source.text !== before) throw new Error("This paragraph changed. Reopen it before editing.");
    return paragraphs.map((p) => p.id === id ? { ...p, text: "" } : p);
  }
  let updated;
  try { updated = applyRewrite(paragraphs, { paragraphId: id, before, after }, { allowSingleSkill: true }); }
  catch (error) {
    if (/skills suggestion changed a list into prose/.test(error.message))
      throw new Error("This skills edit would change a list into prose. Use comma-separated skill names. Your saved draft is unchanged.");
    throw error;
  }
  const format = paragraphStructures(paragraphs).get(id);
  const label = after.replace(/^[•●○▪▫◦‣⁃\uf0b7\uf0a7\u25a0\u25a1–—*-]\s*/, "").match(/^([^:\n]{1,65}:\s*)/)?.[1];
  // A person may intentionally rename a skill category; AI suggestions may not.
  if (format?.kind === "skills-list" && format.label && label)
    return updated.map((p) => p.id === id ? { ...p, text: format.marker + label + p.text.slice((format.marker + format.label).length) } : p);
  return updated;
}
export function editOperation(before, after, decisionsBefore, decisionsAfter) {
  return { changes: before.filter((p, i) => p.text !== after[i]?.text).map((p) => ({ id: p.id, before: p.text, after: after.find((v) => v.id === p.id).text })),
    decisionsBefore: { ...decisionsBefore }, decisionsAfter: { ...decisionsAfter } };
}
export function replayEdit(paragraphs, operation, direction) {
  const undo = direction === "undo";
  for (const change of operation.changes) {
    const p = paragraphs.find((p) => p.id === change.id);
    if (!p?.editable || p.text !== change[undo ? "after" : "before"]) throw new Error("The draft changed after this edit. Undo is no longer safe.");
  }
  return paragraphs.map((p) => {
    const change = operation.changes.find((v) => v.id === p.id);
    return change ? { ...p, text: change[undo ? "before" : "after"] } : p;
  });
}
export function replayDecisions(current, operation, direction) {
  const decisions = { ...current };
  for (const key of Object.keys({ ...operation.decisionsBefore, ...operation.decisionsAfter })) {
    if (operation.decisionsBefore[key] === operation.decisionsAfter[key]) continue;
    const value = (direction === "undo" ? operation.decisionsBefore : operation.decisionsAfter)[key];
    if (value === undefined) delete decisions[key]; else decisions[key] = value;
  }
  return decisions;
}
