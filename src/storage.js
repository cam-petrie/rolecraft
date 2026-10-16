import {
  paragraphSchema,
  roleSchema,
  analysisSchema,
  prepSchema,
} from "../shared/contracts.js";
import { importResume } from "./documents.js";
const databases = new Map();
export function workspaceDatabaseName(accountId) {
  if (accountId === null || accountId === undefined) return "rolecraft";
  if (!/^\d+$/.test(String(accountId)))
    throw new Error("Invalid workspace account.");
  return "rolecraft-account-" + accountId;
}
export function createWorkspaceStore(accountId = null) {
  const name = workspaceDatabaseName(accountId);
  function database() {
    if (!databases.has(name))
      databases.set(
        name,
        new Promise((resolve, reject) => {
          const r = indexedDB.open(name, 1);
          r.onupgradeneeded = () =>
            r.result.createObjectStore("workspaces", { keyPath: "id" });
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => {
            databases.delete(name);
            reject(r.error);
          };
        }),
      );
    return databases.get(name);
  }
  async function transact(mode, fn) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("workspaces", mode);
      const request = fn(tx.objectStore("workspaces"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  return {
    listWorkspaces: () => transact("readonly", (s) => s.getAll()),
    saveWorkspace: (w) => transact("readwrite", (s) => s.put(w)),
    deleteWorkspace: (id) => transact("readwrite", (s) => s.delete(id)),
  };
}
export function toBackup(w) {
  const bytes = new Uint8Array(w.original);
  let raw = "";
  for (let i = 0; i < bytes.length; i += 8192)
    raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return JSON.stringify(
    {
      format: "rolecraft",
      version: 1,
      workspace: { ...w, original: btoa(raw) },
    },
    null,
    2,
  );
}
export async function fromBackup(file) {
  if (file.size > 50 * 1024 * 1024) throw new Error("Backup is too large.");
  const { format, version, workspace: w } = JSON.parse(await file.text());
  if (
    format !== "rolecraft" ||
    version !== 1 ||
    !w ||
    !["pdf", "docx", "demo"].includes(w.kind) ||
    typeof w.filename !== "string" ||
    w.filename.length > 500 ||
    !w.role ||
    !Array.isArray(w.versions) ||
    w.versions.length > 1000 ||
    !Number.isFinite(Date.parse(w.createdAt))
  )
    throw new Error("Invalid Rolecraft backup.");
  const check = (p) => paragraphSchema.array().min(1).max(800).parse(p);
  w.paragraphs = check(w.paragraphs);
  w.baseline = check(w.baseline);
  roleSchema.parse(w.role);
  if (
    w.paragraphs.length !== w.baseline.length ||
    w.paragraphs.some(
      (p, i) =>
        p.id !== w.baseline[i].id || p.editable !== w.baseline[i].editable,
    )
  )
    throw new Error("Backup paragraph structure does not match the original.");
  for (const v of w.versions) {
    check(v.paragraphs);
    roleSchema.parse(v.role);
    if (
      typeof v.id !== "string" ||
      typeof v.name !== "string" ||
      typeof v.date !== "string" ||
      v.paragraphs.length !== w.baseline.length ||
      v.paragraphs.some(
        (p, i) =>
          p.id !== w.baseline[i].id || p.editable !== w.baseline[i].editable,
      )
    )
      throw new Error("Invalid version in backup.");
    v.analysis = null;
    v.prep = null;
  }
  if (w.analysis) analysisSchema.parse(w.analysis.data);
  if (w.prep) prepSchema.parse(w.prep.data);
  const bytes = Uint8Array.from(atob(w.original), (c) => c.charCodeAt(0));
  if (bytes.length > 15 * 1024 * 1024)
    throw new Error("Original file is too large.");
  if (w.kind !== "demo") {
    const source = await importResume(new File([bytes], w.filename));
    if (JSON.stringify(source.baseline) !== JSON.stringify(w.baseline))
      throw new Error("Backup baseline does not match its original file.");
  }
  for (const ps of [w.paragraphs, ...w.versions.map((v) => v.paragraphs)])
    if (ps.some((p, i) => !p.editable && p.text !== w.baseline[i].text))
      throw new Error("Backup changed a protected paragraph.");
  w.original = bytes.buffer;
  w.id = crypto.randomUUID();
  w.analysis = null;
  w.prep = null;
  w.decisions = {};
  w.updatedAt = new Date().toISOString();
  return w;
}
