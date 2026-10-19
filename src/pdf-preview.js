// docx-preview's tab calculation uses screen pixels, which drift when the resume
// viewport is zoomed. Measure intrinsic text widths in the document's own units.
export function alignPdfTabs(root) {
  for (const tab of root.querySelectorAll(".docx-tab-stop")) {
    const p = tab.closest("p");
    const scale = p.getBoundingClientRect().width / p.offsetWidth;
    if (!scale) continue;
    const doc = p.ownerDocument;
    const measure = (fragment) => {
      const span = doc.createElement("span");
      span.style.cssText =
        "position:absolute;visibility:hidden;white-space:pre;width:max-content";
      span.append(fragment);
      p.append(span);
      const width = span.getBoundingClientRect().width / scale;
      span.remove();
      return width;
    };
    const before = doc.createRange();
    before.setStart(p, 0);
    before.setEndBefore(tab);
    const after = doc.createRange();
    after.setStartAfter(tab);
    after.setEnd(p, p.childNodes.length);
    const gap = Math.max(
      0,
      p.clientWidth -
        measure(before.cloneContents()) -
        measure(after.cloneContents()) -
        1,
    );
    tab.textContent = "";
    tab.style.display = "inline-block";
    tab.style.width = gap + "px";
    tab.style.wordSpacing = "0";
  }
}
