import test from "node:test";
import assert from "node:assert/strict";
import { jobBoardSource, sameJob, resumeSignature } from "../shared/job-boards.js";
import { fetchCompanyJobs, plainJobText } from "../server/company-jobs.js";
import { compareCompanyRoles, comparisonIsStale } from "../src/company-comparison.js";
import worker, { runAI } from "../server/worker.js";
import { signToken } from "../server/auth.js";
import { fitImpactSchema } from "../shared/contracts.js";

const role = { title: "Software Engineer", company: "Acme", url: "https://job-boards.greenhouse.io/acme/jobs/1?source=test", text: "Build and operate web APIs with TypeScript. Collaborate with design and product. PostgreSQL experience is required." };
const paragraphs = [{ id: "p0", text: "• Built web APIs with TypeScript and PostgreSQL.", editable: true }];
const workspace = { id: "workspace", role, paragraphs, analysis: { data: { score: 70 } } };
const job = (id, title = "Software Engineer") => ({ id, title, content: `<p>${role.text}</p>`, location: { name: "Remote" } });
const result = (data) => Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(data) }] }] });

test("job board identity isolates company, region and job despite tracking parameters", () => {
  assert.equal(sameJob(role.url, "https://boards.greenhouse.io/acme/jobs/1"), true);
  assert.equal(sameJob(role.url, "https://boards.greenhouse.io/other/jobs/1"), false);
  assert.equal(jobBoardSource("https://boards.greenhouse.io/embed/job_app?for=acme&token=1").key, jobBoardSource(role.url).key);
  assert.notEqual(jobBoardSource("https://jobs.lever.co/acme/1").key, jobBoardSource("https://jobs.eu.lever.co/acme/1").key);
  for (const url of ["https://boards.greenhouse.io.evil.test/acme/jobs/1", "http://boards.greenhouse.io/acme/jobs/1", "https://user:secret@boards.greenhouse.io/acme/jobs/1", "https://jobs.ashbyhq.com/%2e%2e/1"]) assert.equal(jobBoardSource(url), null);
});
test("Greenhouse discovery excludes active and duplicate jobs, caps at 50 and only fetches its public feed", async () => {
  const jobs = [job(1), ...Array.from({ length: 60 }, (_, i) => job(i + 2)), job(2), job(99, ""), { id: 100, title: "Incomplete" }];
  const found = await fetchCompanyJobs(role, async (url, options) => {
    assert.equal(url, "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({ jobs });
  });
  assert.equal(found.roles.length, 50);
  assert.equal(found.total, 60);
  assert.ok(found.roles.every((r) => !sameJob(r.url, role.url) && r.text === role.text));
  assert.equal(plainJobText("&amp;lt;p&amp;gt;APIs &amp;amp; design&amp;lt;/p&amp;gt;"), "APIs & design");
  await assert.rejects(() => fetchCompanyJobs({ ...role, url: "https://workday.example/jobs/1" }), /direct Greenhouse/);
});
test("Lever EU and Ashby feeds preserve descriptions and reject foreign board URLs and unlisted jobs", async () => {
  const lever = await fetchCompanyJobs({ ...role, url: "https://jobs.eu.lever.co/acme/active" }, async (url) => {
    assert.match(url, /^https:\/\/api.eu.lever.co/);
    return Response.json([{ id: "other", text: "Engineer", descriptionPlain: role.text, lists: [{ text: "Requirements", content: "<ul><li>TypeScript</li></ul>" }], categories: { location: "Berlin" } }]);
  });
  assert.match(lever.roles[0].text, /Requirements\nTypeScript/);
  assert.equal(lever.roles[0].location, "Berlin");
  const ashby = await fetchCompanyJobs({ ...role, url: "https://jobs.ashbyhq.com/acme/active" }, async () => Response.json({ jobs: [
    { title: "Engineer", descriptionPlain: role.text, jobUrl: "https://jobs.ashbyhq.com/acme/other", isListed: true },
    { title: "Unlisted", descriptionPlain: role.text, jobUrl: "https://jobs.ashbyhq.com/acme/hidden", isListed: false },
    { title: "Wrong company", descriptionPlain: role.text, jobUrl: "https://jobs.ashbyhq.com/other/foreign" },
  ] }));
  assert.equal(ashby.roles.length, 1);
});
function discovery(count = 3) {
  return { source: jobBoardSource(role.url), total: count, roles: Array.from({ length: count }, (_, i) => ({ ...role, url: `https://job-boards.greenhouse.io/acme/jobs/${i + 2}` })) };
}
test("comparison re-scores current role and at most 50 others with the same snapshot, persisting progress", async () => {
  let scores = 0;
  let maxConcurrency = 0;
  let active = 0;
  const updates = [];
  const compared = await compareCompanyRoles({ workspace, config: {}, onUpdate: (update) => updates.push(update), request: async (_config, path, body) => {
    if (path === "/company-jobs") return discovery(60);
    assert.equal(path, "/ai");
    assert.equal(body.task, "score");
    assert.deepEqual(body.paragraphs, paragraphs);
    maxConcurrency = Math.max(maxConcurrency, ++active);
    await Promise.resolve();
    active--;
    scores++;
    return { score: 71, verdict: "Relevant APIs; unclear ownership." };
  } });
  assert.equal(scores, 51);
  assert.ok(maxConcurrency <= 2);
  assert.equal(compared.rows.length, 51);
  assert.ok(compared.rows.every((r) => r.status === "scored"));
  assert.equal(compared.status, "complete");
  assert.equal(updates[0].rows[0].status, "pending"); // published states stay immutable
  assert.equal(comparisonIsStale(compared, workspace), false);
  assert.equal(comparisonIsStale(compared, { ...workspace, paragraphs: [{ ...paragraphs[0], text: "Edited resume" }] }), true);
  assert.equal(comparisonIsStale(compared, { ...workspace, role: { ...role, url: "https://jobs.lever.co/acme/1" } }), true);
  assert.equal(comparisonIsStale(compared, { ...workspace, role: { ...role, text: "Different job description" } }), true);
  assert.equal(compared.resumeSignature, resumeSignature(paragraphs));
});
test("cancellation and systemic errors stop additional paid scoring while retaining finished results", async () => {
  const controller = new AbortController();
  let calls = 0;
  const cancelled = await compareCompanyRoles({ workspace, config: {}, signal: controller.signal, request: async (_config, path) => {
    if (path === "/company-jobs") return discovery(50);
    calls++;
    controller.abort();
    throw new DOMException("Cancelled", "AbortError");
  } });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(calls, 1);
  assert.ok(cancelled.rows.every((r) => r.status === "cancelled"));
  calls = 0;
  const failed = await compareCompanyRoles({ workspace, config: {}, request: async (_config, path) => {
    if (path === "/company-jobs") return discovery(50);
    calls++;
    throw new Error("OpenAI API quota limit reached");
  } });
  assert.equal(failed.status, "failed");
  assert.ok(calls <= 2);
  assert.ok(failed.rows.some((r) => r.status === "failed"));
});
test("bad individual results do not become zero-fit scores or discard other roles", async () => {
  let index = 0;
  const compared = await compareCompanyRoles({ workspace, config: {}, request: async (_config, path) => {
    if (path === "/company-jobs") return discovery(2);
    return ++index === 2 ? { score: 101, verdict: "Invalid" } : { score: 80, verdict: "Good match" };
  } });
  assert.equal(compared.rows.filter((r) => r.status === "failed").length, 1);
  assert.equal(compared.rows.filter((r) => r.status === "scored").length, 2);
  assert.equal(compared.rows.find((r) => r.status === "failed").score, undefined);
});
test("score-only gateway uses compact strict schema and rewrite estimates cannot exceed score headroom", async () => {
  const scored = await runAI({ task: "score", paragraphs, role }, { OPENAI_API_KEY: "test" }, async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(Object.keys(body.text.format.schema.properties), ["score", "verdict"]);
    assert.equal(body.text.format.strict, true);
    assert.equal(body.store, false);
    assert.match(body.instructions, /required skills and qualifications 40/);
    return result({ score: 72, verdict: "Relevant API and PostgreSQL experience." });
  });
  assert.equal(scored.score, 72);
  const rewritten = await runAI({ task: "rewrite", paragraphs, role, paragraphId: "p0", currentScore: 99 }, { OPENAI_API_KEY: "test" }, async () => result({ paragraphId: "p0", after: "• Built TypeScript web APIs using PostgreSQL.", reason: "Clearer wording", fitImpact: { minPoints: 2, maxPoints: 5, rationale: "Clarifies API skills." } }));
  assert.equal(rewritten.fitImpact.minPoints, 1);
  assert.equal(rewritten.fitImpact.maxPoints, 1);
  assert.throws(() => fitImpactSchema.parse({ minPoints: 4, maxPoints: 2, rationale: "Invalid range" }));
});
test("company discovery requires allowed-origin login and never forwards credentials to the board", async (t) => {
  const env = { ALLOWED_ORIGINS: "http://localhost:5173", SESSION_SECRET: "a".repeat(64), OWNER_GITHUB_ID: "90569344" };
  const req = (headers) => new Request("http://gateway/company-jobs", { method: "POST", headers: { Origin: env.ALLOWED_ORIGINS, ...headers }, body: JSON.stringify({ role }) });
  assert.equal((await worker.fetch(req({}), env)).status, 401);
  assert.equal((await worker.fetch(req({ Origin: "https://evil.test" }), env)).status, 403);
  const now = Math.floor(Date.now() / 1000);
  const token = await signToken({ type: "session", sub: "123", login: "another-user", iat: now, exp: now + 3600, iss: "http://gateway", aud: env.ALLOWED_ORIGINS }, env.SESSION_SECRET);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.match(url, /^https:\/\/boards-api.greenhouse.io\//);
    assert.deepEqual(options.headers, { Accept: "application/json" });
    return Response.json({ jobs: [job(2)] });
  });
  const response = await worker.fetch(req({ Authorization: `Bearer ${token}`, "X-OpenAI-Key": "must-not-forward" }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), env.ALLOWED_ORIGINS);
  assert.equal((await response.json()).roles.length, 1);
});
