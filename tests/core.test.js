import { signToken } from "../server/auth.js";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import JSZip from "jszip";
import {
  applyRewrite,
  assertEvidence,
  signature,
  analysisSchema,
  prepSchema,
} from "../shared/contracts.js";
import worker, { allowedJobUrl, fetchJob, runAI } from "../server/worker.js";
import { createDemo, demoAnalysis, demoPrep } from "../src/demo.js";
import { extractDocx, patchDocxXml, exportResume } from "../src/documents.js";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Built </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>an API &amp; UI.</w:t></w:r></w:p><w:p><w:r><w:t>Protected</w:t><w:tab/><w:t>field</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`;
test("DOCX extraction has stable IDs and protects complex paragraphs", () => {
  const ps = extractDocx(xml);
  assert.equal(ps[0].text, "Built an API & UI.");
  assert.equal(ps[1].editable, false);
  assert.equal(ps[2].id, "p2");
});
test("XML patch keeps run formatting, table and page setup while escaping edits", () => {
  const ps = extractDocx(xml);
  ps[0].text = "Built a faster API & UI <safely>.";
  const patched = patchDocxXml(xml, ps);
  assert.equal(extractDocx(patched)[0].text, ps[0].text);
  for (const fragment of [
    "w:b",
    "w:i",
    "w:tbl",
    "w:sectPr",
    "12240",
    "Heading1",
  ])
    assert.ok(patched.includes(fragment));
  assert.ok(patched.includes("&lt;safely&gt;"));
  assert.equal(extractDocx(patched)[1].text, "Protectedfield");
});
test("Word edits preserve unchanged runs and text around Unicode insertions", () => {
  for (const value of [
    "Built an API & UI.",
    "Built a reliable API & UI.",
    "🚀 Built an API.",
    "API",
    "",
    "Built <&> an API & UI.",
  ]) {
    const ps = extractDocx(xml);
    ps[0].text = value;
    const out = patchDocxXml(xml, ps);
    const doc = new DOMParser().parseFromString(out, "text/xml");
    const first = doc.getElementsByTagNameNS(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "p",
    )[0];
    assert.equal(
      Array.from(
        first.getElementsByTagNameNS(
          "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          "t",
        ),
      )
        .map((n) => n.textContent)
        .join(""),
      value,
    );
  }
});
test("protected paragraph edits fail closed", () => {
  const ps = extractDocx(xml);
  ps[1].text = "Modified";
  assert.throws(() => patchDocxXml(xml, ps), /unsupported/);
});
test("DOCX export retains other ZIP entries byte-for-byte", async () => {
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  zip.file("word/styles.xml", "<styles>original</styles>");
  zip.file("word/media/example.bin", new Uint8Array([0, 1, 128, 255]));
  const original = await zip.generateAsync({ type: "arraybuffer" });
  const ps = extractDocx(xml);
  ps[0].text = "Built an API and UI.";
  const blob = await exportResume({ kind: "docx", original, paragraphs: ps });
  const result = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.equal(
    await result.file("word/styles.xml").async("string"),
    "<styles>original</styles>",
  );
  assert.deepEqual(
    await result.file("word/media/example.bin").async("uint8array"),
    new Uint8Array([0, 1, 128, 255]),
  );
  assert.equal(
    extractDocx(await result.file("word/document.xml").async("string"))[0].text,
    ps[0].text,
  );
});
test("suggestion application rejects stale source and never mutates baseline", () => {
  const w = createDemo(),
    r = demoAnalysis.rewrites[0];
  const next = applyRewrite(w.paragraphs, r);
  assert.equal(w.baseline.find((p) => p.id === r.paragraphId).text, r.before);
  assert.equal(w.paragraphs.find((p) => p.id === r.paragraphId).text, r.before);
  assert.equal(next.find((p) => p.id === r.paragraphId).text, r.after);
  assert.throws(() => applyRewrite(next, r), /changed/);
});
test("role and resume changes invalidate signatures", () => {
  const w = createDemo(),
    old = signature(w.paragraphs, w.role);
  w.role.text += " New requirement.";
  assert.notEqual(signature(w.paragraphs, w.role), old);
  w.role = createDemo().role;
  w.paragraphs[0].text = "Updated name";
  assert.notEqual(signature(w.paragraphs, w.role), old);
});
test("sample shapes are valid and evidence validation rejects fabricated source", () => {
  const w = createDemo();
  analysisSchema.parse(demoAnalysis);
  prepSchema.parse(demoPrep(w));
  assertEvidence("analyze", demoAnalysis, w.paragraphs);
  assertEvidence("prep", demoPrep(w), w.paragraphs);
  const bad = structuredClone(demoAnalysis);
  bad.matches[0].evidence = "Invented experience";
  assert.throws(() => assertEvidence("analyze", bad, w.paragraphs), /evidence/);
  const duplicate = structuredClone(demoAnalysis);
  duplicate.rewrites[1] = duplicate.rewrites[0];
  assert.throws(
    () => assertEvidence("analyze", duplicate, w.paragraphs),
    /duplicate/,
  );
});
test("job import rejects private, spoofed and unsupported URLs", () => {
  for (const u of [
    "http://jobs.lever.co/a",
    "https://127.0.0.1/a",
    "https://jobs.lever.co.evil.test/a",
    "https://jobs.lever.co:444/a",
    "https://user:pass@jobs.lever.co/a",
    "https://169.254.169.254/",
  ])
    assert.throws(() => allowedJobUrl(u));
  assert.equal(
    allowedJobUrl("https://jobs.lever.co/company/123").hostname,
    "jobs.lever.co",
  );
});
test("job import validates every redirect before fetching", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      fetchJob("https://jobs.lever.co/a", async () => {
        calls++;
        return new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1/private" },
        });
      }),
    /Automatic import/,
  );
  assert.equal(calls, 1);
});
test("gateway denies missing origins, unauthorized calls and unconfigured secrets", async () => {
  const env = {
    ALLOWED_ORIGINS: "https://example.github.io",
    SESSION_SECRET: "a".repeat(64),
    OWNER_GITHUB_ID: "90569344",
    OPENAI_API_KEY: "not-a-real-key",
  };
  const req = (origin, token) =>
    new Request("https://gateway.test/ai", {
      method: "POST",
      headers: {
        ...(origin ? { Origin: origin } : {}),
        Authorization: token || "",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
  assert.equal((await worker.fetch(req(null), env)).status, 403);
  assert.equal((await worker.fetch(req("https://evil.test"), env)).status, 403);
  const unauth = await worker.fetch(req("https://example.github.io"), env);
  assert.equal(unauth.status, 401);
  assert.equal(
    unauth.headers.get("Access-Control-Allow-Origin"),
    "https://example.github.io",
  );
  assert.equal(
    (
      await worker.fetch(req("https://example.github.io"), {
        ALLOWED_ORIGINS: env.ALLOWED_ORIGINS,
      })
    ).status,
    503,
  );
});
test("gateway handles preflight and rejects malformed/oversized input", async () => {
  const env = {
    ALLOWED_ORIGINS: "http://localhost:5173",
    SESSION_SECRET: "a".repeat(64),
    OWNER_GITHUB_ID: "90569344",
    OPENAI_API_KEY: "test",
  };
  const now = Math.floor(Date.now() / 1000);
  const token = await signToken(
    {
      type: "session",
      sub: env.OWNER_GITHUB_ID,
      login: "cam-petrie",
      iat: now,
      exp: now + 3600,
      iss: "http://gateway",
      aud: env.ALLOWED_ORIGINS,
    },
    env.SESSION_SECRET,
  );
  const headers = {
    Origin: env.ALLOWED_ORIGINS,
    Authorization: `Bearer ${token}`,
    "X-Key-Mode": "owner",
  };
  assert.equal(
    (
      await worker.fetch(
        new Request("http://gateway/ai", { method: "OPTIONS", headers }),
        env,
      )
    ).status,
    204,
  );
  assert.equal(
    (
      await worker.fetch(
        new Request("http://gateway/ai", {
          method: "POST",
          headers,
          body: "not json",
        }),
        env,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await worker.fetch(
        new Request("http://gateway/ai", {
          method: "POST",
          headers,
          body: "x".repeat(300001),
        }),
        env,
      )
    ).status,
    400,
  );
});
test("OpenAI request is non-stored and schema/evidence checked", async () => {
  const w = createDemo();
  const result = await runAI(
    {
      task: "rewrite",
      paragraphs: w.paragraphs,
      role: w.role,
      paragraphId: "p6",
    },
    { OPENAI_API_KEY: "test", OPENAI_MODEL: "test-model" },
    async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      const body = JSON.parse(options.body);
      assert.equal(body.store, false);
      assert.equal(body.model, "test-model");
      assert.equal(body.text.format.type, "json_object");
      assert.equal(body.max_output_tokens, 1500);
      assert.equal(body.input[0].role, "system");
      assert.match(body.input[0].content, /JSON/);
      assert.equal(JSON.parse(body.input[1].content).task, "rewrite");
      return Response.json({
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify(demoAnalysis.rewrites[0]),
              },
            ],
          },
        ],
      });
    },
  );
  assert.equal(result.paragraphId, "p6");
});
test("incomplete OpenAI responses fail without applying anything", async () => {
  const w = createDemo();
  await assert.rejects(
    () =>
      runAI(
        { task: "prep", paragraphs: w.paragraphs, role: w.role },
        { OPENAI_API_KEY: "test" },
        async () => Response.json({ status: "incomplete" }),
      ),
    /did not complete/,
  );
});

test("OpenAI errors classify request, model and billing failures without leaking upstream data", async () => {
  const w = createDemo();
  for (const [status, error, expected] of [
    [400, { param: "input", message: "input must contain json; private-resume sk-secret" }, /JSON input format/],
    [400, { param: "model", message: "private-resume sk-secret" }, /model is unavailable/],
    [400, { message: "private-resume sk-secret" }, /request format/],
    [429, { code: "insufficient_quota", message: "private-resume sk-secret" }, /API quota/],
    [429, { type: "insufficient_quota", message: "private-resume sk-secret" }, /API quota/],
    [429, { message: "Request too large; private-resume sk-secret" }, /token rate limit/],
    [429, { message: "private-resume sk-secret" }, /API rate or quota limit/],
    [400, null, /request format/],
  ]) {
    await assert.rejects(
      () => runAI({ task: "analyze", paragraphs: w.paragraphs, role: w.role },
        { OPENAI_API_KEY: "test" },
        async () => error === null ? new Response("not JSON", { status }) : Response.json({ error }, { status })),
      (e) => { assert.match(e.message, expected); assert.doesNotMatch(e.message, /private-resume|sk-secret/); return true; },
    );
  }
});

test("portable backup round-trips original data into a separate workspace", async () => {
  const { File } = await import("node:buffer");
  globalThis.File = File;
  const { toBackup, fromBackup } = await import("../src/storage.js");
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  const source = {
    ...createDemo(),
    kind: "docx",
    filename: "test.docx",
    original: await zip.generateAsync({ type: "arraybuffer" }),
    baseline: extractDocx(xml),
    paragraphs: extractDocx(xml),
  };
  source.paragraphs[0].text = "Built a better API & UI.";
  const backup = toBackup(source);
  const restored = await fromBackup(new File([backup], "backup.json"));
  assert.notEqual(restored.id, source.id);
  assert.equal(restored.paragraphs[0].text, source.paragraphs[0].text);
  assert.equal(restored.baseline[0].text, "Built an API & UI.");
  assert.deepEqual(
    new Uint8Array(restored.original),
    new Uint8Array(source.original),
  );
  const bad = JSON.parse(backup);
  bad.workspace.baseline[0].text = "Forged baseline";
  await assert.rejects(
    () => fromBackup(new File([JSON.stringify(bad)], "bad.json")),
    /baseline/,
  );
});
test("prep rejects missing technical or screening questions", () => {
  const p = demoPrep(createDemo());
  p.questions = p.questions.map((q) => ({ ...q, stage: "screening" }));
  assert.equal(prepSchema.safeParse(p).success, false);
});
