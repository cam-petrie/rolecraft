import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPublicBuild } from "../scripts/check-public-build.js";

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "rolecraft-public-build-"));
  try {
    const dist = join(root, "dist");
    await mkdir(join(dist, "assets"), { recursive: true });
    await writeFile(join(dist, "index.html"), "<!doctype html><title>Rolecraft</title>");
    await run(dist, root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
test("public build allows application assets, including the PDF parser worker", async () => {
  await fixture(async (dist) => {
    for (const file of ["app.js", "app.css", "pdf.worker.min.mjs", "font.woff2"]) await writeFile(join(dist, "assets", file), "test asset");
    assert.equal(await checkPublicBuild(dist), 5);
  });
});
test("public build rejects documents and workspace backups even in nested asset folders", async () => {
  for (const file of ["resume.PDF", "resume.docx", "resume.doc", "resume.rtf", "resume.odt", "resume.zip", "rolecraft-backup.json", ".env"]) {
    await fixture(async (dist) => {
      await writeFile(join(dist, "assets", file), "private test data");
      await assert.rejects(() => checkPublicBuild(dist), /unapproved file type/);
    });
  }
});
test("public build does not follow symlinks to files outside the build", async () => {
  await fixture(async (dist, root) => {
    const outside = join(root, "private-document");
    await writeFile(outside, "private test data");
    await symlink(outside, join(dist, "assets", "image.svg"));
    await assert.rejects(() => checkPublicBuild(dist), /symbolic link/);
  });
});
