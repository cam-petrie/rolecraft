import { normalizeInlineEdit } from "./document-markers.js";

// A paragraph draft stays in its DOM until commit succeeds or the user cancels.
// In particular, a failed save must not silently discard what was typed.
export function attachInlineEditor(el, source, { getText = () => el.textContent || "", onSelect, onCommit, onSession, onError, onSettled }) {
  let active = false, composing = false, originalHTML = "";
  const session = {
    element: el,
    get dirty() { return active && normalizeInlineEdit(getText()) !== source.text; },
    save() {
      if (!active) return true;
      if (composing) { onError("Finish composing the text before saving or continuing."); return false; }
      try {
        const text = normalizeInlineEdit(getText());
        if (text.length > 12000) throw new Error("A paragraph cannot exceed 12,000 characters.");
        const committed = text === source.text ? text : onCommit(source.id, text, source.text);
        if (typeof committed === "string" && committed !== text) el.textContent = committed;
        active = false;
        onError("");
        onSession(null);
        onSettled();
        return true;
      } catch (e) { onError(e.message || "This edit could not be saved. Correct it or cancel."); return false; }
    },
    cancel() {
      if (!active) return;
      el.innerHTML = originalHTML;
      composing = false;
      active = false;
      onError("");
      onSession(null);
      onSettled();
    },
  };
  el.addEventListener("focus", () => {
    onSelect(source.id);
    if (el.dataset.editable !== "true") return;
    if (!active) { active = true; originalHTML = el.innerHTML; }
    onSession(session);
  });
  el.addEventListener("click", (e) => { if (e.target.closest("a")) e.preventDefault(); onSelect(source.id); });
  el.addEventListener("beforeinput", (e) => {
    if (el.dataset.editable !== "true" || ["insertParagraph", "insertLineBreak"].includes(e.inputType) || e.inputType?.startsWith("format")) e.preventDefault();
  });
  el.addEventListener("compositionstart", () => { composing = true; });
  el.addEventListener("compositionend", () => { composing = false; });
  el.addEventListener("keydown", (e) => {
    if (composing || e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") { e.preventDefault(); if (session.save()) el.blur(); }
    if (e.key === "Escape") { e.preventDefault(); session.cancel(); el.blur(); }
    if ((e.ctrlKey || e.metaKey) && ["b", "i", "u"].includes(e.key.toLowerCase())) e.preventDefault();
  });
  el.addEventListener("paste", (e) => {
    e.preventDefault();
    if (el.dataset.editable !== "true") return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const node = document.createTextNode(normalizeInlineEdit(e.clipboardData.getData("text/plain")));
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  });
  el.addEventListener("drop", (e) => e.preventDefault());
  el.addEventListener("blur", () => {
    if (!session.save()) queueMicrotask(() => { if (el.isConnected) el.focus(); });
  });
  return session;
}
export function captureCaret(el) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !el.contains(selection.anchorNode) || !el.contains(selection.focusNode)) return null;
  const range = selection.getRangeAt(0);
  const prefix = range.cloneRange();
  prefix.selectNodeContents(el);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  return { start, end: start + range.toString().length };
}
export function restoreCaret(el, offsets) {
  if (!offsets) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  if (!nodes.length) return;
  const locate = (offset) => {
    for (const node of nodes) { if (offset <= node.textContent.length) return [node, offset]; offset -= node.textContent.length; }
    const last = nodes[nodes.length - 1]; return [last, last.textContent.length];
  };
  const range = document.createRange();
  range.setStart(...locate(offsets.start)); range.setEnd(...locate(offsets.end));
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
}
