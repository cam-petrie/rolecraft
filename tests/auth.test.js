import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  signToken,
  verifyToken,
  authenticate,
  selectApiKey,
  oauth,
} from "../server/auth.js";
import worker from "../server/worker.js";
import { workspaceDatabaseName } from "../src/storage.js";
import { normalizeEndpoint } from "../src/api.js";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const env = {
  SESSION_SECRET: "a".repeat(64),
  OWNER_GITHUB_ID: "90569344",
  GITHUB_CLIENT_ID: "test-client-id",
  GITHUB_CLIENT_SECRET: "test-client-secret",
  OPENAI_API_KEY: "owner-secret-key",
  FRONTEND_URL: "https://owner.github.io/rolecraft/",
  ALLOWED_ORIGINS: "https://owner.github.io",
};
async function token(sub = "90569344", extra = {}) {
  const iat = Math.floor(Date.now() / 1000);
  return signToken(
    {
      type: "session",
      sub,
      login: sub === "90569344" ? "cam-petrie" : "other-user",
      iat,
      exp: iat + 3600,
      iss: "https://gateway.test",
      aud: env.ALLOWED_ORIGINS,
      ...extra,
    },
    env.SESSION_SECRET,
  );
}
async function request(sub, path = "/session", headers = {}, extra = {}) {
  return new Request("https://gateway.test" + path, {
    method: "POST",
    headers: {
      Origin: env.ALLOWED_ORIGINS,
      Authorization: "Bearer " + (await token(sub, extra)),
      "Content-Type": "application/json",
      ...headers,
    },
    body: "{}",
  });
}
test("verified owner session is derived from immutable GitHub ID", async () => {
  const user = await authenticate(await request("90569344"), env);
  assert.equal(user.owner, true);
  const other = await authenticate(
    await request("111", "/session", {}, { login: "cam-petrie", owner: true }),
    env,
  );
  assert.equal(other.owner, false);
});
test("session rejects forged, expired, wrong-audience and wrong-issuer tokens", async () => {
  const good = await token();
  await assert.rejects(() =>
    verifyToken(good.slice(0, -5) + "abcde", env.SESSION_SECRET, "session"),
  );
  for (const extra of [
    { exp: 1 },
    { aud: "https://evil.test" },
    { iss: "https://evil.test" },
    { type: "oauth" },
    { sub: "not-a-github-id" },
    { iat: Math.floor(Date.now() / 1000) + 100 },
  ])
    await assert.rejects(async () =>
      authenticate(await request("90569344", "/session", {}, extra), env),
    );
});
test("only owner can select server key; other accounts must supply their own", async () => {
  const owner = await authenticate(await request("90569344"), env),
    other = await authenticate(await request("111"), env);
  assert.equal(
    selectApiKey(
      owner,
      await request("90569344", "/ai", { "X-Key-Mode": "owner" }),
      env,
    ),
    env.OPENAI_API_KEY,
  );
  assert.throws(
    () =>
      selectApiKey(
        other,
        new Request("https://gateway.test/ai", {
          headers: {
            "X-Key-Mode": "owner",
            "X-OpenAI-Key": "sk-another-personal-key",
          },
        }),
        env,
      ),
    /Only the configured owner/,
  );
  assert.throws(
    () => selectApiKey(other, new Request("https://gateway.test/ai"), env),
    /own valid/,
  );
  const own = "sk-personal-key-for-this-user-only";
  assert.equal(
    selectApiKey(
      other,
      new Request("https://gateway.test/ai", {
        headers: { "X-OpenAI-Key": own },
      }),
      env,
    ),
    own,
  );
  assert.equal(
    selectApiKey(
      owner,
      new Request("https://gateway.test/ai", {
        headers: { "X-Key-Mode": "personal", "X-OpenAI-Key": own },
      }),
      env,
    ),
    own,
  );
});
test("non-owner requests are denied before any OpenAI request or body parsing", async () => {
  const r = await worker.fetch(
    await request("111", "/ai", { "X-Key-Mode": "owner" }),
    env,
  );
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /Only the configured owner/);
  const missing = await worker.fetch(await request("111", "/ai"), env);
  assert.equal(missing.status, 403);
});
test("session response never exposes owner key and truthfully marks key availability", async () => {
  for (const sub of ["90569344", "111"]) {
    const r = await worker.fetch(await request(sub), env);
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.owner, sub === "90569344");
    assert.equal(data.ownerKeyAvailable, sub === "90569344");
    assert.ok(!JSON.stringify(data).includes(env.OPENAI_API_KEY));
  }
  const noOwnerKey = { ...env };
  delete noOwnerKey.OPENAI_API_KEY;
  assert.equal(
    (await (await worker.fetch(await request("111"), noOwnerKey)).json())
      .ownerKeyAvailable,
    false,
  );
});
test("old shared gateway token no longer authenticates requests", async () => {
  const r = await worker.fetch(
    new Request("https://gateway.test/ai", {
      method: "POST",
      headers: {
        Origin: env.ALLOWED_ORIGINS,
        Authorization: "Bearer " + "x".repeat(32),
      },
      body: "{}",
    }),
    { ...env, GATEWAY_TOKEN: "x".repeat(32) },
  );
  assert.equal(r.status, 401);
});
test("OAuth start uses random state, PKCE, no repository scope and HttpOnly cookie", async () => {
  const start = await oauth(
    new Request(
      "https://gateway.test/auth/start?client_nonce=" + "a".repeat(43),
    ),
    env,
  );
  assert.equal(start.status, 302);
  const url = new URL(start.headers.get("Location"));
  assert.equal(url.origin, "https://github.com");
  assert.equal(url.searchParams.get("scope"), "");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge").length, 43);
  assert.ok(url.searchParams.get("state").length >= 43);
  assert.match(
    start.headers.get("Set-Cookie"),
    /__Host-rolecraft-oauth=.*HttpOnly; SameSite=Lax; Max-Age=600; Secure/,
  );
});
test("OAuth callback refuses missing cookie or mismatched state without contacting GitHub", async () => {
  let calls = 0;
  const fetcher = () => {
    calls++;
    throw Error();
  };
  assert.equal(
    (
      await oauth(
        new Request("https://gateway.test/auth/callback?code=fake&state=fake"),
        env,
        fetcher,
      )
    ).status,
    400,
  );
  const start = await oauth(
    new Request(
      "https://gateway.test/auth/start?client_nonce=" + "a".repeat(43),
    ),
    env,
  );
  const cookie = start.headers.get("Set-Cookie").split(";")[0];
  assert.equal(
    (
      await oauth(
        new Request("https://gateway.test/auth/callback?code=fake&state=fake", {
          headers: { Cookie: cookie },
        }),
        env,
        fetcher,
      )
    ).status,
    400,
  );
  assert.equal(calls, 0);
});
test("OAuth verifies GitHub identity server-side and never returns GitHub token", async () => {
  const nonce = "a".repeat(43);
  const start = await oauth(
    new Request("https://gateway.test/auth/start?client_nonce=" + nonce),
    env,
  );
  const state = new URL(start.headers.get("Location")).searchParams.get(
    "state",
  );
  const cookie = start.headers.get("Set-Cookie").split(";")[0];
  const callback = await oauth(
    new Request(
      "https://gateway.test/auth/callback?code=one-time-code&state=" + state,
      { headers: { Cookie: cookie } },
    ),
    env,
    async (url, options) => {
      if (url === "https://github.com/login/oauth/access_token") {
        const body = JSON.parse(options.body);
        assert.equal(body.code, "one-time-code");
        assert.equal(body.client_secret, env.GITHUB_CLIENT_SECRET);
        assert.equal(body.redirect_uri, "https://gateway.test/auth/callback");
        assert.equal(body.code_verifier.length, 43);
        return Response.json({ access_token: "github-secret-never-returned" });
      }
      assert.equal(url, "https://api.github.com/user");
      assert.equal(
        options.headers.Authorization,
        "Bearer github-secret-never-returned",
      );
      return Response.json({ id: 90569344, login: "cam-petrie" });
    },
  );
  assert.equal(callback.status, 302);
  const result = new URL(callback.headers.get("Location"));
  assert.equal(result.origin, "https://owner.github.io");
  assert.equal(result.pathname, "/rolecraft/");
  assert.ok(!result.href.includes("github-secret-never-returned"));
  assert.match(callback.headers.get("Set-Cookie"), /Max-Age=0/);
  const fragment = new URLSearchParams(result.hash.slice(1));
  assert.equal(fragment.get("state"), nonce);
  const p = await verifyToken(
    fragment.get("session"),
    env.SESSION_SECRET,
    "session",
  );
  assert.equal(p.sub, "90569344");
  assert.equal(p.aud, env.ALLOWED_ORIGINS);
  assert.equal(p.exp - p.iat, 3600);
});
test("auth endpoints fail closed until OAuth secrets exist", async () => {
  const r = await oauth(
    new Request(
      "https://gateway.test/auth/start?client_nonce=" + "a".repeat(43),
    ),
    {},
  );
  assert.equal(r.status, 503);
});
test("workspace namespaces separate local drafts, owner and other GitHub users", () => {
  assert.equal(workspaceDatabaseName(), "rolecraft");
  assert.notEqual(
    workspaceDatabaseName("90569344"),
    workspaceDatabaseName("111"),
  );
  assert.notEqual(workspaceDatabaseName("111"), workspaceDatabaseName());
  assert.throws(() => workspaceDatabaseName("../other"));
});
test("gateway URLs reject credentials, remote HTTP and injected paths", () => {
  assert.equal(
    normalizeEndpoint("https://gateway.example/"),
    "https://gateway.example",
  );
  assert.equal(
    normalizeEndpoint("http://127.0.0.1:8787"),
    "http://127.0.0.1:8787",
  );
  for (const bad of [
    "http://evil.test",
    "https://user:pass@gateway.example",
    "https://gateway.example/path",
    "https://gateway.example?token=x",
    "javascript:alert(1)",
  ])
    assert.throws(() => normalizeEndpoint(bad));
});
