const encoder = new TextEncoder();
const base64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
const decode = (value) =>
  Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export function authReady(env) {
  return Boolean(
    env.SESSION_SECRET?.length >= 64 && /^\d+$/.test(env.OWNER_GITHUB_ID || ""),
  );
}
async function key(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function signToken(payload, secret) {
  const header = base64url(
    encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  );
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  const input = header + "." + body;
  return (
    input +
    "." +
    base64url(
      await crypto.subtle.sign(
        "HMAC",
        await key(secret),
        encoder.encode(input),
      ),
    )
  );
}
export async function verifyToken(token, secret, expected) {
  try {
    if (typeof token !== "string" || token.length > 6000) throw Error();
    const [h, b, s, ...extra] = token.split(".");
    if (extra.length || !h || !b || !s) throw Error();
    const head = JSON.parse(new TextDecoder().decode(decode(h)));
    if (
      head.alg !== "HS256" ||
      head.typ !== "JWT" ||
      !(await crypto.subtle.verify(
        "HMAC",
        await key(secret),
        decode(s),
        encoder.encode(h + "." + b),
      ))
    )
      throw Error();
    const p = JSON.parse(new TextDecoder().decode(decode(b)));
    const now = Math.floor(Date.now() / 1000);
    if (
      p.type !== expected ||
      !Number.isInteger(p.exp) ||
      p.exp <= now ||
      !Number.isInteger(p.iat) ||
      p.iat > now + 30 ||
      p.exp - p.iat > 3600
    )
      throw Error();
    return p;
  } catch {
    throw new Error(
      "Your sign-in has expired or is invalid. Sign in with GitHub again.",
    );
  }
}
export async function authenticate(request, env) {
  if (!authReady(env)) throw new Error("Gateway login is not configured.");
  const bearer = request.headers.get("Authorization") || "";
  if (!bearer.startsWith("Bearer "))
    throw new Error("Sign in with GitHub to use this gateway.");
  const p = await verifyToken(bearer.slice(7), env.SESSION_SECRET, "session");
  if (
    p.iss !== new URL(request.url).origin ||
    p.aud !== request.headers.get("Origin") ||
    !/^\d+$/.test(p.sub) ||
    typeof p.login !== "string" ||
    !p.login
  )
    throw new Error("Invalid account session. Sign in again.");
  return {
    id: p.sub,
    login: p.login,
    owner: p.sub === env.OWNER_GITHUB_ID,
    expiresAt: p.exp * 1000,
  };
}
export function selectApiKey(user, request, env) {
  const mode = request.headers.get("X-Key-Mode") || "personal";
  if (mode === "owner") {
    if (!user.owner)
      throw new Error(
        "Only the configured owner can use the gateway’s OpenAI key.",
      );
    if (!env.OPENAI_API_KEY)
      throw new Error(
        "The owner OpenAI key has not been configured. Add your own key or finish backend setup.",
      );
    return env.OPENAI_API_KEY;
  }
  if (mode !== "personal") throw new Error("Choose a valid OpenAI key mode.");
  const personal = request.headers.get("X-OpenAI-Key") || "";
  if (!/^sk-[A-Za-z0-9_-]{12,1000}$/.test(personal))
    throw new Error(
      "Add your own valid OpenAI API key in Settings. Other accounts cannot use the owner’s key.",
    );
  return personal;
}
function frontend(env) {
  const u = new URL(env.FRONTEND_URL);
  if (
    u.search ||
    u.hash ||
    u.username ||
    u.password ||
    !(
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(u.hostname))
    )
  )
    throw new Error("Invalid frontend URL configuration.");
  return u;
}
function response(body, status = 400, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Type": "text/plain; charset=utf-8",
      ...headers,
    },
  });
}
function cookieName(url) {
  return url.protocol === "https:"
    ? "__Host-rolecraft-oauth"
    : "rolecraft-oauth";
}
function cookie(url, value, age) {
  return `${cookieName(url)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${url.protocol === "https:" ? "; Secure" : ""}`;
}
export async function oauth(request, env, fetcher = fetch) {
  const u = new URL(request.url);
  if (!["/auth/start", "/auth/callback"].includes(u.pathname)) return null;
  if (
    !authReady(env) ||
    !env.GITHUB_CLIENT_ID ||
    !env.GITHUB_CLIENT_SECRET ||
    !env.FRONTEND_URL
  )
    return response(
      "GitHub login is not configured yet. Return to Rolecraft and finish the backend setup.",
      503,
    );
  let dest;
  try {
    dest = frontend(env);
  } catch {
    return response("The frontend URL is not configured correctly.", 503);
  }
  const callback = u.origin + "/auth/callback";
  if (request.method !== "GET") return response("Use GET.", 405);
  if (u.pathname === "/auth/start") {
    const nonce = u.searchParams.get("client_nonce") || "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(nonce))
      return response("Invalid sign-in request. Start from Rolecraft.");
    const state = random(),
      verifier = random();
    const now = Math.floor(Date.now() / 1000);
    const flow = await signToken(
      {
        type: "oauth",
        iat: now,
        exp: now + 600,
        state,
        verifier,
        clientNonce: nonce,
        iss: u.origin,
        aud: dest.origin,
      },
      env.SESSION_SECRET,
    );
    const location = new URL("https://github.com/login/oauth/authorize");
    for (const [k, v] of Object.entries({
      client_id: env.GITHUB_CLIENT_ID,
      redirect_uri: callback,
      state,
      code_challenge: base64url(
        await crypto.subtle.digest("SHA-256", encoder.encode(verifier)),
      ),
      code_challenge_method: "S256",
      scope: "",
      prompt: "select_account",
    }))
      location.searchParams.set(k, v);
    return response("", 302, {
      Location: location.href,
      "Set-Cookie": cookie(u, flow, 600),
    });
  }
  let flow;
  try {
    const raw = (request.headers.get("Cookie") || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(cookieName(u) + "="))
      ?.slice(cookieName(u).length + 1);
    flow = await verifyToken(raw, env.SESSION_SECRET, "oauth");
    if (
      flow.state !== u.searchParams.get("state") ||
      flow.iss !== u.origin ||
      flow.aud !== dest.origin ||
      !flow.verifier ||
      !flow.clientNonce
    )
      throw Error();
  } catch {
    return response(
      "Sign-in verification failed. Return to Rolecraft and sign in again.",
      400,
      { "Set-Cookie": cookie(u, "", 0) },
    );
  }
  try {
    if (u.searchParams.has("error"))
      throw new Error("GitHub sign-in was cancelled.");
    const code = u.searchParams.get("code");
    if (!code || code.length > 1000)
      throw new Error("GitHub did not return an authorization code.");
    const exchange = await fetcher(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: callback,
          code_verifier: flow.verifier,
        }),
      },
    );
    const result = await exchange.json();
    if (!exchange.ok || !result.access_token)
      throw new Error("GitHub could not complete authorization.");
    const profile = await fetcher("https://api.github.com/user", {
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${result.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Rolecraft",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    const user = await profile.json();
    if (
      !profile.ok ||
      !Number.isSafeInteger(user.id) ||
      user.id < 1 ||
      typeof user.login !== "string" ||
      !user.login
    )
      throw new Error("GitHub could not verify your account.");
    // The GitHub access/refresh tokens are discarded; they never reach the frontend.
    const now = Math.floor(Date.now() / 1000);
    const session = await signToken(
      {
        type: "session",
        sub: String(user.id),
        login: user.login,
        iat: now,
        exp: now + 3600,
        iss: u.origin,
        aud: dest.origin,
      },
      env.SESSION_SECRET,
    );
    dest.hash = new URLSearchParams({
      session,
      state: flow.clientNonce,
    }).toString();
  } catch {
    dest.hash = new URLSearchParams({
      auth_error:
        "GitHub sign-in failed or was cancelled. Try signing in again.",
      state: flow.clientNonce,
    }).toString();
  }
  return response("", 302, {
    Location: dest.href,
    "Set-Cookie": cookie(u, "", 0),
  });
}
