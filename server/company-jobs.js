import { jobBoardSource, sameJob } from "../shared/job-boards.js";

export function plainJobText(html) {
  let s = String(html || "");
  // Greenhouse can return doubly encoded HTML. Decode then strip at each pass.
  for (let i = 0; i < 3; i++) {
    s = s.replace(/&(amp|lt|gt|quot|apos|nbsp);|&#(x[\da-f]+|\d+);/gi, (all, name, numeric) => {
      if (name) return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[name.toLowerCase()];
      const n = numeric[0].toLowerCase() === "x" ? parseInt(numeric.slice(1), 16) : Number(numeric);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : " ";
    }).replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/?(?:p|div|li|h[1-6]|br)\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, " ");
  }
  return s.replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
}
async function feedJSON(url, fetcher) {
  const r = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(25000), headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("The company job board is unavailable. Check the listing URL and try again.");
  const reader = r.body?.getReader();
  if (!reader) throw new Error("The company job board returned no listings.");
  let size = 0;
  const chunks = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 12_000_000) {
      await reader.cancel();
      throw new Error("This company’s public feed is too large to compare safely. Try a smaller regional board.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("The company job board returned an invalid feed."); }
}
export async function fetchCompanyJobs(role, fetcher = fetch) {
  const source = jobBoardSource(role?.url);
  if (!source?.jobId) throw new Error("Company comparison needs a direct Greenhouse, Lever or Ashby job listing URL, including its company and job ID.");
  const slug = encodeURIComponent(source.board);
  const urls = {
    greenhouse: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
    lever: `https://api${source.region === "eu" ? ".eu" : ""}.lever.co/v0/postings/${slug}?mode=json`,
    ashby: `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
  };
  const feed = await feedJSON(urls[source.provider], fetcher);
  const entries = source.provider === "lever" ? feed : feed.jobs;
  if (!Array.isArray(entries)) throw new Error("The company job board returned an unexpected feed.");
  const seen = new Set();
  const roles = [];
  for (const item of entries) {
    if (!item || item.isListed === false) continue;
    let title, text, url, location;
    if (source.provider === "greenhouse") {
      if (!/^\d+$/.test(String(item.id))) continue;
      title = item.title;
      text = plainJobText(item.content);
      url = `https://job-boards.greenhouse.io/${slug}/jobs/${item.id}`;
      location = item.location?.name;
    } else if (source.provider === "lever") {
      if (!/^[a-zA-Z0-9_-]+$/.test(String(item.id || ""))) continue;
      title = item.text;
      text = plainJobText([item.descriptionPlain || item.description,
        ...(item.lists || []).map((list) => `${list.text || ""}\n${list.content || ""}`),
        item.additionalPlain || item.additional].filter(Boolean).join("\n"));
      url = `https://jobs${source.region === "eu" ? ".eu" : ""}.lever.co/${slug}/${item.id}`;
      location = item.categories?.location;
    } else {
      title = item.title;
      text = plainJobText(item.descriptionPlain || item.descriptionHtml);
      url = item.jobUrl;
      location = item.location;
    }
    const candidate = jobBoardSource(url);
    if (!candidate?.jobId || candidate.key !== source.key || sameJob(url, role.url) || seen.has(candidate.jobId)) continue;
    if (typeof title !== "string" || !title.trim() || text.length < 100) continue;
    seen.add(candidate.jobId);
    roles.push({ title: title.slice(0, 300), company: String(role.company || source.board).slice(0, 300),
      url, text: text.slice(0, 60000), location: String(location || "").slice(0, 300) });
  }
  // Prefer related titles when a board has more than 50 alternatives; never
  // present this title-based shortlist as a ranking of unscored roles.
  const terms = new Set(String(role.title || "").toLowerCase().match(/[a-z0-9+#]+/g) || []);
  const overlap = (title) => (title.toLowerCase().match(/[a-z0-9+#]+/g) || []).filter((t) => terms.has(t)).length;
  roles.sort((a, b) => overlap(b.title) - overlap(a.title) || a.title.localeCompare(b.title) || a.url.localeCompare(b.url));
  return { source, total: roles.length, roles: roles.slice(0, 50) };
}
