import React, { useEffect, useRef, useState } from "react";
import { BarChart3, ArrowUpRight, X, LoaderCircle, Square, AlertTriangle } from "lucide-react";
import { jobBoardSource, sameJob } from "../shared/job-boards.js";
import { comparisonIsStale } from "./company-comparison.js";

export default function CompanyComparison({ w, busy, comparing, onCompare, onCancel, onUseRole, error }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dialog = useRef();
  useEffect(() => {
    if (!open) return;
    const el = dialog.current;
    const previous = document.activeElement;
    el.showModal();
    return () => { el.close(); previous?.focus?.(); };
  }, [open]);
  const comparison = w.companyComparison;
  const source = jobBoardSource(w.role.url);
  const supported = w.kind === "demo" || Boolean(source?.jobId);
  const stale = comparisonIsStale(comparison, w);
  const rows = comparison?.rows || [];
  const ranked = rows.filter((row) => row.status === "scored").sort((a, b) => b.score - a.score || a.role.title.localeCompare(b.role.title));
  const completed = rows.filter((row) => ["scored", "failed"].includes(row.status)).length;
  const processing = comparing && comparison?.status === "running";
  const active = (row) => sameJob(row.role.url, w.role.url) || row.role.url === w.role.url;
  const baseline = ranked.find(active)?.score;
  const start = () => { setOpen(true); setSearch(""); onCompare(); };
  return <section className="company-comparison-card" aria-label="Company role comparison">
    <div className="company-comparison-title"><BarChart3 size={18} /><h3>More paths at {w.role.company || "this company"}</h3></div>
    <p>Compare your current resume with up to 50 other open roles on the same company job board.</p>
    {supported ? <>
      <button className="btn panel-primary" disabled={busy} onClick={start}><BarChart3 size={14} />{comparison ? "Run a fresh comparison" : "Compare company roles"}</button>
      <small>{w.kind === "demo" ? "Fixed example scores. No API calls." : "Uses API credits · scores the current role plus up to 50 alternatives."}</small>
    </> : <small>Add a direct Greenhouse, Lever or Ashby listing URL in Resume to enable comparison. Workday comparison is not yet supported.</small>}
    {comparison && <button className="text-button company-results-button" onClick={() => setOpen(true)}>
      {comparing ? processing ? `Scoring roles · ${completed}/${rows.length}` : "Finding company roles…" : stale ? "View previous comparison" : `View ${ranked.length} ranked roles`}<ArrowUpRight size={14} />
    </button>}
    {open && <dialog ref={dialog} className="wide company-dialog" aria-label="Company role comparison" onCancel={(e) => { e.preventDefault(); setOpen(false); }} onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="modal-top"><div><span className="panel-eyebrow">EXPLORE THE SAME COMPANY</span><h2>Where else could you fit?</h2></div>
        <button className="icon-btn" aria-label="Close company comparison" onClick={() => setOpen(false)}><X size={20} /></button></div>
      <div className="modal-body company-results">
        <p className="company-results-intro">{w.role.company || comparison?.source.board || "Your company"} · Same resume, same scoring rubric. Roles are ordered from highest to lowest fit.</p>
        {w.kind === "demo" && <p className="comparison-example">Sample comparison · fictional roles and fixed scores.</p>}
        {error && <div className="notice error" role="alert">{error}</div>}
        {stale && <div className="notice warning"><AlertTriangle size={16} />The resume or company board has changed. Run a fresh comparison before choosing a role from these scores.</div>}
        {comparing && <div className="comparison-progress" role="status">
          <span><LoaderCircle size={15} className="spin" />{processing ? `${completed} of ${rows.length} roles processed` : "Finding open company roles…"}</span>
          {processing && <progress max={rows.length} value={completed} aria-label="Roles processed" />}
          <button className="btn" onClick={onCancel}><Square size={12} />Stop comparison</button>
          <small>New scores appear as they finish. Keep this page open. Stop prevents further requests; calls already in flight may still use credits.</small>
        </div>}
        {comparison && !comparing && comparison.status !== "complete" && <div className="notice warning">Comparison {comparison.status === "failed" ? "stopped after a gateway error" : "stopped before completion"}. Finished scores are saved; unscored roles are not ranked.</div>}
        {comparison && <>
          <div className="comparison-summary"><strong>{ranked.length}<span>roles scored</span></strong>
            <strong>{baseline ?? "—"}<span>active role / 100</span></strong>
            <strong>{ranked[0]?.score ?? "—"}<span>best fit / 100</span></strong></div>
          <details className="comparison-method"><summary>How scores and role selection work</summary><p>{Math.max(0, rows.length - 1)} of {comparison.totalAvailable} available alternatives selected{comparison.totalAvailable > 50 ? " with related titles first, then alphabetical ties" : ""}. The current role is rescored with this resume for a consistent comparison. Scores are subjective and can vary between runs; they are not hiring probabilities.</p></details>
          <label className="comparison-search">Filter ranked roles<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or location" /></label>
          <div className="comparison-axis" aria-hidden="true"><span>FIT SCORE</span><span>0</span><span>50</span><span>100</span></div>
          <ol className="comparison-ranking" aria-label="Company roles ranked by fit score">
            {ranked.map((row, i) => ({ row, rank: i + 1 })).filter(({ row }) => `${row.role.title} ${row.role.location || ""}`.toLowerCase().includes(search.toLowerCase())).map(({ row, rank }) => {
              const isActive = active(row);
              const difference = baseline === undefined ? null : row.score - baseline;
              return <li key={row.role.url || "original"} className={isActive ? "active-role" : ""}>
                <div className="ranked-role-heading"><span className="comparison-rank">{String(rank).padStart(2, "0")}</span><div><h3>{row.role.title || "Current role"}</h3>
                  <small>{row.role.location}{isActive ? " · Active role" : row.original ? " · Starting role" : ""}</small></div>
                  <strong>{row.score}<small>/100</small></strong></div>
                <div className="comparison-bar" role="meter" aria-label={`${row.role.title} fit score`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.score}><span style={{ width: `${row.score}%` }} /></div>
                <div className="ranked-role-actions"><small>{isActive ? "Your current target" : difference === null ? "" : `${difference > 0 ? "+" : ""}${difference} points vs active role`}</small>
                  <details className="comparison-reason"><summary>Why this score</summary><p>{row.verdict}</p></details>
                  {!isActive && <button className="btn" disabled={busy || stale} onClick={() => { setOpen(false); onUseRole(row); }}>Use role & analyze<ArrowUpRight size={13} /></button>}
                  {w.kind !== "demo" && <a href={row.role.url} target="_blank" rel="noreferrer" aria-label={`Open listing for ${row.role.title}`}><ArrowUpRight size={16} /></a>}</div>
              </li>;
            })}
          </ol>
          {!ranked.length && !comparing && <p className="panel-intro">No roles were successfully scored. Review the errors below and try again.</p>}
          {comparison.totalAvailable === 0 && <p className="panel-intro">No other open roles with a complete description were found on this company board.</p>}
          {rows.some((row) => row.status === "failed") && <details className="comparison-failures"><summary>Roles that could not be scored ({rows.filter((row) => row.status === "failed").length})</summary>
            {rows.filter((row) => row.status === "failed").map((row) => <p key={row.role.url}><strong>{row.role.title}:</strong> {row.error}</p>)}</details>}
          <div className="row"><button className="btn" disabled={busy || !supported} onClick={start}>Run a fresh comparison</button><small>Choosing another role saves your current draft as a version, then runs its full analysis. Your resume text stays as it is.</small></div>
        </>}
        {!comparison && !comparing && <p className="panel-intro">Start a comparison to see the ranked roles here. Any connection error appears on the page when you close this window.</p>}
      </div>
    </dialog>}
  </section>;
}
