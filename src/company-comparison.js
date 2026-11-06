import { gateway } from "./api.js";
import { roleSchema, scoreSchema } from "../shared/contracts.js";
import { comparisonOptionsSchema, resumeSearchTerms, shortlistCompanyRoles } from "../shared/comparison-options.js";
import { jobBoardSource, sameJob, resumeSignature } from "../shared/job-boards.js";

export function comparisonIsStale(comparison, workspace) {
  if (!comparison) return false;
  const active = comparison.rows.find((row) => sameJob(row.role.url, workspace.role.url) || row.role.url === workspace.role.url);
  return Boolean(!active || active.role.text !== workspace.role.text || comparison.resumeSignature !== resumeSignature(workspace.paragraphs) ||
    (comparison.source.key === "demo" ? workspace.kind !== "demo" || comparison.sourceRole.company !== workspace.role.company
      : comparison.source.key !== jobBoardSource(workspace.role.url)?.key));
}
export function demoCompanyComparison(workspace) {
  const examples = [["Software Engineer, Product", 88, "Strong product delivery and TypeScript evidence; broader ownership remains a growth area."],
    ["Backend Software Engineer", 81, "PostgreSQL results and API delivery align well; backend system scope is less clear."],
    ["Senior Software Engineer", 74, "Good delivery evidence, with gaps in architecture ownership."],
    ["Platform Engineer", 62, "Deployment exposure is relevant; infrastructure ownership is not demonstrated."],
    ["Engineering Manager", 43, "Mentoring is relevant, but people-management experience is not established."]];
  return { source: { key: "demo", provider: "example", board: workspace.role.company }, sourceRole: workspace.role,
    resumeSignature: resumeSignature(workspace.paragraphs), date: new Date().toISOString(), totalAvailable: 5, status: "complete",
    rows: [{ role: workspace.role, original: true, status: "scored", score: workspace.analysis.data.score, verdict: workspace.analysis.data.verdict },
      ...examples.map(([title, score, verdict], i) => ({ role: { ...workspace.role, title, url: `https://example.com/rolecraft-demo/${i}`, text: `${workspace.role.text}\nThis sample role focuses on ${title}.` },
        score, verdict, original: false, status: "scored" }))] };
}
export function canRetryComparison(workspace) {
  const previous = workspace.companyComparison;
  return Boolean(previous && !comparisonIsStale(previous, workspace) &&
    (sameJob(previous.sourceRole.url, workspace.role.url) || previous.sourceRole.url === workspace.role.url) &&
    previous.rows.some((row) => row.status !== "scored"));
}
export async function compareCompanyRoles({ config, workspace, preferences = { maxRoles: 50 }, retry = false, signal, onUpdate, request = gateway }) {
  if (!workspace.analysis) throw new Error("Run your initial role-fit analysis before comparing company roles.");
  const source = jobBoardSource(workspace.role.url);
  if (!source?.jobId) throw new Error("Add a direct Greenhouse, Lever or Ashby listing URL to compare company roles.");
  const options = comparisonOptionsSchema.parse(preferences);
  let rows, base;
  if (retry) {
    if (!canRetryComparison(workspace)) throw new Error("The resume or target changed. Start a fresh comparison instead.");
    const previous = workspace.companyComparison;
    rows = previous.rows.slice(0, 51).map((row) => {
      const role = roleSchema.parse(row.role);
      if (jobBoardSource(role.url)?.key !== source.key) throw new Error("Saved comparison contains an unexpected board.");
      if (row.status === "scored") return { ...row, ...scoreSchema.parse(row), role: row.role };
      const { error, score, verdict, ...unfinished } = row;
      return { ...unfinished, status: "pending" };
    });
    base = { ...previous, retriedAt: new Date().toISOString(), reusedCount: rows.filter((r) => r.status === "scored").length };
    delete base.rows;
  } else {
    const keywords = resumeSearchTerms(workspace.paragraphs);
    const found = await request(config, "/company-jobs", { role: workspace.role, preferences: options, keywords }, { signal });
    signal?.throwIfAborted();
    if (!Array.isArray(found.roles) || found.source?.key !== source.key) throw new Error("The gateway returned listings from an unexpected board.");
    const seen = new Set();
    const candidates = found.roles.slice(0, 50).map((role) => {
      const parsed = roleSchema.parse(role);
      const board = jobBoardSource(parsed.url);
      if (!board?.jobId || board.key !== source.key || sameJob(parsed.url, workspace.role.url) || seen.has(board.jobId)) return null;
      seen.add(board.jobId);
      return { ...parsed, location: typeof role.location === "string" ? role.location.slice(0, 300) : "", remote: typeof role.remote === "boolean" ? role.remote : undefined };
    }).filter(Boolean);
    const alternatives = shortlistCompanyRoles(candidates, workspace.role, options, keywords).roles;
    rows = [{ role: workspace.role, original: true, status: "pending" },
      ...alternatives.map((role) => ({ role, original: false, status: "pending" }))];
    base = { source, sourceRole: workspace.role, resumeSignature: resumeSignature(workspace.paragraphs),
      date: new Date().toISOString(), totalAvailable: Number.isInteger(found.total) ? found.total : alternatives.length,
      matching: Number.isInteger(found.matching) ? found.matching : alternatives.length, preferences: options, reusedCount: 0 };
    if (!alternatives.length) throw new Error("No other roles match these filters. Broaden the title, location or level before spending API credits.");
  }
  const publish = (status = "running") => {
    const comparison = { ...base, rows: [...rows], status };
    onUpdate?.(comparison);
    return comparison;
  };
  publish();
  const pending = rows.map((row, i) => row.status !== "scored" ? i : -1).filter((i) => i >= 0);
  let next = 0, fatalError = "";
  async function scoreNext() {
    while (!signal?.aborted && !fatalError && next < pending.length) {
      const index = pending[next++];
      rows[index] = { ...rows[index], status: "scoring" };
      publish();
      try {
        const result = scoreSchema.parse(await request(config, "/ai", {
          task: "score", paragraphs: workspace.paragraphs, role: rows[index].role,
        }, { signal }));
        rows[index] = { ...rows[index], ...result, status: "scored" };
      } catch (e) {
        if (signal?.aborted) { rows[index] = { ...rows[index], status: "cancelled" }; break; }
        const message = e.name === "ZodError" ? "An invalid fit score was returned. This role was not ranked." : e.message || "This role could not be scored.";
        rows[index] = { ...rows[index], status: "failed", error: message };
        if ([401, 403, 429].includes(e.status) || e.status >= 500 || /\b(key|quota|billing|rate|model|schema|gateway)\b|sign in|request format|invalid request data|too large|not configured/i.test(message)) fatalError = message;
      }
      publish();
    }
  }
  await Promise.all([scoreNext(), scoreNext()]);
  rows = rows.map((row) => ["pending", "scoring"].includes(row.status) ? { ...row, status: "cancelled" } : row);
  return publish(signal?.aborted ? "cancelled" : fatalError ? "failed" : "complete");
}
