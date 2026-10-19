import test from "node:test";
import assert from "node:assert/strict";
import { paragraphStructures, preserveRewriteStructure, rewriteFormatHints } from "../shared/resume-structure.js";
import { applyRewrite, assertEvidence } from "../shared/contracts.js";
import { runAI } from "../server/worker.js";
const paragraph = (id, text, extra = {}) => ({ id, text, editable: true, ...extra });
const skills = [paragraph("p0", "Technical Skills"), paragraph("p1", "Languages: Python, SQL, JavaScript"), paragraph("p2", "Experience"), paragraph("p3", "Built APIs, reduced latency, and improved monitoring.")];
test("skills context and short comma lists are distinguished from achievement prose", () => {
  const formats = paragraphStructures(skills);
  assert.equal(formats.get("p1").kind, "skills-list");
  assert.equal(formats.get("p1").label, "Languages: ");
  assert.equal(formats.get("p3").kind, "paragraph");
  assert.equal(paragraphStructures([paragraph("p", "Python, SQL, C++")]).get("p").kind, "skills-list");
});
test("bullet markers survive AI rewrites, including Word PDF private-use glyphs", () => {
  for (const marker of ["• ", "\uf0b7 ", "▪ ", "- "]) {
    const ps = [paragraph("p", marker + "Built APIs.")];
    for (const after of ["Designed APIs.", "• Designed APIs."]) {
      const r = { paragraphId: "p", before: ps[0].text, after, reason: "Clearer" };
      assert.equal(applyRewrite(ps, r)[0].text, marker + "Designed APIs.");
      assert.equal(assertEvidence("rewrite", r, ps).after, marker + "Designed APIs.");
    }
  }
});
test("native Word bullets do not acquire duplicate literal markers", () => {
  const ps = [paragraph("p", "Built APIs.", { list: true })];
  assert.equal(preserveRewriteStructure(ps, { paragraphId: "p", after: "• Designed APIs." }).after, "Designed APIs.");
});
test("skills rewrites retain labels and separators and block sentence replacements", () => {
  const r = { paragraphId: "p1", before: skills[1].text, after: "SQL, Python, JavaScript", reason: "Prioritize" };
  assert.equal(applyRewrite(skills, r)[1].text, "Languages: SQL, Python, JavaScript");
  for (const after of ["Experienced in Python and SQL.", "Python, developed APIs with SQL", "Python, SQL. Built APIs."]) {
    assert.throws(() => applyRewrite(skills, { ...r, after }), /list into prose/);
  }
  assert.equal(skills[1].text, r.before);
});
test("gateway sends format guidance and restores a dropped bullet in the result", async () => {
  const paragraphs = [paragraph("p", "• Built APIs.")];
  const result = await runAI({ task: "rewrite", paragraphs, paragraphId: "p", role: { title: "Engineer", company: "Example", url: "", text: "Build APIs. ".repeat(12) } }, { OPENAI_API_KEY: "test" }, async (_url, options) => {
    const request = JSON.parse(options.body);
    const input = JSON.parse(request.input[1].content);
    assert.equal(input.paragraphFormats.p.kind, "bullet");
    assert.match(request.instructions, /skills lists keep/);
    return Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ paragraphId: "p", after: "Designed APIs.", reason: "Clearer" }) }] }] });
  });
  assert.equal(result.after, "• Designed APIs.");
  assert.match(rewriteFormatHints(skills).p1.instruction, /comma-separated/);
});

test("wrapped skills lines keep comma-bearing labels, parenthesized items and continuation commas", () => {
  const ps = [paragraph("p0", "TECHNICAL SKILLS"), paragraph("p1", "Monitoring, Quality & Tooling :  Telemetry Pipelines, Playwright (E2E), Git,"), paragraph("p2", "Cloud: Kubernetes (GKE, EKS), AWS (EC2, S3, Lambda), Docker")];
  assert.equal(paragraphStructures(ps).get("p1").kind, "skills-list");
  assert.equal(preserveRewriteStructure(ps, { paragraphId: "p1", after: "Git, Playwright (E2E), Telemetry Pipelines" }).after, "Monitoring, Quality & Tooling :  Git, Playwright (E2E), Telemetry Pipelines,");
  assert.equal(preserveRewriteStructure(ps, { paragraphId: "p2", after: "AWS (EC2, S3, Lambda), Kubernetes (GKE, EKS), Docker" }).after, "Cloud: AWS (EC2, S3, Lambda), Kubernetes (GKE, EKS), Docker");
});
