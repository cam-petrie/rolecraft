import {
  analysisSchema,
  rewriteSchema,
  prepSchema,
  scoreSchema,
  assertEvidence,
  signature,
} from "../shared/contracts.js";
export function normalizeEndpoint(value) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" &&
    !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))
  )
    throw new Error(
      "Use an HTTPS gateway URL, or localhost during development.",
    );
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/")
    throw new Error(
      "Enter the gateway origin only, without a path, credentials or query.",
    );
  return u.origin;
}
export async function gateway(config, path, body, { signal } = {}) {
  const endpoint = normalizeEndpoint(config.endpoint);
  if (!config.token)
    throw new Error(
      "Sign in with GitHub in Settings to use AI or import job links.",
    );
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.token}`,
  };
  if (path === "/ai") {
    headers["X-Key-Mode"] = config.keyMode || "personal";
    if (config.keyMode !== "owner") {
      if (!config.apiKey)
        throw new Error(
          "Add your own OpenAI API key in Settings for this session.",
        );
      headers["X-OpenAI-Key"] = config.apiKey;
    }
  }
  let r;
  try {
    r = await fetch(endpoint + path, {
      method: "POST",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(135000)]) : AbortSignal.timeout(135000),
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    if (signal?.aborted) throw new DOMException("Comparison stopped.", "AbortError");
    throw new Error(
      "Could not reach the gateway. Check its URL and allowed-origin configuration, then try again.",
    );
  }
  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error(
      "The gateway returned an invalid response. Check backend setup.",
    );
  }
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
    ...(task === "rewrite" && workspace.analysis?.signature === signature(workspace.paragraphs, workspace.role)
      ? { currentScore: workspace.analysis.data.score } : {}),
    ...extra,
  });
  return assertEvidence(
    task,
    { analyze: analysisSchema, rewrite: rewriteSchema, prep: prepSchema, score: scoreSchema }[
      task
    ].parse(data),
    workspace.paragraphs,
    workspace.role,
  );
}
