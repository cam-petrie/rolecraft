import React, { useEffect, useState, useRef } from "react";
import {
  Sparkles,
  Target,
  Check,
  ArrowUpRight,
  ArrowRight,
  RotateCcw,
  Archive,
  Eye,
  X,
  ShieldCheck,
  PenLine,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import DocumentViewport from "./DocumentViewport.jsx";
export default function ResumeWorkspace({
  w,
  tab,
  busy,
  selected,
  onSelect,
  onEdit,
  onAnalyze,
  onAccept,
  onAlternative,
  onDismiss,
  onCustom,
  onSaveVersion,
  onRestore,
  onTab,
  roleForm,
}) {
  const [preview, setPreview] = useState(null);
  const panelRef = useRef();
  useEffect(() => {
    setPreview(null);
    panelRef.current?.scrollTo(0, 0);
  }, [w.id, tab]);
  const edits = w.paragraphs.filter(
    (p, i) => p.text !== w.baseline[i]?.text,
  ).length;
  const selectedP = w.paragraphs.find((p) => p.id === selected);
  const stale =
    w.analysis &&
    w.analysis.signature !==
      JSON.stringify({
        paragraphs: w.paragraphs.map((p) => [p.id, p.text]),
        role: w.role,
      });
  const pending =
    w.analysis?.data.rewrites.filter((r, i) => !w.decisions?.[i]).length || 0;
  function apply(r, index) {
    onAccept(r, index);
    setPreview(null);
  }
  function show(r, index) {
    onSelect(r.paragraphId);
    setPreview({ ...r, index });
  }
  return (
    <div className="resume-workbench">
      <div className="workbench-meta">
        <div>
          <span className="workspace-indicator" />{" "}
          <span>
            {w.role.title || "Untitled application"}
            {w.role.company && <strong> / {w.role.company}</strong>}
          </span>
          <span className="workbench-edits">{edits} edited</span>
        </div>
        <div>
          <button className="text-button" onClick={onRestore}>
            <RotateCcw size={13} />
            Restore baseline
          </button>
          <button className="btn" onClick={onSaveVersion}>
            <Archive size={14} />
            Save version
          </button>
        </div>
      </div>
      <div className="workbench-body">
        <DocumentViewport
          key={w.id}
          w={w}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          preview={preview}
          onCancelPreview={() => setPreview(null)}
          onApplyPreview={() => preview && apply(preview, preview.index)}
          initialOriginal={w.kind === "pdf" && tab === "workspace"}
          editingStep={tab === "editor"}
          busy={busy}
        />
        <aside
          className="review-panel"
          aria-label={
            tab === "workspace"
              ? "Target role panel"
              : tab === "analysis"
                ? "Role fit panel"
                : "Resume recommendations"
          }
        >
          <div className="review-panel-heading">
            <div>
              <span className="panel-eyebrow">
                {tab === "workspace"
                  ? "01 / SET YOUR DIRECTION"
                  : tab === "analysis"
                    ? "02 / KNOW YOUR FIT"
                    : "03 / MAKE IT COUNT"}
              </span>
              <h2>
                {tab === "workspace"
                  ? "The opportunity"
                  : tab === "analysis"
                    ? "The hiring-manager view"
                    : "Refine your resume"}
              </h2>
            </div>
            {tab === "editor" && (
              <span className="pending-count">{pending}</span>
            )}
          </div>
          <div className="review-panel-scroll" ref={panelRef}>
            {tab === "workspace" && (
              <>
                <p className="panel-intro">
                  Your resume stays in view. Add the role you’re working toward.
                </p>
                {roleForm}
                <button
                  className="btn primary panel-primary"
                  onClick={onAnalyze}
                  disabled={busy || w.role.text.trim().length < 100}
                >
                  <Sparkles size={15} />
                  Analyze role fit
                  <ArrowRight size={15} />
                </button>
                <div className="panel-tip">
                  <ShieldCheck size={16} />
                  <p>
                    Your original is protected. Click a paragraph on the draft
                    to make a manual edit; save a version whenever you want a
                    checkpoint.
                  </p>
                </div>
              </>
            )}
            {tab === "analysis" &&
              (!w.analysis ? (
                <div className="panel-empty">
                  <Target size={26} />
                  <h3>See where your story fits.</h3>
                  <p>
                    Add a complete role description, then get five matches, five
                    gaps and three focused rewrites.
                  </p>
                  <button
                    className="btn primary"
                    onClick={onAnalyze}
                    disabled={busy}
                  >
                    <Sparkles size={14} />
                    Analyze role fit
                  </button>
                  <button
                    className="text-button"
                    onClick={() => onTab("workspace")}
                  >
                    Edit target role
                    <ArrowUpRight size={13} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="fit-score">
                    <strong>
                      {w.analysis.data.score}
                      <small>/100</small>
                    </strong>
                    <div>
                      <span>RESUME-TO-ROLE FIT</span>
                      <p>Subjective assessment, not an ATS score.</p>
                    </div>
                  </div>
                  {stale && (
                    <div className="panel-warning">
                      <AlertTriangle size={14} />
                      Your resume or role changed. Reanalyze for an updated
                      score.
                    </div>
                  )}
                  <p className="fit-verdict">{w.analysis.data.verdict}</p>
                  <button
                    className="btn panel-primary"
                    onClick={onAnalyze}
                    disabled={busy}
                  >
                    <RotateCcw size={14} />
                    Reanalyze current draft
                  </button>
                  <details className="fit-section" open>
                    <summary>
                      <CheckCircle2 size={16} />
                      <strong>5 strongest matches</strong>
                      <ChevronDown size={15} />
                    </summary>
                    {w.analysis.data.matches.map((m, i) => (
                      <div className="fit-item" key={i}>
                        <span>0{i + 1}</span>
                        <div>
                          <h3>{m.title}</h3>
                          <blockquote>“{m.evidence}”</blockquote>
                          <p>
                            <strong>Role asks:</strong> {m.requirement}
                          </p>
                          <button
                            className="text-button"
                            onClick={() => {
                              const p = w.paragraphs.find((p) =>
                                p.text.includes(m.evidence),
                              );
                              if (p) onSelect(p.id);
                            }}
                          >
                            <Eye size={12} />
                            Locate evidence
                          </button>
                        </div>
                      </div>
                    ))}
                  </details>
                  <details className="fit-section" open>
                    <summary>
                      <AlertTriangle size={16} />
                      <strong>5 screening risks</strong>
                      <ChevronDown size={15} />
                    </summary>
                    {w.analysis.data.gaps.map((g, i) => (
                      <div className="fit-item" key={i}>
                        <span>0{i + 1}</span>
                        <div>
                          <h3>{g.title}</h3>
                          <p>{g.reason}</p>
                          <div className="gap-action">{g.action}</div>
                        </div>
                      </div>
                    ))}
                  </details>
                  <button
                    className="btn primary panel-primary"
                    onClick={() => onTab("editor")}
                  >
                    <PenLine size={14} />
                    Review the 3 rewrites
                    <ArrowRight size={14} />
                  </button>
                </>
              ))}
            {tab === "editor" && (
              <>
                <p className="panel-intro">
                  Click your resume to edit directly. Preview suggestions on the
                  page, then apply the ones you want.
                </p>
                {selectedP && (
                  <div className="selected-context">
                    <div>
                      <span className="panel-eyebrow">SELECTED PARAGRAPH</span>
                      <button
                        className="icon-btn"
                        onClick={() => onSelect("")}
                        aria-label="Clear selected paragraph"
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <p>{selectedP.text || "Empty paragraph"}</p>
                    {selectedP.editable ? (
                      <button
                        className="text-button"
                        onClick={() => onCustom(selectedP)}
                        disabled={busy}
                      >
                        <Sparkles size={13} />
                        Ask for a specific change
                        <ArrowUpRight size={12} />
                      </button>
                    ) : (
                      <small>
                        This paragraph contains complex Word content and is
                        protected.
                      </small>
                    )}
                  </div>
                )}
                {!w.analysis ? (
                  <div className="panel-empty">
                    <Sparkles size={24} />
                    <h3>A second pair of eyes.</h3>
                    <p>
                      Run an analysis to get three targeted recommendations. You
                      can edit the draft on the page at any time.
                    </p>
                    <button
                      className="btn primary"
                      onClick={onAnalyze}
                      disabled={busy}
                    >
                      Analyze role fit
                    </button>
                  </div>
                ) : (
                  w.analysis.data.rewrites.map((r, i) => {
                    const status = w.decisions?.[i],
                      unchanged =
                        w.paragraphs.find((p) => p.id === r.paragraphId)
                          ?.text === r.before;
                    return (
                      <section
                        className={`recommendation ${selected === r.paragraphId ? "targeted" : ""}`}
                        key={i}
                      >
                        <div className="recommendation-heading">
                          <button onClick={() => onSelect(r.paragraphId)}>
                            <span>0{i + 1}</span>{" "}
                            {status === "accepted"
                              ? "Applied to your resume"
                              : status === "dismissed"
                                ? "Dismissed"
                                : "Suggested rewrite"}
                          </button>
                          {status === "accepted" && <CheckCircle2 size={15} />}
                        </div>
                        <div className="recommendation-before">
                          <span>BEFORE</span>
                          <p>{r.before}</p>
                        </div>
                        <div className="recommendation-after">
                          <span>SUGGESTED</span>
                          <p>{r.after}</p>
                        </div>
                        <p className="recommendation-reason">{r.reason}</p>
                        {!status && (
                          <>
                            <div className="recommendation-actions">
                              <button
                                className="btn primary"
                                onClick={() => apply(r, i)}
                                disabled={!unchanged || busy}
                              >
                                <Check size={13} />
                                Apply edit
                              </button>
                              <button
                                className="btn"
                                onClick={() => show(r, i)}
                                disabled={!unchanged || busy}
                              >
                                <Eye size={13} />
                                Show in resume
                              </button>
                            </div>
                            <div className="recommendation-secondary">
                              <button
                                className="text-button"
                                onClick={() => onAlternative(r, i)}
                                disabled={busy}
                              >
                                Request another
                                <RotateCcw size={11} />
                              </button>
                              <button
                                className="text-button"
                                onClick={() => {
                                  onDismiss(i);
                                  if (preview?.index === i) setPreview(null);
                                }}
                              >
                                Dismiss
                              </button>
                            </div>
                            {!unchanged && (
                              <small className="amber">
                                This paragraph changed. Request another
                                suggestion.
                              </small>
                            )}
                          </>
                        )}
                      </section>
                    );
                  })
                )}
                <button
                  className="btn panel-primary"
                  onClick={() => onTab("prep")}
                >
                  Continue to interview prep
                  <ArrowRight size={14} />
                </button>
              </>
            )}
          </div>
          <div className="panel-bottom-note">
            <ShieldCheck size={12} />
            <span>You approve every suggested change.</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
