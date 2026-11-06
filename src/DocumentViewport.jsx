import React, { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import {
  FileText,
  Minus,
  Plus,
  ShieldCheck,
  LoaderCircle,
  RotateCcw,
  Check,
  Eye,
  Undo2,
  Redo2,
  X,
} from "lucide-react";
import { exportResume } from "./documents.js";
import { attachInlineEditor, captureCaret, restoreCaret } from "./inline-editor.js";
import { alignPdfTabs } from "./pdf-preview.js";
import { hasResumeLayout, selectedResumeLayout } from "./resume-layouts.js";
import {
  markPreviewParagraphs,
  canEditRenderedParagraph,
  renderedParagraphText,
  wrapTemplateSource,
} from "./document-markers.js";
function OriginalPdf({ original }) {
  const ref = useRef();
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false,
      pdf;
    const tasks = [];
    const target = ref.current;
    target.replaceChildren();
    (async () => {
      try {
        const lib = await import("pdfjs-dist");
        lib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).href;
        pdf = await lib.getDocument({
          data: original.slice(0),
          isEvalSupported: false,
        }).promise;
        for (let i = 1; i <= pdf.numPages && !cancelled; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.4 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.setAttribute("aria-label", `Original PDF page ${i}`);
          canvas.setAttribute("role", "img");
          // PDF geometry is in points; Word previews use CSS pixels (96 / 72).
          canvas.style.width = ((viewport.width / 1.4) * 4) / 3 + "px";
          canvas.style.height = ((viewport.height / 1.4) * 4) / 3 + "px";
          if (cancelled) break;
          target.append(canvas);
          const task = page.render({
            canvasContext: canvas.getContext("2d"),
            viewport,
          });
          tasks.push(task);
          await task.promise;
        }
      } catch (e) {
        if (!cancelled)
          setError(
            "The original PDF could not be displayed. You can still download the original file.",
          );
      }
    })();
    return () => {
      cancelled = true;
      tasks.forEach((t) => t.cancel());
      pdf?.destroy();
    };
  }, [original]);
  return (
    <>
      {error && <div className="notice error">{error}</div>}
      <div className="pdf-source-pages" ref={ref} />
    </>
  );
}
export default function DocumentViewport({
  w,
  selected,
  onSelect,
  onEdit,
  onDraft,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  editRevision,
  preview,
  onCancelPreview,
  onApplyPreview,
  initialOriginal = false,
  editingStep = false,
  busy = false,
}) {
  const host = useRef(),
    stage = useRef(),
    handlers = useRef();
  handlers.current = { onSelect, onEdit, onDraft };
  const draft = useRef(null), deferredRender = useRef(false);
  const [renderRevision, forceRender] = useState(0);
  useEffect(() => () => { draft.current?.cancel(); handlers.current.onDraft?.(null); }, []);
  const [zoom, setZoom] = useState(100),
    [original, setOriginal] = useState(initialOriginal),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [mapped, setMapped] = useState(0);
  const [fit, setFit] = useState(false);
  const [pageWidth, setPageWidth] = useState(816);
  const [available, setAvailable] = useState(900);
  useEffect(() => {
    setOriginal(initialOriginal);
    setEditing(false);
    if (stage.current) stage.current.scrollTop = 0;
  }, [w.id]);
  useEffect(() => {
    if (editingStep || preview) setOriginal(false);
  }, [editingStep, preview]);
  useEffect(() => {
    // Disable the existing DOM immediately, before asynchronous re-rendering.
    if (busy) for (const el of host.current?.querySelectorAll("[data-resume-id]") || []) {
      el.dataset.editable = "false";
      el.setAttribute("contenteditable", "false");
      el.setAttribute("aria-readonly", "true");
    }
  }, [busy]);
  useEffect(() => { if (hasResumeLayout(w)) setOriginal(false); }, [w.resumeLayout]);
  const customLayout = !original && hasResumeLayout(w);
  const sourceMarkers = w.kind === "pdf" || customLayout;
  const pdfOriginal = w.kind === "pdf" && original;
  const renderedParagraphs = original
    ? w.baseline
    : preview
      ? w.paragraphs.map((p) =>
          p.id === preview.paragraphId ? { ...p, text: preview.after } : p,
        )
      : w.paragraphs;
  const signature = JSON.stringify(
    renderedParagraphs.map((p) => [p.id, p.text]),
  );
  const suggestedParagraphIds = new Set();
  if (editingStep && !original && !preview && w.analysis?.signature) {
    try {
      const analyzedRole = JSON.parse(w.analysis.signature).role;
      if (JSON.stringify(analyzedRole) === JSON.stringify(w.role)) {
        w.analysis.data.rewrites.forEach((rewrite, index) => {
          const source = w.paragraphs.find((p) => p.id === rewrite.paragraphId);
          if (!w.decisions?.[index] && source?.editable && source.text === rewrite.before)
            suggestedParagraphIds.add(source.id);
        });
      }
    } catch {
      // Ignore malformed or outdated analysis metadata.
    }
  }
  const suggestedParagraphKey = [...suggestedParagraphIds].sort().join(",");
  useEffect(() => {
    const ob = new ResizeObserver((entries) =>
      setAvailable(entries[0].contentRect.width),
    );
    if (stage.current) ob.observe(stage.current);
    return () => ob.disconnect();
  }, []);
  useEffect(() => {
    if (pdfOriginal) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const target = host.current;
    setLoading(true);
    setError("");
    const prefix = "rc_" + crypto.randomUUID().replace(/-/g, "") + "_";
    (async () => {
      try {
        const blob = await exportResume(original ? { ...w, resumeLayout: "original" } : w, renderedParagraphs);
        const zip = await JSZip.loadAsync(await blob.arrayBuffer());
        const xml = await zip.file("word/document.xml").async("string");
        // Rebuilt PDF/demo documents have sequential paragraph IDs; original DOCX IDs are XML indices.
        const sourceIds =
          w.kind === "docx"
            ? renderedParagraphs
            : renderedParagraphs.map((p, i) => ({ ...p, id: "p" + i }));
        const pdfMarkers = new Map();
        if (sourceMarkers) {
          const doc = new DOMParser().parseFromString(xml, "application/xml");
          const ns =
            "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
          Array.from(doc.getElementsByTagNameNS(ns, "p")).forEach(
            (el, index) => {
              for (const bookmark of el.getElementsByTagNameNS(
                ns,
                "bookmarkStart",
              )) {
                const name = bookmark.getAttributeNS(ns, "name");
                if (name?.startsWith("rolecraft_source_"))
                  pdfMarkers.set(name.slice(17), "p" + index);
              }
            },
          );
        }
        if (!customLayout) zip.file(
          "word/document.xml",
          markPreviewParagraphs(
            xml,
            sourceMarkers
              ? renderedParagraphs.map((p) => ({
                  ...p,
                  id: pdfMarkers.get(p.id),
                }))
              : sourceIds,
            prefix,
          ),
        );
        const bytes = await zip.generateAsync({ type: "arraybuffer" });
        const { renderAsync } = await import("docx-preview");
        const detached = document.createElement("div");
        await renderAsync(bytes, detached, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          useBase64URL: true,
          renderAltChunks: false,
          renderComments: false,
          experimental: w.kind === "pdf",
        });
        if (cancelled) return;
        if (draft.current?.dirty) { deferredRender.current = true; return; }
        const active = target.contains(document.activeElement) ? document.activeElement.closest("[data-resume-id]") : null;
        const activeId = active?.dataset.resumeId;
        const caret = active ? captureCaret(active) : null;
        draft.current?.save();
        const previousScroll = stage.current?.scrollTop || 0;
        target.replaceChildren(...detached.childNodes);
        let count = 0;
        renderedParagraphs.forEach((p, i) => {
          const marker = customLayout ? target.querySelector('[id="rolecraft_source_' + p.id + '"]') : target.querySelector(
            '[id="' +
              prefix +
              (sourceMarkers ? pdfMarkers.get(p.id) : w.kind === "docx" ? p.id : "p" + i) +
              '"]',
          );
          const el = customLayout ? wrapTemplateSource(marker) : marker?.closest("p");
          if (!el) return;
          el.dataset.resumeId = p.id;
          const editable =
            !original &&
            !preview &&
            !busy &&
            canEditRenderedParagraph(
              p,
              renderedParagraphText(el, w.kind === "pdf"),
            );
          if (editable) count++;
          el.setAttribute("tabindex", "0");
          el.setAttribute("role", "textbox");
          el.setAttribute("aria-label", `Resume paragraph ${i + 1}`);
          el.setAttribute("aria-readonly", String(!editable));
          el.setAttribute("aria-multiline", "false");
          el.setAttribute("contenteditable", String(editable));
          el.setAttribute("spellcheck", "true");
          el.dataset.editable = String(editable);
          el.dataset.suggestedEdit = String(suggestedParagraphIds.has(p.id));
          if (p.text !== w.baseline[i]?.text)
            el.classList.add("resume-paragraph-changed");
          if (preview?.paragraphId === p.id)
            el.classList.add("resume-paragraph-preview");
          attachInlineEditor(el, p, {
            getText: () => renderedParagraphText(el, w.kind === "pdf"),
            onSelect: (id) => handlers.current.onSelect(id),
            onCommit: (id, text, before) => handlers.current.onEdit(id, text, before),
            onSession: (session) => { draft.current = session; setEditing(Boolean(session)); handlers.current.onDraft?.(session); },
            onError: setError,
            onSettled: () => { if (deferredRender.current) { deferredRender.current = false; forceRender((n) => n + 1); } },
          });
        });
        if (activeId) {
          const next = [...target.querySelectorAll("[data-resume-id]")].find((el) => el.dataset.resumeId === activeId);
          if (next?.dataset.editable === "true") { next.focus({ preventScroll: true }); restoreCaret(next, caret); }
        }
        setMapped(count);
        setPageWidth(target.querySelector("section.docx")?.offsetWidth || 816);
        if (stage.current) stage.current.scrollTop = previousScroll;
        if (w.kind === "pdf") {
          await new Promise((resolve) => setTimeout(resolve, 550));
          if (!cancelled) alignPdfTabs(target);
        }
      } catch (e) {
        if (!cancelled)
          setError(
            "The document preview could not be rendered. Your saved resume is unchanged. " +
              e.message,
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [w.id, signature, original, Boolean(preview), busy, pdfOriginal, w.resumeLayout, suggestedParagraphKey, renderRevision, editRevision]);
  useEffect(() => {
    const all = host.current?.querySelectorAll("[data-resume-id]") || [];
    for (const el of all) {
      const active = el.dataset.resumeId === selected;
      el.classList.toggle("resume-paragraph-selected", active);
      if (active && document.activeElement !== el)
        el.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          behavior: "smooth",
        });
    }
  }, [selected, loading]);
  const scale = fit
    ? Math.min(zoom / 100, Math.max(0.28, (available - 48) / pageWidth))
    : zoom / 100;
  return (
    <section
      className={`document-viewport ${editingStep ? "editing-step" : ""}`}
      aria-label="Resume document viewport"
    >
      <div className="document-toolbar">
        <div className="document-identity">
          <FileText size={16} />
          <strong>{w.filename}</strong>
          <span className="doc-state">
            {original
              ? "Original · read only"
              : preview
                ? "Previewing a suggestion"
                : editing
                  ? "Editing paragraph"
                  : "Editable draft"}
          </span>
          {suggestedParagraphIds.size > 0 && (
            <span className="suggestion-legend">
              <span aria-hidden="true" /> Suggested edits
            </span>
          )}
        </div>
        <div className="document-controls">
          {!original && !preview && <>
            <button className="icon-btn" aria-label="Undo resume edit" disabled={busy || !canUndo} onClick={onUndo}><Undo2 size={14}/></button>
            <button className="icon-btn" aria-label="Redo resume edit" disabled={busy || !canRedo} onClick={onRedo}><Redo2 size={14}/></button>
          </>}
          <button
            className="icon-btn"
            aria-label="Zoom out"
            onClick={() => {
              setFit(false);
              setZoom(Math.max(30, Math.round(scale * 100) - 10));
            }}
          >
            <Minus size={14} />
          </button>
          <button
            className="zoom-fit"
            title="Fit page to viewport"
            aria-label="Fit page to viewport"
            onClick={() => {
              setFit(true);
              setZoom(100);
            }}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            className="icon-btn"
            aria-label="Zoom in"
            onClick={() => {
              setFit(false);
              setZoom(Math.min(150, Math.round(scale * 100) + 10));
            }}
          >
            <Plus size={14} />
          </button>
          <span className="toolbar-divider" />
          <button
            className={original ? "view-toggle active" : "view-toggle"}
            onClick={() => {
              if (draft.current && !draft.current.save()) return;
              setOriginal((v) => !v);
              onCancelPreview();
            }}
            disabled={Boolean(preview)}
          >
            <Eye size={14} />
            {original ? "Return to draft" : "View original"}
          </button>
        </div>
      </div>
      {editing && <div className="inline-preview-bar inline-edit-actions">
        <span>Editing a paragraph · Enter saves · Escape cancels</span>
        <div><button onMouseDown={(e) => e.preventDefault()} onClick={() => { draft.current?.cancel(); document.activeElement?.blur(); }}><X size={13}/>Cancel edit</button>
        <button className="apply-preview" onMouseDown={(e) => e.preventDefault()} onClick={() => { if (draft.current?.save()) document.activeElement?.blur(); }}><Check size={13}/>Save edit</button></div>
      </div>}
      {preview && (
        <div className="inline-preview-bar">
          <span>
            <Sparkle /> Suggested wording preview. Your draft has not changed.
          </span>
          <div>
            <button onClick={onCancelPreview}>Cancel preview</button>
            <button
              className="apply-preview"
              onClick={onApplyPreview}
              disabled={busy}
            >
              <Check size={13} />
              Apply edit
            </button>
          </div>
        </div>
      )}
      {(w.kind === "pdf" || customLayout) && (
        <div className="pdf-layout-notice">
          {customLayout ? `${selectedResumeLayout(w.resumeLayout).name} layout · your current edits in a new format. Change the layout anytime in Refine.` : original
            ? "Original PDF · switch to the draft to edit."
            : "PDF draft · typography, colors, spacing and simple columns recovered from the original. Check View original; complex graphics and exact pagination may differ."}
        </div>
      )}
      <div className="paper-stage" ref={stage}>
        {loading && (
          <div className="paper-loading">
            <LoaderCircle size={22} className="spin" />
            <span>Preparing your resume…</span>
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="paper-scale" style={{ zoom: scale }}>
          {pdfOriginal ? (
            <OriginalPdf original={w.original} />
          ) : (
            <div
              className="resume-sheet"
              ref={host}
              onClick={(e) => {
                if (e.target.closest("a")) e.preventDefault();
              }}
            />
          )}
        </div>
      </div>
      <div className="document-status">
        <span>
          <ShieldCheck size={13} /> Original protected
        </span>
        <span>
          {original
            ? "Original file view"
            : preview
              ? "Review before applying"
              : `${mapped} editable paragraphs · click to edit · Enter to save · Esc to cancel`}
        </span>
        <span>Word pagination may vary</span>
      </div>
    </section>
  );
}
function Sparkle() {
  return <span aria-hidden="true">✦</span>;
}
