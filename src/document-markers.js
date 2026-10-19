const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
// Mark only the disposable preview copy. The downloaded document is never annotated.
export function markPreviewParagraphs(xml, paragraphs, prefix) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const all = Array.from(doc.getElementsByTagNameNS(W, "p"));
  const ids = new Set(paragraphs.map((p) => p.id));
  all.forEach((p, i) => {
    if (!ids.has("p" + i)) return;
    const start = doc.createElementNS(W, "w:bookmarkStart");
    start.setAttributeNS(W, "w:id", String(2000000000 + i));
    start.setAttributeNS(W, "w:name", prefix + "p" + i);
    const end = doc.createElementNS(W, "w:bookmarkEnd");
    end.setAttributeNS(W, "w:id", String(2000000000 + i));
    const props = Array.from(p.childNodes).find(
      (n) => n.namespaceURI === W && n.localName === "pPr",
    );
    p.insertBefore(start, props ? props.nextSibling : p.firstChild);
    p.insertBefore(end, start.nextSibling);
  });
  return new XMLSerializer().serializeToString(doc);
}
export function normalizeInlineEdit(text) {
  return text.replace(/[\r\n\u2028\u2029]+/g, " ");
}
export function renderedParagraphText(element, ignoreLayoutTabs = false) {
  if (!ignoreLayoutTabs) return element.textContent || "";
  const copy = element.cloneNode(true);
  for (const span of Array.from(copy.getElementsByTagName("span"))) {
    if ((" " + span.getAttribute("class") + " ").includes(" docx-tab-stop "))
      span.parentNode?.removeChild(span);
  }
  return copy.textContent || "";
}
export function canEditRenderedParagraph(source, renderedText) {
  return Boolean(
    source?.editable &&
      !/[\r\n\u2028\u2029]/.test(source.text) &&
      source.text === renderedText,
  );
}
