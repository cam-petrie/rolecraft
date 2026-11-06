import test from "node:test";
import assert from "node:assert/strict";
import { comparisonOptionsSchema, shortlistCompanyRoles, resumeSearchTerms } from "../shared/comparison-options.js";
import { fetchCompanyJobs } from "../server/company-jobs.js";
import { compareCompanyRoles } from "../src/company-comparison.js";
import { editParagraph, editOperation, replayEdit, replayDecisions } from "../src/resume-edits.js";
import { attachInlineEditor } from "../src/inline-editor.js";
import { applyRewrite } from "../shared/contracts.js";

const role = { title: "Senior Backend Engineer", company: "Example", url: "https://job-boards.greenhouse.io/example/jobs/1", text: "Design TypeScript web services with PostgreSQL and collaborate with product teams. Operate and maintain reliable backend systems." };
const paragraphs = [{ id: "p0", text: "• Built TypeScript services with PostgreSQL.", editable: true }];
test("filters apply to the full company feed before limiting paid roles", async () => {
  const jobs = Array.from({ length: 70 }, (_, i) => ({ id: i + 2, title: i < 50 ? "Marketing Manager" : "Senior Backend Engineer", content: role.text, location: { name: i < 50 ? "London" : "Remote — US" } }));
  const found = await fetchCompanyJobs(role, async () => Response.json({ jobs }), { preferences: { title: "backend", location: "US", level: "senior", remoteOnly: true, exclude: "manager, intern", maxRoles: 5 } });
  assert.equal(found.roles.length, 5);
  assert.equal(found.matching, 20);
  assert.equal(found.total, 70);
  assert.ok(found.roles.every((r) => r.title === "Senior Backend Engineer"));
});
test("shortlisting uses title family and resume evidence and enforces budget bounds", () => {
  const options = { maxRoles: 1 };
  const choices = [{ ...role, title: "Senior Backend Engineer", text: "PostgreSQL TypeScript", location: "Remote", url: role.url + "a" }, { ...role, title: "Senior Backend Engineer", text: "SAP accounting", location: "Remote", url: role.url + "b" }];
  const result = shortlistCompanyRoles(choices.reverse(), role, options, resumeSearchTerms(paragraphs));
  assert.equal(result.roles[0].text, "PostgreSQL TypeScript");
  assert.equal(comparisonOptionsSchema.parse({}).maxRoles, 10);
  for (const maxRoles of [0, 51, 1.5, NaN]) assert.throws(() => comparisonOptionsSchema.parse({ maxRoles }));
  assert.equal(shortlistCompanyRoles(choices, role, { remoteOnly: true, location: "Canada" }).roles.length, 0);
  for (const location of ["Not remote", "Non-remote", "Hybrid", "On-site, no remote"]) assert.equal(shortlistCompanyRoles([{ ...choices[0], location }], role, { remoteOnly: true }).roles.length, 0);
  assert.equal(shortlistCompanyRoles([{ ...choices[0], location: "Remote US", remote: false }], role, { remoteOnly: true }).roles.length, 0);
});
test("retry preserves finished scores, scores only failed rows, and refuses a changed resume", async () => {
  const w = { role, paragraphs, analysis: {} };
  let calls = 0;
  w.companyComparison = await compareCompanyRoles({ workspace: w, config: {}, preferences: { maxRoles: 3 }, request: async (_config, path) => {
    if (path === "/company-jobs") return { source: { key: "greenhouse:global:example" }, total: 3, roles: [2, 3, 4].map((id) => ({ ...role, url: `https://job-boards.greenhouse.io/example/jobs/${id}` })) };
    calls++;
    return calls === 2 ? { score: 101, verdict: "Invalid" } : { score: 80, verdict: "Relevant backend experience." };
  } });
  assert.equal(calls, 4);
  assert.equal(w.companyComparison.rows.filter((r) => r.status === "scored").length, 3);
  let retries = 0;
  const next = await compareCompanyRoles({ workspace: w, config: {}, retry: true, request: async (_config, path) => {
    assert.equal(path, "/ai"); retries++;
    return { score: 78, verdict: "Useful backend experience, scope unclear." };
  } });
  assert.equal(retries, 1);
  assert.equal(next.reusedCount, 3);
  assert.ok(next.rows.every((r) => r.status === "scored"));
  await assert.rejects(() => compareCompanyRoles({ workspace: { ...w, paragraphs: [{ ...paragraphs[0], text: "Changed" }] }, config: {}, retry: true, request: () => { throw new Error("must not call"); } }), /changed/);
});
test("zero matching roles do not trigger any paid AI requests", async () => {
  let paid = 0;
  await assert.rejects(() => compareCompanyRoles({ workspace: { role, paragraphs, analysis: {} }, config: {}, preferences: { title: "nonexistent" }, request: async (_config, path) => {
    if (path === "/ai") paid++;
    return { source: { key: "greenhouse:global:example" }, total: 1, roles: [{ ...role, url: "https://job-boards.greenhouse.io/example/jobs/2" }] };
  } }), /No other roles match/);
  assert.equal(paid, 0);
});
test("typed authorization failures stop scoring even without a recognizable error message", async () => {
  let calls = 0;
  const result = await compareCompanyRoles({ workspace: { role, paragraphs, analysis: {} }, config: {}, preferences: { maxRoles: 10 }, request: async (_config, path) => {
    if (path === "/company-jobs") return { source: { key: "greenhouse:global:example" }, total: 10, roles: Array.from({ length: 10 }, (_, i) => ({ ...role, url: `https://job-boards.greenhouse.io/example/jobs/${i + 2}` })) };
    calls++;
    const error = new Error("Denied"); error.status = 403; throw error;
  } });
  assert.equal(result.status, "failed");
  assert.ok(calls <= 2);
  assert.ok(result.rows.some((r) => r.status === "cancelled"));
});
test("manual edits preserve source structure and stale suggestions cannot overwrite them", () => {
  const after = editParagraph(paragraphs, "p0", paragraphs[0].text, "Built reliable TypeScript services with PostgreSQL.");
  assert.equal(after[0].text, "• Built reliable TypeScript services with PostgreSQL.");
  assert.throws(() => applyRewrite(after, { paragraphId: "p0", before: paragraphs[0].text, after: "Stale suggestion" }), /changed/);
  const skills = [{ id: "s0", text: "SKILLS", editable: true }, { id: "s1", text: "Tools: Python, SQL, Git", editable: true }];
  assert.equal(editParagraph(skills, "s1", skills[1].text, "Languages: Python, SQL")[1].text, "Languages: Python, SQL");
  const single = editParagraph(skills, "s1", skills[1].text, "Tools: Python");
  assert.equal(single[1].text, "Tools: Python");
  assert.equal(editParagraph(single, "s1", single[1].text, "Languages: SQL")[1].text, "Languages: SQL");
  assert.throws(() => editParagraph(skills, "s1", skills[1].text, "I am proficient in all these tools."), /list into prose/);
});
test("undo and redo restore exact text and only the affected suggestion decision", () => {
  const after = editParagraph(paragraphs, "p0", paragraphs[0].text, "Built APIs with TypeScript and PostgreSQL.");
  const operation = editOperation(paragraphs, after, { 1: "dismissed" }, { 0: "accepted", 1: "dismissed" });
  assert.deepEqual(replayEdit(after, operation, "undo"), paragraphs);
  assert.deepEqual(replayEdit(paragraphs, operation, "redo"), after);
  assert.deepEqual(replayDecisions({ 0: "accepted", 1: "dismissed", 2: "dismissed" }, operation, "undo"), { 1: "dismissed", 2: "dismissed" });
  assert.throws(() => replayEdit([{ ...after[0], text: "A newer edit" }], operation, "undo"), /no longer safe/);
});
class ParagraphElement extends EventTarget {
  dataset = { editable: "true" }; isConnected = false;
  set innerHTML(value) { this.html = value; this.text = value.replace(/<[^>]*>/g, ""); }
  get innerHTML() { return this.html; }
  set textContent(value) { this.text = value; this.html = value; }
  get textContent() { return this.text; }
  focus() { this.dispatchEvent(new Event("focus")); }
  blur() { this.dispatchEvent(new Event("blur")); }
}
function editor(commit) {
  const el = new ParagraphElement(); el.innerHTML = "<b>Original</b>";
  let session, error = "", commits = 0;
  attachInlineEditor(el, { id: "p0", text: "Original" }, { onSelect() {}, onCommit: (...args) => { commits++; return commit(...args); }, onSession: (next) => { session = next; }, onError: (message) => { error = message; }, onSettled() {} });
  el.focus();
  return { el, get session() { return session; }, get error() { return error; }, get commits() { return commits; } };
}
test("a failed inline save retains the typed draft; Cancel restores original run markup", () => {
  const state = editor(() => { throw new Error("Use a list, not a sentence"); });
  state.el.textContent = "Typed draft";
  assert.equal(state.session.dirty, true);
  assert.equal(state.session.save(), false);
  assert.equal(state.el.textContent, "Typed draft");
  assert.match(state.error, /Use a list/);
  state.el.focus();
  state.session.cancel();
  assert.equal(state.el.innerHTML, "<b>Original</b>");
  assert.equal(state.session, null);
});
test("IME Enter does not commit prematurely and a normal save commits once despite blur", () => {
  const state = editor((_id, text, before) => { assert.equal(before, "Original"); return text; });
  state.el.textContent = "Updated";
  const composing = new Event("keydown", { cancelable: true });
  Object.defineProperties(composing, { key: { value: "Enter" }, isComposing: { value: true } });
  state.el.dispatchEvent(composing);
  assert.equal(state.commits, 0);
  state.el.dispatchEvent(new Event("compositionstart"));
  assert.equal(state.session.save(), false);
  assert.equal(state.commits, 0);
  state.el.dispatchEvent(new Event("compositionend"));
  const enter = new Event("keydown", { cancelable: true }); Object.defineProperty(enter, "key", { value: "Enter" });
  state.el.dispatchEvent(enter);
  assert.equal(state.commits, 1);
  assert.equal(state.session, null);
});
test("refocusing a failed draft registers its original session again without replacing its saved HTML", () => {
  const first = new ParagraphElement(); first.innerHTML = "<b>Original</b>";
  const second = new ParagraphElement(); second.innerHTML = "Other";
  let current;
  const connect = (el, id, text) => attachInlineEditor(el, { id, text }, { onSelect() {}, onCommit() { throw new Error("Invalid draft"); }, onSession(session) { current = session; }, onError() {}, onSettled() {} });
  connect(first, "p0", "Original"); connect(second, "p1", "Other");
  first.focus(); const originalSession = current; first.textContent = "Invalid draft"; first.blur();
  second.focus(); assert.notEqual(current, originalSession);
  second.blur(); first.focus(); assert.equal(current, originalSession);
  current.cancel(); assert.equal(first.innerHTML, "<b>Original</b>");
});
