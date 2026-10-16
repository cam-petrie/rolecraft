import {
  analysisSchema,
  rewriteSchema,
  prepSchema,
  assertEvidence,
} from "../shared/contracts.js";
export async function gateway(config, path, body) {
  const endpoint = new URL(config.endpoint);
  if (
    endpoint.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(endpoint.hostname)
  )
    throw new Error("Use an HTTPS gateway URL.");
  if (!config.token)
    throw new Error(
      "Add your gateway access token in Settings. This is not your OpenAI API key.",
    );
  const r = await fetch(endpoint.href.replace(/\/$/, "") + path, {
    method: "POST",
    signal: AbortSignal.timeout(135000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `Gateway error (${r.status})`);
  return data;
}
export async function callAI(config, task, workspace, extra = {}) {
  if (!config.endpoint)
    throw new Error(
      "Connect your private OpenAI gateway in Settings to use AI with your resume.",
    );
  const data = await gateway(config, "/ai", {
    task,
    paragraphs: workspace.paragraphs,
    role: workspace.role,
    ...extra,
  });
  return assertEvidence(
    task,
    { analyze: analysisSchema, rewrite: rewriteSchema, prep: prepSchema }[
      task
    ].parse(data),
    workspace.paragraphs,
    workspace.role,
  );
}
