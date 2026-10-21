import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDemo, demoAnalysis } from "../src/demo.js";

let components, cache;
before(async () => {
  // Compile the real JSX components without opening a development server.
  cache = await mkdtemp(resolve("node_modules/.rolecraft-ui-test-"));
  const output = join(cache, "components.mjs");
  await build({ stdin: { contents: 'export { default as Workbench } from "./src/ResumeWorkspace.jsx"; export { default as Comparison } from "./src/CompanyComparison.jsx";', resolveDir: process.cwd() },
    outfile: output, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
  components = await import(pathToFileURL(output).href);
});
after(async () => { if (cache) await rm(cache, { recursive: true, force: true }); });
function savedGreenhouse(kind = "pdf") {
  const w = createDemo();
  w.kind = kind;
  w.role = { ...w.role, company: "Test Company", url: "https://job-boards.greenhouse.io/testcompany/jobs/123?gh_src=tracking" };
  const data = structuredClone(demoAnalysis);
  for (const rewrite of data.rewrites) delete rewrite.fitImpact;
  w.analysis = { data, signature: "saved-before-company-comparison" };
  return w;
}
function render(w, tab) {
  return renderToStaticMarkup(React.createElement(components.Workbench, { w, tab, selected: "", busy: false }));
}
test("real PDF and DOCX Greenhouse analyses show the card immediately below the score, including older saved results", () => {
  for (const kind of ["pdf", "docx"]) {
    const html = render(savedGreenhouse(kind), "analysis");
    assert.ok(html.includes("More paths at Test Company"));
    assert.ok(html.includes("Compare company roles"));
    assert.equal((html.match(/class="company-comparison-card"/g) || []).length, 1);
    assert.ok(html.indexOf('class="fit-score"') < html.indexOf('class="company-comparison-card"'));
    assert.ok(html.indexOf('class="company-comparison-card"') < html.indexOf('class="fit-verdict"'));
    assert.ok(html.includes('class="btn company-roles-shortcut"'));
    assert.ok(!html.includes("Fixed example scores"));
  }
});
test("missing company or unsupported listing link does not hide the comparison card", () => {
  const w = savedGreenhouse();
  w.role.company = "";
  w.role.url = "";
  const html = render(w, "analysis");
  assert.ok(html.includes("More paths at this company"));
  assert.ok(html.includes("Add a direct Greenhouse"));
  assert.ok(html.includes('class="btn company-roles-shortcut"'));
});
test("the company shortcut is available from Refine and Resume for saved real analyses", () => {
  for (const tab of ["editor", "workspace"]) {
    const html = render(savedGreenhouse(), tab);
    assert.ok(html.includes('class="btn company-roles-shortcut"'));
    assert.ok(!html.includes('class="company-comparison-card"'));
  }
  const w = savedGreenhouse();
  w.analysis = null;
  assert.ok(!render(w, "analysis").includes('class="btn company-roles-shortcut"'));
});
test("opening the toolbar dialog for a real analysis exposes a separate paid-start action before any results exist", () => {
  const html = renderToStaticMarkup(React.createElement(components.Comparison, {
    w: savedGreenhouse(), open: true, onOpenChange: () => {}, showCard: false,
  }));
  assert.ok(html.includes('aria-label="Company role comparison"'));
  assert.ok(html.includes("Compare company roles"));
  assert.ok(html.includes("Uses API credits only when you start"));
  assert.ok(!html.includes('class="company-comparison-card"'));
});
