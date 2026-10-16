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
} from "lucide-react";
import { exportResume } from "./documents.js";
import {
  markPreviewParagraphs,
  normalizeInlineEdit,
  canEditRenderedParagraph,
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
          canvas.style.width = viewport.width / 1.4 + "px";
          canvas.style.height = viewport.height / 1.4 + "px";
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
  handlers.current = { onSelect, onEdit };
  const [zoom, setZoom] = useState(90),
    [original, setOriginal] = useState(initialOriginal),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [mapped, setMapped] = useState(0);
  const [fit, setFit] = useState(true);
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
        const blob = await exportResume(w, renderedParagraphs);
        const zip = await JSZip.loadAsync(await blob.arrayBuffer());
        const xml = await zip.file("word/document.xml").async("string");
        // Rebuilt PDF/demo documents have sequential paragraph IDs; original DOCX IDs are XML indices.
        const sourceIds =
          w.kind === "docx"
            ? renderedParagraphs
            : renderedParagraphs.map((p, i) => ({ ...p, id: "p" + i }));
        zip.file(
          "word/document.xml",
          markPreviewParagraphs(xml, sourceIds, prefix),
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
        });
        if (cancelled) return;
        const previousScroll = stage.current?.scrollTop || 0;
        target.replaceChildren(...detached.childNodes);
        let count = 0;
        renderedParagraphs.forEach((p, i) => {
          const marker = target.querySelector(
            '[id="' + prefix + (w.kind === "docx" ? p.id : "p" + i) + '"]',
          );
          const el = marker?.closest("p");
          if (!el) return;
          el.dataset.resumeId = p.id;
          const editable =
            !original &&
            !preview &&
            !busy &&
            canEditRenderedParagraph(p, el.textContent);
          if (editable) count++;
          el.setAttribute("tabindex", "0");
          el.setAttribute("role", "textbox");
          el.setAttribute("aria-label", `Resume paragraph ${i + 1}`);
          el.setAttribute("aria-readonly", String(!editable));
          el.setAttribute("aria-multiline", "false");
          el.setAttribute("contenteditable", String(editable));
          el.setAttribute("spellcheck", "true");
          el.dataset.editable = String(editable);
          if (p.text !== w.baseline[i]?.text)
            el.classList.add("resume-paragraph-changed");
          if (preview?.paragraphId === p.id)
            el.classList.add("resume-paragraph-preview");
          let html;
          el.addEventListener("focus", () => {
            handlers.current.onSelect(p.id);
            html = el.innerHTML;
            if (editable) setEditing(true);
          });
          el.addEventListener("click", (e) => {
            if (e.target.closest("a")) e.preventDefault();
            handlers.current.onSelect(p.id);
          });
          el.addEventListener("beforeinput", (e) => {
            if (
              e.inputType === "insertParagraph" ||
              e.inputType === "insertLineBreak" ||
              e.inputType?.startsWith("format")
            )
              e.preventDefault();
          });
          el.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              el.blur();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              el.innerHTML = html;
              el.blur();
            }
            if (
              (e.ctrlKey || e.metaKey) &&
              ["b", "i", "u"].includes(e.key.toLowerCase())
            )
              e.preventDefault();
          });
          el.addEventListener("paste", (e) => {
            e.preventDefault();
            if (!editable) return;
            const text = normalizeInlineEdit(
              e.clipboardData.getData("text/plain"),
            );
            const selection = window.getSelection();
            if (!selection?.rangeCount) return;
            const range = selection.getRangeAt(0);
            if (!el.contains(range.commonAncestorContainer)) return;
            range.deleteContents();
            const node = document.createTextNode(text);
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
          });
          el.addEventListener("drop", (e) => e.preventDefault());
          el.addEventListener("blur", () => {
            setEditing(false);
            if (!editable) return;
            const text = normalizeInlineEdit(el.textContent || "");
            if (text.length > 12000) {
              el.innerHTML = html;
              setError(
                "A paragraph cannot exceed 12,000 characters. Your draft was not changed.",
              );
              return;
            }
            if (text !== p.text) handlers.current.onEdit(p.id, text);
          });
        });
        setMapped(count);
        setPageWidth(target.querySelector("section.docx")?.offsetWidth || 816);
        if (stage.current) stage.current.scrollTop = previousScroll;
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
  }, [w.id, signature, original, Boolean(preview), busy, pdfOriginal]);
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
      className="document-viewport"
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
        </div>
        <div className="document-controls">
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
      {w.kind === "pdf" && (
        <div className="pdf-layout-notice">
          {original
            ? "Original PDF · switch to the draft to edit."
            : "PDF draft · text edits use a rebuilt Word layout; the original PDF remains protected."}
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
