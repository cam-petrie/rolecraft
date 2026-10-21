import { gateway } from "./api.js";
import { roleSchema, scoreSchema } from "../shared/contracts.js";
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
export async function compareCompanyRoles({ config, workspace, signal, onUpdate, request = gateway }) {
  if (!workspace.analysis) throw new Error("Run your initial role-fit analysis before comparing company roles.");
  const source = jobBoardSource(workspace.role.url);
  if (!source?.jobId) throw new Error("Add a direct Greenhouse, Lever or Ashby listing URL to compare company roles.");
  const found = await request(config, "/company-jobs", { role: workspace.role }, { signal });
  signal?.throwIfAborted();
  if (!Array.isArray(found.roles) || found.source?.key !== source.key) throw new Error("The gateway returned listings from an unexpected board.");
  const seen = new Set();
  const alternatives = found.roles.slice(0, 50).map((role) => {
    const parsed = roleSchema.parse(role);
    const board = jobBoardSource(parsed.url);
    if (!board?.jobId || board.key !== source.key || sameJob(parsed.url, workspace.role.url) || seen.has(board.jobId)) return null;
    seen.add(board.jobId);
    return { ...parsed, location: typeof role.location === "string" ? role.location.slice(0, 300) : "" };
  }).filter(Boolean);
  let rows = [{ role: workspace.role, original: true, status: "pending" },
    ...alternatives.map((role) => ({ role, original: false, status: "pending" }))];
  const base = { source, sourceRole: workspace.role, resumeSignature: resumeSignature(workspace.paragraphs),
    date: new Date().toISOString(), totalAvailable: Number.isInteger(found.total) ? found.total : alternatives.length };
  const publish = (status = "running") => {
    const comparison = { ...base, rows: [...rows], status };
    onUpdate?.(comparison);
    return comparison;
  };
  publish();
  let next = 0;
  let fatalError = "";
  async function scoreNext() {
    while (!signal?.aborted && !fatalError && next < rows.length) {
      const index = next++;
      rows[index] = { ...rows[index], status: "scoring" };
      publish();
      try {
        const result = scoreSchema.parse(await request(config, "/ai", {
          task: "score", paragraphs: workspace.paragraphs, role: rows[index].role,
        }, { signal }));
        rows[index] = { ...rows[index], ...result, status: "scored" };
      } catch (e) {
        if (signal?.aborted) { rows[index] = { ...rows[index], status: "cancelled" }; break; }
        rows[index] = { ...rows[index], status: "failed", error: e.message || "This role could not be scored." };
        // Stop spending on systemic failures rather than repeat them 50 times.
        if (/key|quota|billing|rate|model|sign in|schema|request format|gateway|reach/i.test(e.message || "")) fatalError = e.message;
      }
      publish();
    }
  }
  await Promise.all([scoreNext(), scoreNext()]);
  rows = rows.map((row) => ["pending", "scoring"].includes(row.status) ? { ...row, status: "cancelled" } : row);
  return publish(signal?.aborted ? "cancelled" : fatalError ? "failed" : "complete");
}
