# Activate GitHub login and personal OpenAI keys

The frontend is published at https://cam-petrie.github.io/rolecraft/. Login needs the Cloudflare backend and a dedicated GitHub OAuth App. Until that setup is complete, local editing and the example workspace work; AI and job-link imports fail closed.

The initial locked backend was deployed on October 18, 2026 at
`https://rolecraft-gateway.rolecraft.workers.dev`. GitHub OAuth configuration and
backend secrets are still required before login and AI can be enabled.

## Access rules

- GitHub account ID `90569344` (`cam-petrie`) is the configured owner. Only that verified account can select the backend’s `OPENAI_API_KEY`.
- Anyone else can sign in with GitHub, but AI requests require their own OpenAI API key. A missing personal key never falls back to the owner’s key.
- The owner may also choose a personal key for the current session.
- The backend verifies identity through GitHub. A supplied username or an `owner: true` field cannot grant owner access.
- The former shared `GATEWAY_TOKEN` is no longer accepted.

## 1. Create a Cloudflare account and deploy a locked backend

Create an account at https://dash.cloudflare.com/sign-up. Use Node 22+ in the project directory:

```bash
npx wrangler login
npx wrangler deploy
```

The initial deployment does not allow sign-in or AI requests until the required configuration is complete. Note its exact HTTPS origin, for example `https://rolecraft-gateway.YOUR-SUBDOMAIN.workers.dev`.

## 2. Register a dedicated GitHub OAuth App

Open https://github.com/settings/applications/new while signed in as cam-petrie. Use:

- **Application name:** Rolecraft
- **Homepage URL:** `https://cam-petrie.github.io/rolecraft/`
- **Authorization callback URL:** `https://YOUR-EXACT-WORKER-ORIGIN/auth/callback`

Replace the placeholder with the actual Worker hostname; do not literally use `YOUR-EXACT-WORKER-ORIGIN`. Use the exact callback without wildcard matching. Device flow is not used. The application requests your public identity with no repository scope; it is separate from the GitHub CLI authorization used to publish the project.

Copy the public **Client ID** into `GITHUB_CLIENT_ID` in `wrangler.toml`. Generate the OAuth App’s client secret and enter it directly into the Wrangler prompt below. Do not put it in chat, source code, or a frontend environment variable.

## 3. Set backend secrets

```bash
npx wrangler secret put GITHUB_CLIENT_SECRET
```

Generate a session-signing secret locally with `openssl rand -hex 32`, then enter that value at this prompt:

```bash
npx wrangler secret put SESSION_SECRET
```

Only if you want cam-petrie to use a shared backend OpenAI key, set it too:

```bash
npx wrangler secret put OPENAI_API_KEY
```

`OPENAI_API_KEY` is optional. Other signed-in users can supply their own key without a shared key being configured. Never create a frontend `VITE_OPENAI_API_KEY` or commit API keys. Keep the secrets in your password manager or Cloudflare secret storage.

Confirm these public settings in `wrangler.toml`:

```toml
FRONTEND_URL = "https://cam-petrie.github.io/rolecraft/"
ALLOWED_ORIGINS = "https://cam-petrie.github.io"
OWNER_GITHUB_ID = "90569344"
GITHUB_CLIENT_ID = "YOUR-PUBLIC-OAUTH-CLIENT-ID"
```

Then deploy the configured backend:

```bash
npx wrangler deploy
```

## 4. Connect the public site

In GitHub repository **Settings → Secrets and variables → Actions → Variables**, add the repository variable:

- **Name:** `ROLECRAFT_GATEWAY_URL`
- **Value:** the exact HTTPS Worker origin, without `/auth/callback`, a trailing slash, or a repository path.

Run **Actions → Publish GitHub Pages → Run workflow**. This embeds the public gateway URL in the frontend, so visitors do not need to configure it themselves. The URL is public configuration, not a secret.

You can also test one browser immediately: open Rolecraft → **Settings & connection**, save the Worker origin, and click **Sign in with GitHub**. A locally saved URL takes precedence over the build default; clear it to use the site default.

## 5. Verify both account paths before inviting others

1. Sign in as cam-petrie. Settings should show **Owner’s backend key**, if it was configured, and your verified GitHub username.
2. Sign out. Sign in using a different GitHub account. It should show only the personal-key input. AI must refuse a request until that user provides a key.
3. Enter that account’s own key and generate an analysis. Usage is charged to the selected key’s OpenAI account. There are no live paid calls in the automated tests.
4. Refresh or sign out. The personal key and local sign-in session must be cleared, and sign-in must be repeated.

## Session, key and data behavior

OAuth uses an unguessable state, S256 PKCE and a signed, HttpOnly, SameSite=Lax flow cookie. GitHub access and refresh tokens are used only in the callback to fetch the public account identity; they are not sent to the frontend or retained by Rolecraft.

Rolecraft issues a signed one-hour session limited to the gateway issuer and frontend origin. The callback transports it in a URL fragment, which is not sent to GitHub Pages, and the frontend removes the fragment immediately before validating the session with the gateway. Session tokens are held in memory, not localStorage or sessionStorage. The non-secret, one-time login nonce is temporarily held in sessionStorage to prevent login CSRF.

Sign-out clears this browser’s in-memory session and personal key. Already issued session tokens expire after one hour; this version does not maintain a central revocation store. If a session-signing secret or token is compromised, rotate `SESSION_SECRET` to invalidate all sessions immediately. Closing or refreshing the page requires signing in again. Existing requests may finish after sign-out.

A personal OpenAI key is entered by its user, held only in JavaScript memory, and sent over HTTPS to the configured gateway for each AI request. The gateway uses it for that request and does not persist it or intentionally log it. The gateway operator must be trusted: the backend necessarily receives the supplied key. The app states this before key entry. Browser extensions and compromised devices can also inspect browser memory; separate browser profiles are appropriate on shared devices.

IndexedDB workspaces are separated by immutable GitHub ID, with a separate signed-out local workspace. These are local organization boundaries, not encryption or a security boundary against someone who controls the browser profile. Files and versions do not sync to GitHub or Cloudflare. Earlier drafts remain in the signed-out workspace; export a backup while signed out and import it after signing in if you want to move them.

No repository, private email, organization or write scope is requested by Rolecraft’s OAuth App. Anonymous users can try the example and edit files locally, but cannot use the AI backend or fetch job listings through it. GitHub sign-in is open to other accounts; the owner’s OpenAI key is not.

## Local development

Create a separate development OAuth App with callback `http://127.0.0.1:8787/auth/callback`. Copy `.env.example` to `.dev.vars` and fill its OAuth client ID, client secret and signing secret. Keep `FRONTEND_URL=http://127.0.0.1:5173/` and `ALLOWED_ORIGINS=http://127.0.0.1:5173`. Run `npm run dev` and `npm run gateway` in separate terminals. Save `http://127.0.0.1:8787` in app Settings and sign in.

## Operational limits

The gateway does not implement public signup billing, a vault of users’ API keys, centralized session revocation or a distributed rate limiter. All OpenAI requests are authenticated and key selection is enforced on the server. Before broad public promotion, add appropriate edge rate limits and monitor gateway usage. Configure OpenAI spending limits for any backend key. Never add logs of Authorization headers, personal-key headers, OAuth exchange bodies or request bodies containing personal data.

Official implementation references:

- [GitHub OAuth authorization flow, state and PKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [Register a GitHub OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [OpenAI authentication and key safety](https://developers.openai.com/api/reference/overview)
