import http from "node:http";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import worker from "./worker.js";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
try {
  const s = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
  for (const line of s.split("\n")) {
    const m = line.match(/^([A-Z_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]])
      process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
} catch {}
const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 300000) {
        res.writeHead(413);
        res.end("Request too large");
        return;
      }
      chunks.push(c);
    }
    const request = new Request(`http://127.0.0.1:8787${req.url}`, {
      method: req.method,
      headers: req.headers,
      ...(!["GET", "HEAD"].includes(req.method)
        ? { body: Buffer.concat(chunks) }
        : {}),
    });
    const response = await worker.fetch(request, process.env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end("Gateway request failed");
  }
});
server.listen(8787, "127.0.0.1", () =>
  console.log(
    "Rolecraft gateway: http://127.0.0.1:8787 (secrets never logged)",
  ),
);
