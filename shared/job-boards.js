// Shared by discovery and the UI so that changing boards invalidates results.
export function jobBoardSource(value) {
  let u;
  try { u = new URL(value); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  let provider, board, jobId, region = "global";
  if (["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(u.hostname)) {
    provider = "greenhouse";
    board = parts[0] === "embed" ? u.searchParams.get("for") : parts[0];
    jobId = u.searchParams.get("gh_jid") || (parts[0] === "embed" ? u.searchParams.get("token") : parts[1] === "jobs" ? parts[2] : "");
  } else if (["jobs.lever.co", "jobs.eu.lever.co"].includes(u.hostname)) {
    provider = "lever";
    region = u.hostname === "jobs.eu.lever.co" ? "eu" : "global";
    [board, jobId] = parts;
  } else if (u.hostname === "jobs.ashbyhq.com") {
    provider = "ashby";
    [board, jobId] = parts;
  }
  if (!provider || !/^[a-zA-Z0-9_-]{1,150}$/.test(board || "")) return null;
  if (!/^[a-zA-Z0-9_-]{1,150}$/.test(jobId || "")) return null;
  return { provider, board, jobId: jobId || "", region, key: `${provider}:${region}:${board.toLowerCase()}` };
}
export function sameJob(a, b) {
  const x = jobBoardSource(a), y = jobBoardSource(b);
  return Boolean(x && y && x.key === y.key && x.jobId && x.jobId === y.jobId);
}
export function resumeSignature(paragraphs) {
  return JSON.stringify(paragraphs.map(({ id, text }) => [id, text]));
}
