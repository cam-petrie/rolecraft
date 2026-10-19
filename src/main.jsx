import React, { useState, useEffect, useRef, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Upload,
  FileText,
  Target,
  Sparkles,
  PenLine,
  GraduationCap,
  History,
  Settings,
  Plus,
  Check,
  ChevronRight,
  Download,
  ShieldCheck,
  RotateCcw,
  X,
  LoaderCircle,
  Link2,
  Copy,
  Trash2,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Archive,
  FolderOpen,
  Braces,
} from "lucide-react";
import {
  importResume,
  exportResume,
  download,
  printResume,
  extractDocx,
} from "./documents.js";
import { createWorkspaceStore, toBackup, fromBackup } from "./storage.js";
import { callAI, gateway } from "./api.js";
import { createDemo, demoAnalysis, demoPrep } from "./demo.js";
import { alignPdfTabs } from "./pdf-preview.js";
import { signature, applyRewrite } from "../shared/contracts.js";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./styles.css";
import ResumeWorkspace from "./ResumeWorkspace.jsx";
import { AuthProvider, useAuth, AccountStatus, AuthPanel } from "./auth.jsx";
const steps = [
  {
    id: "workspace",
    title: "Your workspace",
    short: "Start",
    icon: FolderOpen,
  },
  { id: "analysis", title: "Role fit", short: "Analyze", icon: Target },
  { id: "editor", title: "Resume studio", short: "Refine", icon: PenLine },
  {
    id: "prep",
    title: "Interview prep",
    short: "Prepare",
    icon: GraduationCap,
  },
  { id: "history", title: "Version history", short: "Versions", icon: History },
];
const clone = (x) => structuredClone(x);
const date = (x) =>
  new Date(x).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
function Button({ children, variant = "", icon: Icon, ...props }) {
  return (
    <button className={`btn ${variant}`} {...props}>
      {Icon && <Icon size={16} />}
      <span>{children}</span>
    </button>
  );
}
function Pill({ children, kind = "" }) {
  return <span className={`pill ${kind}`}>{children}</span>;
}
function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current;
    d.showModal();
    const prev = document.activeElement;
    return () => {
      d.close();
      prev?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "wide" : ""}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-top">
        <h2>{title}</h2>
        <button
          className="icon-btn"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function DocPreview({ w }) {
  const ref = useRef();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const target = ref.current;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const blob = await exportResume(w);
        const { renderAsync } = await import("docx-preview");
        if (cancelled) return;
        target.replaceChildren();
        await renderAsync(blob, target, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          useBase64URL: true,
          experimental: w.kind === "pdf",
        });
        if (w.kind === "pdf") {
          await new Promise((resolve) => setTimeout(resolve, 550));
          if (!cancelled) alignPdfTabs(target);
        }
      } catch (e) {
        if (!cancelled)
          setError(
            "Preview could not be rendered. Open the DOCX in Word and check its layout before submitting. " +
              e.message,
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [w]);
  return (
    <>
      <div className="preview-note">
        <FileText size={15} />{" "}
        {w.kind === "docx"
          ? "Word layout preview · pagination may differ from Microsoft Word"
          : w.kind === "pdf"
            ? "Styled PDF draft · compare with the original before submitting"
            : "Document preview"}
      </div>
      {loading && (
        <p className="loading">
          <LoaderCircle className="spin" size={18} /> Rendering document…
        </p>
      )}
      {error && <div className="notice warning">{error}</div>}
      <div className="document-preview" ref={ref} />
    </>
  );
}
function App() {
  const [items, setItems] = useState([]),
    [w, setW] = useState(null),
    [ready, setReady] = useState(false),
    [tab, setTab] = useState("workspace");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [modal, setModal] = useState(null),
    [saved, setSaved] = useState(true);
  const auth = useAuth();
  const config = auth.config;
  const { listWorkspaces, saveWorkspace, deleteWorkspace } = useMemo(
    () => createWorkspaceStore(auth.session?.user.id),
    [auth.session?.user.id],
  );
  const [selected, setSelected] = useState(""),
    [versionName, setVersionName] = useState(""),
    [direction, setDirection] = useState(""),
    [filter, setFilter] = useState("all");
  const fileRef = useRef(),
    backupRef = useRef(),
    liveW = useRef(w);
  liveW.current = w;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab, w?.id]);
  useEffect(() => {
    listWorkspaces()
      .then((all) => {
        all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setItems(all);
        setW(all[0] || null);
        setReady(true);
      })
      .catch((e) => {
        setError(
          "Browser storage is unavailable. Enable local storage to use Rolecraft. " +
            e.message,
        );
        setReady(true);
      });
  }, []);
  async function persist(value) {
    try {
      await saveWorkspace(value);
      setItems((all) => [value, ...all.filter((x) => x.id !== value.id)]);
      if (liveW.current === value) setSaved(true);
    } catch {
      setError(
        "Could not save to browser storage. Download a backup now to protect your work.",
      );
    }
  }
  useEffect(() => {
    if (!ready || !w) return;
    setSaved(false);
    const timer = setTimeout(() => persist(w), 500);
    return () => clearTimeout(timer);
  }, [w, ready]);
  useEffect(() => {
    const handle = () => {
      if (liveW.current) saveWorkspace(liveW.current).catch(() => {});
    };
    window.addEventListener("pagehide", handle);
    return () => {
      window.removeEventListener("pagehide", handle);
      if (liveW.current) saveWorkspace(liveW.current).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  function update(fn) {
    setW((old) => ({ ...fn(old), updatedAt: new Date().toISOString() }));
  }
  async function action(label, fn) {
    if (busy) return;
    setError("");
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError(e.message || "Something went wrong. Please try again.");
    } finally {
      setBusy("");
    }
  }
  async function switchTo(next) {
    if (w?.id === next.id) {
      setTab("workspace");
      return;
    }
    if (w) await persist(w);
    setW(next);
    setTab("workspace");
    setSelected("");
    setError("");
  }
  async function upload(file) {
    if (!file) return;
    await action("Reading your resume", async () => {
      const next = await importResume(file);
      if (w) await persist(w);
      await saveWorkspace(next);
      setItems((all) => [next, ...all]);
      setW(next);
      setSelected("");
      setTab("workspace");
      setToast("Original resume locked as your baseline.");
    });
  }
  async function loadDemo() {
    await action("Opening example", async () => {
      const next = createDemo();
      if (w) await persist(w);
      await saveWorkspace(next);
      setItems((all) => [next, ...all]);
      setW(next);
      setTab("analysis");
      const analysis = {
        data: clone(demoAnalysis),
        signature: signature(next.paragraphs, next.role),
        date: new Date().toISOString(),
      };
      setW({ ...next, analysis });
    });
  }
  async function analyze() {
    if (!w) return;
    await action("Reviewing resume against the role", async () => {
      if (w.role.text.trim().length < 100)
        throw new Error(
          "Add the full job description first (at least 100 characters).",
        );
      const data =
        w.kind === "demo"
          ? clone(demoAnalysis)
          : await callAI(config, "analyze", w);
      update((old) => ({
        ...old,
        analysis: {
          data,
          signature: signature(w.paragraphs, w.role),
          date: new Date().toISOString(),
        },
        decisions: {},
      }));
      setTab("analysis");
    });
  }
  async function buildPrep() {
    await action("Building your interview pack", async () => {
      if (w.role.text.trim().length < 100)
        throw new Error("Add the full job description first.");
      const data =
        w.kind === "demo" ? demoPrep(w) : await callAI(config, "prep", w);
      update((old) => ({
        ...old,
        prep: {
          data,
          signature: signature(w.paragraphs, w.role),
          date: new Date().toISOString(),
        },
      }));
    });
  }
  function accept(r, index) {
    try {
      const paragraphs = applyRewrite(w.paragraphs, r);
      update((old) => ({
        ...old,
        paragraphs,
        decisions: { ...old.decisions, [index]: "accepted" },
      }));
      setToast("Suggestion applied. Your baseline is unchanged.");
    } catch (e) {
      setError(e.message);
    }
  }
  async function alternative(r, index) {
    await action("Drafting an alternative", async () => {
      if (w.kind === "demo")
        throw new Error(
          "The example uses fixed sample suggestions. Connect a gateway and upload your resume for custom alternatives.",
        );
      const data = await callAI(config, "rewrite", w, {
        paragraphId: r.paragraphId,
        instruction:
          direction ||
          "Try a different concise, direct wording. Preserve all facts.",
      });
      update((old) => ({
        ...old,
        analysis: {
          ...old.analysis,
          data: {
            ...old.analysis.data,
            rewrites: old.analysis.data.rewrites.map((v, i) =>
              i === index ? data : v,
            ),
          },
        },
        decisions: { ...old.decisions, [index]: undefined },
      }));
      setModal(null);
      setDirection("");
    });
  }
  function saveVersion() {
    if (!versionName.trim()) return;
    action("Saving version", async () => {
      const v = {
        id: crypto.randomUUID(),
        name: versionName.trim(),
        date: new Date().toISOString(),
        paragraphs: clone(w.paragraphs),
        role: clone(w.role),
        analysis: clone(w.analysis),
        prep: clone(w.prep),
      };
      const next = {
        ...w,
        versions: [v, ...w.versions],
        updatedAt: new Date().toISOString(),
      };
      await saveWorkspace(next);
      setW(next);
      setItems((all) => [next, ...all.filter((x) => x.id !== next.id)]);
      setVersionName("");
      setModal(null);
      setToast("Version saved. You can restore it anytime.");
    });
  }
  function restore(paragraphs, role) {
    const auto = {
      id: crypto.randomUUID(),
      name: "Before restore · automatic snapshot",
      date: new Date().toISOString(),
      paragraphs: clone(w.paragraphs),
      role: clone(w.role),
      analysis: clone(w.analysis),
      prep: clone(w.prep),
    };
    update((old) => ({
      ...old,
      paragraphs: clone(paragraphs),
      role: clone(role || old.role),
      analysis: null,
      prep: null,
      decisions: {},
      versions: [auto, ...old.versions],
    }));
    setModal(null);
    setToast("Restored. Your previous draft was saved as a version.");
  }
  async function exportDoc() {
    await action("Preparing download", async () =>
      download(
        await exportResume(w),
        w.filename.replace(/\.(pdf|docx)$/i, "") + "-tailored.docx",
      ),
    );
  }
  const currentSig = w && signature(w.paragraphs, w.role),
    analysisStale = w?.analysis && w.analysis.signature !== currentSig,
    prepStale = w?.prep && w.prep.signature !== currentSig;
  const edits = w
    ? w.paragraphs.filter((p, i) => p.text !== w.baseline[i]?.text).length
    : 0;
  const currentStep = steps.find((s) => s.id === tab);
  const selectedP = w?.paragraphs.find((p) => p.id === selected);
  return (
    <div className="app-shell">
      <main>
        <header className="platform-header">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setTab("workspace");
            }}
          >
            <span className="brand-mark">
              <Braces size={21} />
            </span>
            rolecraft<span className="brand-dot">.</span>
          </a>
          <nav className="platform-nav" aria-label="Main navigation">
            {steps.map(({ id, icon: Icon }, i) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                <Icon size={15} />
                <span>
                  {
                    [
                      "Resume",
                      "Role fit",
                      "Refine",
                      "Interview prep",
                      "Versions",
                    ][i]
                  }
                </span>
                {id === "history" && w?.versions.length > 0 && (
                  <small>{w.versions.length}</small>
                )}
              </button>
            ))}
          </nav>
          <div className="platform-account">
            <span className="save-status">
              <span className={`status-dot ${saved ? "" : "pending"}`} />
              {saved ? "Saved locally" : "Saving…"}
            </span>
            <AccountStatus
              beforeLeave={async () => {
                if (w) await persist(w);
              }}
              onSettings={() => setModal({ type: "settings" })}
            />
            <button
              className="icon-btn"
              aria-label="Settings & connection"
              onClick={() => setModal({ type: "settings" })}
            >
              <Settings size={18} />
            </button>
          </div>
        </header>
        <div className="application-bar">
          <div className="application-picker">
            <FileText size={15} />
            <select
              aria-label="Resume library"
              value={w?.id || ""}
              onChange={(e) => {
                const next = items.find((item) => item.id === e.target.value);
                if (next) switchTo(next);
              }}
              disabled={!!busy || !items.length}
            >
              <option value="" disabled>
                Your resume library
              </option>
              {items.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.filename}
                  {item.kind === "demo" ? " · example" : ""}
                </option>
              ))}
            </select>
            <button
              className="text-button"
              onClick={() => fileRef.current.click()}
              disabled={!!busy}
            >
              <Plus size={14} />
              Upload resume
            </button>
          </div>
          <div className="application-actions">
            <button
              className="icon-btn"
              aria-label="How your data is handled"
              onClick={() => setModal({ type: "privacy" })}
            >
              <ShieldCheck size={16} />
            </button>
            {w && (
              <Button
                variant="primary"
                icon={Download}
                onClick={() => setModal({ type: "export" })}
              >
                Preview & export
              </Button>
            )}
          </div>
        </div>
        <div
          className={`page ${w && ["workspace", "analysis", "editor"].includes(tab) ? "resume-page" : "overview-page"}`}
        >
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                A LITTLE INTENTION. A BETTER NEXT CHAPTER.
              </div>
              <h1>
                {tab === "workspace"
                  ? "Make your experience count."
                  : tab === "analysis"
                    ? "See yourself through their eyes."
                    : tab === "editor"
                      ? "Your experience. Sharper words."
                      : tab === "prep"
                        ? "Walk in with a story to tell."
                        : "Every draft has a place."}
              </h1>
              <p>
                {tab === "workspace"
                  ? "Bring your resume and your next opportunity together."
                  : tab === "analysis"
                    ? "A candid look at where you fit, what’s missing, and what to improve."
                    : tab === "editor"
                      ? "Refine the details without rewriting your history."
                      : tab === "prep"
                        ? "Turn the experience on your resume into answers you can stand behind."
                        : "Keep what works. Explore what’s next. Your original is always here."}
              </p>
            </div>
          </div>
          {auth.authError && (
            <div className="notice error" role="alert">
              <AlertTriangle size={18} />
              <span>{auth.authError}</span>
              <button
                className="text-button"
                onClick={() => setModal({ type: "settings" })}
              >
                Account settings
              </button>
            </div>
          )}
          {error && (
            <div role="alert" className="notice error">
              <AlertTriangle size={18} />
              <span>{error}</span>
              <button
                className="icon-btn"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!!busy && (
            <div role="status" className="notice progress">
              <LoaderCircle size={18} className="spin" />
              {busy}…
            </div>
          )}
          {w?.kind === "demo" && (
            <div className="notice sample">
              <Sparkles size={17} />
              <span>
                <strong>Example workspace.</strong> Scores, suggestions and
                interview content are fixed samples. Upload your resume and
                connect OpenAI for real analysis.
              </span>
            </div>
          )}
          {!ready ? (
            <div className="empty-state">
              <LoaderCircle className="spin" />
              Opening your workspace…
            </div>
          ) : !w && tab !== "workspace" ? (
            <Empty
              icon={currentStep.icon}
              title="Start with your story"
              text="Upload your resume and add a role to unlock this workspace."
              action={
                <Button variant="primary" onClick={() => setTab("workspace")}>
                  Set up workspace <ArrowRight size={16} />
                </Button>
              }
            />
          ) : null}
          {tab === "workspace" && !w && (
            <>
              <div className="workspace-grid">
                <section className="card resume-card">
                  <div className="card-heading">
                    <span className="section-icon">
                      <FileText size={20} />
                    </span>
                    <div>
                      <h2>Your resume</h2>
                      <p>A solid starting point.</p>
                    </div>
                    {w && (
                      <Pill kind="green">
                        <ShieldCheck size={12} /> Baseline protected
                      </Pill>
                    )}
                  </div>
                  {!w ? (
                    <div
                      className="upload-zone"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        upload(e.dataTransfer.files[0]);
                      }}
                    >
                      <div className="upload-art">
                        <FileText size={43} strokeWidth={1.2} />
                        <span>
                          <Plus size={14} />
                        </span>
                      </div>
                      <h3>Your next chapter starts here.</h3>
                      <p>Drop your resume here, or choose a file.</p>
                      <Button
                        variant="primary"
                        icon={Upload}
                        onClick={() => fileRef.current.click()}
                        disabled={!!busy}
                      >
                        Upload resume
                      </Button>
                      <small>DOCX or text-based PDF · up to 15 MB</small>
                    </div>
                  ) : (
                    <div className="resume-loaded">
                      <div className="file-tile">
                        <span className="file-type">
                          {w.kind === "pdf" ? "PDF" : "DOCX"}
                        </span>
                        <div>
                          <h3>{w.filename}</h3>
                          <p>
                            {w.paragraphs.length} paragraphs · {edits} edited
                          </p>
                        </div>
                        <CheckCircle2 size={22} className="teal" />
                      </div>
                      <div className="resume-excerpt">
                        {w.paragraphs.slice(0, 6).map((p, i) => (
                          <p key={p.id} className={i === 0 ? "name" : ""}>
                            {p.text}
                          </p>
                        ))}
                      </div>
                      <div className="row spread">
                        <Button
                          variant="subtle"
                          icon={PenLine}
                          onClick={() => setTab("editor")}
                        >
                          Open in studio
                        </Button>
                        <button
                          className="text-button"
                          onClick={() => fileRef.current.click()}
                          disabled={!!busy}
                        >
                          Add another resume <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="card-foot">
                    <ShieldCheck size={16} />
                    <span>
                      {w
                        ? "Original file and baseline saved separately from your edits."
                        : "Your original becomes a protected baseline when you upload."}
                    </span>
                  </div>
                </section>
                <section className="card role-card">
                  <div className="card-heading">
                    <span className="section-icon">
                      <Target size={20} />
                    </span>
                    <div>
                      <h2>Your next opportunity</h2>
                      <p>Give every edit a direction.</p>
                    </div>
                    <span className="tiny-label">STEP 02</span>
                  </div>
                  <RoleForm
                    w={w}
                    update={update}
                    disabled={!!busy}
                    onImport={() =>
                      action("Importing job description", async () => {
                        if (!config.endpoint)
                          throw new Error(
                            "Connect your gateway in Settings to import job links, or paste the description below.",
                          );
                        if (!w.role.url)
                          throw new Error("Paste a job listing URL first.");
                        const result = await gateway(config, "/job", {
                          url: w.role.url,
                        });
                        update((old) => ({
                          ...old,
                          role: { ...old.role, text: result.text },
                        }));
                        setToast(
                          "Job text imported. Review it before analysis.",
                        );
                      })
                    }
                  />
                  <div className="card-foot">
                    <Link2 size={16} />
                    <span>
                      Some listings block imports. Pasting the description
                      always works.
                    </span>
                  </div>
                </section>
              </div>
              <div className="next-strip">
                <div>
                  <span className="spark-icon">
                    <Sparkles size={20} />
                  </span>
                  <div>
                    <h3>Find the overlap. Make it clear.</h3>
                    <p>
                      Get an honest fit score, evidence-based matches and three
                      focused rewrites.
                    </p>
                  </div>
                </div>
                <Button
                  variant="primary"
                  onClick={analyze}
                  disabled={!w || !!busy}
                >
                  Analyze role fit <ArrowRight size={16} />
                </Button>
              </div>
              <div className="below-grid">
                <div className="principle">
                  <span>01 / KEEP IT TRUE</span>
                  <h3>Stronger words. Same experience.</h3>
                  <p>
                    Suggestions use your evidence. You review every change
                    before it enters your resume.
                  </p>
                </div>
                <div className="principle">
                  <span>02 / STAY IN CONTROL</span>
                  <h3>A safe place to iterate.</h3>
                  <p>
                    Save named versions, restore earlier drafts, and return to
                    your original whenever you need.
                  </p>
                </div>
                <div className="principle">
                  <span>03 / THINK AHEAD</span>
                  <h3>From application to conversation.</h3>
                  <p>
                    Build study guides and practice answers that connect your
                    experience to the role.
                  </p>
                </div>
              </div>
              {!w && (
                <div className="demo-link">
                  Want to look around first?{" "}
                  <button
                    className="text-button"
                    onClick={loadDemo}
                    disabled={!!busy}
                  >
                    Explore an example <ArrowUpRight size={14} />
                  </button>
                </div>
              )}
            </>
          )}
          {w && ["workspace", "analysis", "editor"].includes(tab) && (
            <ResumeWorkspace
              w={w}
              tab={tab}
              busy={!!busy}
              selected={selected}
              onSelect={setSelected}
              onEdit={(id, text) =>
                update((old) => ({
                  ...old,
                  paragraphs: old.paragraphs.map((p) =>
                    p.id === id && p.editable ? { ...p, text } : p,
                  ),
                }))
              }
              onAnalyze={analyze}
              onAccept={accept}
              onAlternative={(rewrite, index) => {
                setDirection("");
                setModal({ type: "alternative", rewrite, index });
              }}
              onDismiss={(index) =>
                update((old) => ({
                  ...old,
                  decisions: { ...old.decisions, [index]: "dismissed" },
                }))
              }
              onCustom={(paragraph) => {
                setDirection("");
                setModal({ type: "custom", paragraph });
              }}
              onSaveVersion={() => {
                setVersionName(
                  w.role.company
                    ? `${w.role.company} · tailored`
                    : "Tailored draft",
                );
                setModal({ type: "save" });
              }}
              onRestore={() => setModal({ type: "baseline" })}
              onTab={setTab}
              roleForm={
                <RoleForm
                  w={w}
                  update={update}
                  disabled={!!busy}
                  onImport={() =>
                    action("Importing job description", async () => {
                      if (!config.endpoint)
                        throw new Error(
                          "Connect your gateway in Settings to import job links, or paste the description.",
                        );
                      if (!w.role.url)
                        throw new Error("Paste a job listing URL first.");
                      const result = await gateway(config, "/job", {
                        url: w.role.url,
                      });
                      update((old) => ({
                        ...old,
                        role: { ...old.role, text: result.text },
                      }));
                      setToast("Job text imported. Review it before analysis.");
                    })
                  }
                />
              }
            />
          )}
          {w &&
            tab === "prep" &&
            (!w.prep ? (
              <Empty
                icon={GraduationCap}
                title="Turn your resume into your talking points."
                text="Map your latest draft to job requirements, study the gaps, and practice screening and technical interview questions."
                action={
                  <Button
                    variant="primary"
                    onClick={buildPrep}
                    disabled={!!busy}
                  >
                    Build interview pack <Sparkles size={16} />
                  </Button>
                }
              />
            ) : (
              <>
                {prepStale && (
                  <div className="notice warning">
                    <AlertTriangle size={18} />
                    <span>
                      This pack reflects an older draft or role. Regenerate it
                      before studying.
                    </span>
                  </div>
                )}
                <div className="card prep-summary">
                  <div>
                    <div className="eyebrow">YOUR INTERVIEW PLAYBOOK</div>
                    <h2>{w.role.title || "Your next role"}</h2>
                    <p>{w.prep.data.overview}</p>
                  </div>
                  <div className="button-stack">
                    <Button
                      icon={RotateCcw}
                      onClick={buildPrep}
                      disabled={!!busy}
                    >
                      Regenerate pack
                    </Button>
                    <Button
                      icon={Download}
                      onClick={() =>
                        download(
                          new Blob([prepMarkdown(w)], {
                            type: "text/markdown",
                          }),
                          "interview-prep.md",
                        )
                      }
                    >
                      Download study pack
                    </Button>
                  </div>
                </div>
                <SectionTitle
                  number="01"
                  title="Connect the dots"
                  text="Your experience, mapped to what they need."
                />
                <div className="mapping-grid">
                  {w.prep.data.mappings.map((m, i) => (
                    <div className="card mapping" key={i}>
                      <div className="eyebrow">FROM YOUR RESUME</div>
                      <blockquote>“{m.evidence}”</blockquote>
                      <div className="mapping-arrow">
                        <ArrowRight size={16} />
                      </div>
                      <div className="eyebrow">WHAT THEY’RE LOOKING FOR</div>
                      <h3>{m.requirement}</h3>
                      <ul>
                        {m.talkingPoints.map((t, j) => (
                          <li key={j}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <SectionTitle
                  number="02"
                  title="Study with intention"
                  text="Concepts to understand, then put into practice."
                />
                <div className="study-grid">
                  {w.prep.data.studyGuides.map((g, i) => (
                    <details key={i} className="card study" open={i === 0}>
                      <summary>
                        <BookOpen size={19} />
                        <h3>{g.topic}</h3>
                        <Plus size={17} />
                      </summary>
                      <p className="muted">{g.why}</p>
                      {g.lessons.map((l, j) => (
                        <p key={j}>{l}</p>
                      ))}
                      <div className="exercise">
                        <strong>PUT IT INTO PRACTICE</strong>
                        <p>{g.exercise}</p>
                      </div>
                    </details>
                  ))}
                </div>
                <div className="questions-heading">
                  <SectionTitle
                    number="03"
                    title="Practice the conversation"
                    text="Likely questions, with honest answer frameworks."
                  />
                  <div
                    className="segmented"
                    aria-label="Filter interview stage"
                  >
                    {["all", "screening", "technical"].map((f) => (
                      <button
                        className={f === filter ? "selected" : ""}
                        onClick={() => setFilter(f)}
                        key={f}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="question-list">
                  {w.prep.data.questions
                    .filter((q) => filter === "all" || q.stage === filter)
                    .map((q, i) => (
                      <details className="card question" key={`${filter}-${i}`}>
                        <summary>
                          <span className="list-num">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <h3>{q.question}</h3>
                          <Pill>{q.stage}</Pill>
                          <Plus size={17} />
                        </summary>
                        <p>
                          <strong>Why they may ask:</strong> {q.why}
                        </p>
                        <div className="answer-guide">
                          <strong>BUILD YOUR ANSWER</strong>
                          <p>{q.answerGuide}</p>
                        </div>
                        {q.paragraphIds.length > 0 && (
                          <p className="small muted">
                            Resume evidence:{" "}
                            {q.paragraphIds
                              .map(
                                (id) =>
                                  w.paragraphs.find((p) => p.id === id)?.text,
                              )
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                      </details>
                    ))}
                </div>
              </>
            ))}
          {w && tab === "history" && (
            <>
              <div className="studio-bar">
                <span className="muted">
                  {w.versions.length} saved versions · backups are portable
                  across devices
                </span>
                <div>
                  <Button
                    icon={Download}
                    onClick={() =>
                      download(
                        new Blob([toBackup(w)], { type: "application/json" }),
                        "rolecraft-backup.json",
                      )
                    }
                  >
                    Download backup
                  </Button>
                  <Button
                    variant="primary"
                    icon={Plus}
                    onClick={() => {
                      setVersionName("");
                      setModal({ type: "save" });
                    }}
                  >
                    Save current version
                  </Button>
                </div>
              </div>
              <div className="card baseline-card">
                <span className="section-icon">
                  <ShieldCheck size={23} />
                </span>
                <div>
                  <Pill kind="green">PROTECTED ORIGINAL</Pill>
                  <h2>Your baseline</h2>
                  <p>
                    {w.filename} · {w.baseline.length} paragraphs · saved{" "}
                    {date(w.createdAt)}
                  </p>
                </div>
                <Button
                  icon={RotateCcw}
                  onClick={() => setModal({ type: "baseline" })}
                >
                  Restore baseline
                </Button>
                {w.kind !== "demo" && (
                  <Button
                    icon={Download}
                    onClick={() =>
                      download(
                        new Blob([w.original], {
                          type:
                            w.kind === "pdf"
                              ? "application/pdf"
                              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        }),
                        w.filename,
                      )
                    }
                  >
                    Original file
                  </Button>
                )}
              </div>
              {w.versions.length ? (
                <div className="version-list">
                  {w.versions.map((v) => (
                    <div className="card version-row" key={v.id}>
                      <span className="version-icon">
                        <History size={20} />
                      </span>
                      <div>
                        <h3>{v.name}</h3>
                        <p>
                          {date(v.date)}
                          {v.role.title && ` · ${v.role.title}`}
                          {v.role.company && ` at ${v.role.company}`}
                        </p>
                        <small>
                          {
                            v.paragraphs.filter(
                              (p, i) => p.text !== w.baseline[i]?.text,
                            ).length
                          }{" "}
                          paragraphs changed from baseline
                        </small>
                      </div>
                      <Button
                        onClick={() =>
                          setModal({ type: "restore", version: v })
                        }
                        icon={RotateCcw}
                      >
                        Restore
                      </Button>
                      <Button
                        icon={Download}
                        onClick={() =>
                          action("Preparing version", async () =>
                            download(
                              await exportResume(w, v.paragraphs),
                              "resume-" +
                                v.name.replace(/[^a-z0-9-]/gi, "-") +
                                ".docx",
                            ),
                          )
                        }
                      >
                        DOCX
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={History}
                  title="Make room for a few possibilities."
                  text="Save a named version before you experiment. Every saved draft keeps its resume and role together."
                />
              )}
            </>
          )}
          <footer>
            <span>
              rolecraft. <span className="muted">A thoughtful next step.</span>
            </span>
            <button
              className="text-button"
              onClick={() => setModal({ type: "privacy" })}
            >
              <ShieldCheck size={13} /> How your data is handled
            </button>
          </footer>
        </div>
      </main>
      <input
        ref={fileRef}
        type="file"
        accept=".docx,.pdf"
        hidden
        onChange={(e) => {
          upload(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={backupRef}
        type="file"
        accept=".json"
        hidden
        onChange={(e) => {
          const file = e.target.files[0];
          if (file)
            action("Restoring backup", async () => {
              const next = await fromBackup(file);
              if (w) await persist(w);
              await saveWorkspace(next);
              setItems((all) => [next, ...all]);
              setW(next);
              setTab("workspace");
              setModal(null);
              setToast("Backup restored as a separate workspace.");
            });
          e.target.value = "";
        }}
      />
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {modal && (
        <Modal
          title={
            modal.type === "settings"
              ? "Make the connection"
              : modal.type === "export"
                ? "One last look, then send it."
                : modal.type === "save"
                  ? "Keep this version"
                  : modal.type === "baseline"
                    ? "Return to your starting point?"
                    : modal.type === "restore"
                      ? "Restore this version?"
                      : modal.type === "privacy"
                        ? "Your data, in plain language"
                        : modal.type === "delete"
                          ? "Delete this workspace?"
                          : "Ask for a different take"
          }
          onClose={() => {
            if (!busy) setModal(null);
          }}
          wide={modal.type === "export"}
        >
          {modal.type === "settings" && (
            <div className="modal-body">
              <AuthPanel
                beforeLeave={async () => {
                  if (w) await persist(w);
                }}
              />
              <div className="modal-divider" />
              <h3>Workspace tools</h3>
              <div className="row wrap">
                <Button icon={Upload} onClick={() => backupRef.current.click()}>
                  Import backup
                </Button>
                {w && (
                  <Button
                    icon={Download}
                    onClick={() =>
                      download(
                        new Blob([toBackup(w)], { type: "application/json" }),
                        "rolecraft-backup.json",
                      )
                    }
                  >
                    Export backup
                  </Button>
                )}
                <Button
                  icon={Sparkles}
                  onClick={() => {
                    setModal(null);
                    loadDemo();
                  }}
                  disabled={!!busy}
                >
                  Open example
                </Button>
                {w && (
                  <Button
                    variant="danger"
                    icon={Trash2}
                    onClick={() => setModal({ type: "delete" })}
                  >
                    Delete workspace
                  </Button>
                )}
              </div>
              <p className="small muted">
                Backend setup and GitHub Pages publishing instructions are
                included in the project README.
              </p>
            </div>
          )}
          {modal.type === "export" && (
            <div className="modal-body">
              <div className="notice info">
                <ShieldCheck size={18} />
                <span>
                  {w.kind === "docx"
                    ? "Existing Word styles, tables and document structure are retained. Longer text can change line wrapping and pagination. Verify the final file in Word before applying."
                    : w.kind === "pdf"
                      ? "PDF typography, colors, spacing, page size and simple columns are recovered for your editable draft and exports. Some fonts may substitute; graphics and exact pagination may differ. Compare with the original before submitting."
                      : "Sample resumes export as a Word document."}
                </span>
              </div>
              <div className="export-actions">
                <Button
                  variant="primary"
                  icon={Download}
                  onClick={exportDoc}
                  disabled={!!busy}
                >
                  Download edited DOCX
                </Button>
                <Button
                  icon={FileText}
                  onClick={() =>
                    action("Preparing styled PDF", () => printResume(w))
                  }
                  disabled={!!busy}
                >
                  Print / Save styled PDF
                </Button>
                {w.kind !== "demo" && (
                  <Button
                    onClick={() =>
                      download(
                        new Blob([w.original], {
                          type:
                            w.kind === "pdf"
                              ? "application/pdf"
                              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        }),
                        w.filename,
                      )
                    }
                  >
                    Download original
                  </Button>
                )}
              </div>
              <p className="small muted">
                Print uses the styled document shown below. In the print dialog,
                choose Save as PDF, disable browser headers and footers, and use
                the source page size. For final pagination, check the DOCX in
                Word.
              </p>
              <DocPreview w={w} />
            </div>
          )}
          {modal.type === "save" && (
            <div className="modal-body">
              <p>
                Save this draft with its job description. The original remains
                protected.
              </p>
              <label>
                Version name
                <input
                  autoFocus
                  maxLength={100}
                  placeholder="e.g. Meridian · final application"
                  value={versionName}
                  onChange={(e) => setVersionName(e.target.value)}
                />
              </label>
              <Button
                variant="primary"
                onClick={saveVersion}
                disabled={!versionName.trim()}
              >
                Save version
              </Button>
            </div>
          )}
          {(modal.type === "baseline" || modal.type === "restore") && (
            <div className="modal-body">
              <p>
                {modal.type === "baseline"
                  ? "Restore the exact text from your original upload. Your target role stays the same."
                  : `Restore “${modal.version.name}” and its saved target role.`}{" "}
                Your current draft will be saved as an automatic version before
                restoring.
              </p>
              <Button
                variant="primary"
                icon={RotateCcw}
                onClick={() =>
                  restore(
                    modal.type === "baseline"
                      ? w.baseline
                      : modal.version.paragraphs,
                    modal.type === "restore" ? modal.version.role : null,
                  )
                }
              >
                Restore {modal.type === "baseline" ? "baseline" : "version"}
              </Button>
            </div>
          )}
          {(modal.type === "alternative" || modal.type === "custom") && (
            <div className="modal-body">
              <blockquote>
                {modal.type === "custom"
                  ? modal.paragraph.text
                  : w.paragraphs.find((p) => p.id === modal.rewrite.paragraphId)
                      ?.text}
              </blockquote>
              <label>
                What should change?
                <textarea
                  rows={4}
                  maxLength={2000}
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                  placeholder="e.g. Make the action clearer and keep it under 30 words. Don’t add metrics."
                />
              </label>
              <p className="small muted">
                The result will be a suggestion for you to review. No changes
                are applied automatically.
              </p>
              <Button
                variant="primary"
                disabled={!!busy}
                onClick={() =>
                  modal.type === "alternative"
                    ? alternative(modal.rewrite, modal.index)
                    : action("Drafting your suggestion", async () => {
                        if (w.kind === "demo")
                          throw new Error(
                            "Custom rewrites need an uploaded resume and a connected gateway.",
                          );
                        const r = await callAI(config, "rewrite", w, {
                          paragraphId: modal.paragraph.id,
                          instruction:
                            direction ||
                            "Make this paragraph clearer and more concise while preserving all facts.",
                        });
                        setModal({ type: "review", rewrite: r });
                      })
                }
              >
                Generate suggestion <Sparkles size={16} />
              </Button>
              {busy && (
                <p className="loading">
                  <LoaderCircle size={16} className="spin" />
                  {busy}…
                </p>
              )}
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
          {modal.type === "review" && (
            <div className="modal-body">
              <div className="diff before">
                <span>BEFORE</span>
                <p>{modal.rewrite.before}</p>
              </div>
              <div className="diff after">
                <span>SUGGESTION</span>
                <p>{modal.rewrite.after}</p>
              </div>
              <p>{modal.rewrite.reason}</p>
              <div className="row">
                <Button
                  variant="primary"
                  onClick={() => {
                    try {
                      const paragraphs = applyRewrite(
                        w.paragraphs,
                        modal.rewrite,
                      );
                      update((old) => ({ ...old, paragraphs }));
                      setModal(null);
                      setToast("Edit applied.");
                    } catch (e) {
                      setError(e.message);
                      setModal(null);
                    }
                  }}
                >
                  Accept edit
                </Button>
                <Button
                  onClick={() => {
                    setDirection("");
                    setModal({
                      type: "custom",
                      paragraph: w.paragraphs.find(
                        (p) => p.id === modal.rewrite.paragraphId,
                      ),
                    });
                  }}
                >
                  Request another
                </Button>
              </div>
            </div>
          )}
          {modal.type === "privacy" && (
            <div className="modal-body">
              <h3>Local by default</h3>
              <p>
                Resumes, originals, drafts, job descriptions and interview packs
                are saved in this browser’s IndexedDB, separated by GitHub
                account or the signed-out local workspace. They are not synced
                to GitHub or another device. Clearing site data removes them.
                Download backups regularly; backups contain personal information
                and should be kept private.
              </p>
              <h3>When you ask for AI help</h3>
              <p>
                Resume text and the role description are sent to your configured
                gateway and OpenAI. Personal-key users also send their own key
                to the gateway for each AI request; it is not saved. Your
                original DOCX/PDF is not sent. The gateway requests non-stored
                API responses with store: false; provider retention policies
                still apply.
              </p>
              <h3>When you import a link</h3>
              <p>
                The gateway fetches supported public job listings. For
                restricted or unsupported listings, paste the job text. There
                are no analytics or tracking scripts.
              </p>
              <Button onClick={() => setModal(null)}>Got it</Button>
            </div>
          )}
          {modal.type === "delete" && (
            <div className="modal-body">
              <p>
                This permanently removes “{w.filename}”, its baseline and all
                versions from this browser. Download a backup first if you may
                need it.
              </p>
              <div className="row">
                <Button
                  icon={Download}
                  onClick={() =>
                    download(
                      new Blob([toBackup(w)], { type: "application/json" }),
                      "rolecraft-backup.json",
                    )
                  }
                >
                  Download backup
                </Button>
                <Button
                  variant="danger"
                  icon={Trash2}
                  onClick={() =>
                    action("Deleting workspace", async () => {
                      await deleteWorkspace(w.id);
                      const remaining = items.filter((x) => x.id !== w.id);
                      setItems(remaining);
                      setW(remaining[0] || null);
                      setTab("workspace");
                      setModal(null);
                    })
                  }
                >
                  Permanently delete
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
function Empty({ icon: Icon, title, text, action }) {
  return (
    <section className="card empty-state">
      <span className="empty-icon">
        <Icon size={31} />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </section>
  );
}
function SectionTitle({ number, title, text }) {
  return (
    <div className="section-title">
      <span>{number}</span>
      <div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
    </div>
  );
}
function RoleForm({ w, update, disabled, onImport }) {
  function field(key, value) {
    update((old) => ({ ...old, role: { ...old.role, [key]: value } }));
  }
  return (
    <div className="role-form">
      <fieldset disabled={!w || disabled}>
        <div className="two-inputs">
          <label>
            Role title
            <input
              maxLength={300}
              value={w?.role.title || ""}
              onChange={(e) => field("title", e.target.value)}
              placeholder="Senior Software Engineer"
            />
          </label>
          <label>
            Company
            <input
              maxLength={300}
              value={w?.role.company || ""}
              onChange={(e) => field("company", e.target.value)}
              placeholder="Company name"
            />
          </label>
        </div>
        <label>
          Job listing link <span className="optional">optional</span>
          <div className="input-action">
            <Link2 size={15} />
            <input
              type="url"
              maxLength={3000}
              value={w?.role.url || ""}
              onChange={(e) => field("url", e.target.value)}
              placeholder="https://jobs.company.com/your-next-role"
            />
            <button onClick={onImport} type="button" disabled={!w || disabled}>
              Import <ArrowDownIcon />
            </button>
          </div>
        </label>
        <label>
          Job description <span className="required">required</span>
          <textarea
            rows={7}
            maxLength={60000}
            value={w?.role.text || ""}
            onChange={(e) => field("text", e.target.value)}
            placeholder="Paste the full job description here — responsibilities, requirements and the details that matter."
          />
          <small>
            {!w
              ? "Upload a resume to get started."
              : `${w.role.text.length.toLocaleString()} / 60,000 characters · review imported text for accuracy`}
          </small>
        </label>
      </fieldset>
    </div>
  );
}
function ArrowDownIcon() {
  return <ArrowRight size={13} />;
}
function prepMarkdown(w) {
  const p = w.prep.data;
  return (
    `# Interview prep: ${w.role.title} ${w.role.company ? "at " + w.role.company : ""}\n\n${w.prep.signature !== signature(w.paragraphs, w.role) ? "WARNING: This pack reflects an older draft or role.\n\n" : ""}${p.overview}\n\n## Resume-to-role mapping\n\n` +
    p.mappings
      .map(
        (m) =>
          `### ${m.requirement}\n\nResume: ${m.evidence}\n\n${m.talkingPoints.map((t) => "- " + t).join("\n")}`,
      )
      .join("\n\n") +
    "\n\n## Study guides\n\n" +
    p.studyGuides
      .map(
        (g) =>
          `### ${g.topic}\n\n${g.why}\n\n${g.lessons.join("\n\n")}\n\nPractice: ${g.exercise}`,
      )
      .join("\n\n") +
    "\n\n## Likely questions\n\n" +
    p.questions
      .map(
        (q) =>
          `### [${q.stage}] ${q.question}\n\nWhy: ${q.why}\n\nAnswer framework: ${q.answerGuide}`,
      )
      .join("\n\n")
  );
}
function AccountWorkspace() {
  const { session } = useAuth();
  return <App key={session?.user.id || "local"} />;
}
createRoot(document.getElementById("root")).render(
  <AuthProvider>
    <AccountWorkspace />
  </AuthProvider>,
);
