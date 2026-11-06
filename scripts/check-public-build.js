import { access, readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Only application assets belong in the public site. User documents and JSON
// workspace backups must remain in IndexedDB or outside this project.
const assetTypes = new Set([".html", ".css", ".js", ".mjs", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".webmanifest"]);
export async function checkPublicBuild(directory) {
  await access(join(directory, "index.html"));
  let files = 0;
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("Public build contains a symbolic link. Only regular application assets may be deployed.");
      if (entry.isDirectory()) { await walk(join(folder, entry.name)); continue; }
      if (!entry.isFile() || !assetTypes.has(extname(entry.name).toLowerCase()))
        throw new Error("Public build contains an unapproved file type. Remove documents, resume uploads and workspace backups from public assets before publishing.");
      files++;
    }
  }
  await walk(directory);
  return files;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const count = await checkPublicBuild(resolve("dist"));
    console.log(`Public build check passed: ${count} application assets; no document or backup files.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
