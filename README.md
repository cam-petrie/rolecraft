# Rolecraft

A private-by-default resume and interview workspace. The React frontend runs on **GitHub Pages**. A small authenticated backend calls **OpenAI**; the API key never goes into the browser or the GitHub Pages build.

## What is included

- DOCX and text-based PDF resume upload, with original-file retention.
- Automatic protected baseline; one-click restoration with an automatic snapshot of the current draft.
- Job title, company, link and description. Import supported public Greenhouse, Lever, Ashby and Workday listings, or paste any job description.
- Hiring-manager review using your requested prompt: a 0–100 fit score, five matches with quoted evidence, five screening risks, and three bullet rewrites.
- Accept or dismiss individual suggestions, request alternatives with specific direction, or manually edit existing paragraphs.
- Selected-paragraph rewrite requests with review before applying.
- Word export that patches the original DOCX rather than rebuilding it. It retains document styles, run formatting, tables, images, headers, footers and page settings.
- Named versions that include the target role; restore earlier drafts and download their DOCX files.
- Browser-local autosave, multiple resume workspaces, and portable JSON backup/restore.
- Interview prep from the current draft: evidence-to-requirement mapping, substantive study guides and exercises, screening questions, technical questions, and answer frameworks.
- Downloadable interview study pack in Markdown.
- Clearly labeled example workspace; it works without credentials and uses fixed sample content.
- Responsive layout, keyboard controls and native modal focus containment.

## Start locally

Use Node.js **22 or newer** (the `.nvmrc` selects 22).

```bash
npm ci
npm run dev
```

Open the Local URL printed by Vite, normally `http://127.0.0.1:5173`. Click **Explore an example** to walk through the workflow without an API key. For real resumes, upload a file and configure the gateway below. File import, manual editing, versions and exports work without AI access.

```bash
npm test
npm run build
npm run preview
```

`dist/` contains the static site. Relative asset URLs support both `username.github.io` and `username.github.io/repository/` hosting.

## Connect OpenAI locally

1. Copy `.env.example` to `.dev.vars` (already ignored by Git).
2. Set `OPENAI_API_KEY` there. Never put it in a `VITE_*` variable, source file, frontend setting, repository secret used by the Pages build, or committed configuration.
3. Generate a separate gateway token, for example with `openssl rand -hex 32`, and put it in `GATEWAY_TOKEN`. This token gates your personal backend; it is **not** your OpenAI key.
4. Keep `ALLOWED_ORIGINS` matched to the Vite origin. If Vite chooses another port, update the value accordingly.
5. Start the backend in a second terminal:

```bash
npm run gateway
```

6. In the app, open **Settings & connection**. Enter `http://127.0.0.1:8787` as the gateway URL and the gateway token as the access token.
7. Upload your resume, review its extracted text, add the full job description and click **Analyze role fit**.

The gateway defaults to `gpt-4.1-mini`; set `OPENAI_MODEL` to a Responses-compatible model available to your account. This is a configurable starting value, not a claim that it is the newest model. The gateway requests JSON output, validates its shape, checks quoted evidence and rewrite source text, and rejects invalid or incomplete responses. It sends `store: false`; this does not override OpenAI’s retention policies. You remain responsible for reviewing factual accuracy before accepting edits.

## Deploy the private gateway

GitHub Pages serves static content and cannot keep an API key secret or execute backend requests itself. The included gateway targets Cloudflare Workers; the local Node adapter runs the same handler during development.

Use Node 22+ for Wrangler. Create a Cloudflare account if needed, then:

```bash
npx wrangler login
```

Edit `wrangler.toml`:

- Choose a unique Worker name if desired.
- Set `ALLOWED_ORIGINS` to `https://YOUR-USERNAME.github.io` (origin only, with **no** repository path or trailing slash). Use your custom-domain origin instead if applicable.
- Set your preferred `OPENAI_MODEL`.

Set secrets through Wrangler’s interactive prompts:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GATEWAY_TOKEN
npx wrangler deploy
```

Enter the resulting HTTPS Worker origin and the gateway token in the published app’s Settings. Do **not** put those values in the frontend build. The gateway URL is saved locally; the token is kept in this tab’s session storage and may need to be entered again in a new browser session.

This is a personal-use backend. CORS checks the allowed origin, and all calls require the private token. CORS alone is not authentication. Keep the token private, configure provider spending limits, and rotate the gateway token if it is exposed. There is no public signup or multi-user authorization system and no distributed rate limiter. For a shared service, add individual authentication and per-user quotas before opening access.

The server deliberately imports only allowlisted job-host domains and validates redirects. Other job sites, login-only listings, expired listings and JavaScript-only pages may require pasted text. Imported text should be reviewed to remove navigation or unrelated page content.

## Push to GitHub and publish Pages

Project repository: [cam-petrie/rolecraft](https://github.com/cam-petrie/rolecraft). The Pages URL is `https://cam-petrie.github.io/rolecraft/`. The OpenAI gateway is deployed separately.

To publish a separate copy under another account, create an empty GitHub repository, then run these commands **from this project folder** with your own repository URL:

```bash
git init
git add .
git commit -m "Build Rolecraft resume and interview workspace"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/rolecraft.git
git push -u origin main
```

In the repository, open **Settings → Pages → Build and deployment → Source → GitHub Actions**. The included `.github/workflows/pages.yml` installs locked dependencies, runs the tests, builds the frontend and deploys `dist/` on pushes to `main`. If the first run occurred before Pages was enabled, rerun it from **Actions → Publish GitHub Pages → Run workflow**.

Your site will normally be at `https://YOUR-USERNAME.github.io/rolecraft/`. The GitHub Pages workflow deploys only static assets. Deploy the Worker separately and enter its URL in the app. Never commit resumes, backups, credentials or real job-application data to this repository.

## Formatting and file limits

**DOCX is the preferred source.** Editing changes only text in `word/document.xml`. Equal text keeps its original runs; inserted text inherits a neighboring run’s styling. Fonts, sections, tables, relationships and other ZIP entries are retained. Browser preview is approximate: adding text can change wrapping, page count or visual balance. Review the downloaded file in Word or LibreOffice before submitting it. Exact pagination cannot be guaranteed for arbitrary edits.

Paragraphs with Word fields, tracked changes, tabs, line breaks, content controls and certain embedded objects are read-only to avoid damaging them. The editor changes existing paragraph text; it does not add/reorder sections or offer a full Word formatting toolbar. Header/footer text is preserved in the file but is not part of the editable main-body analysis. Mixed bold/italic runs are retained mechanically; review styling around rewritten words. Tracked-change documents should be finalized in Word before uploading.

**PDF uploads are supported for text extraction and analysis.** PDF is not a reliable round-trip editing format. Edited PDF resumes export to a new clean DOCX layout; the app does not claim to preserve their original design. The original PDF is always downloadable. Scanned/image-only PDFs need OCR before import. Password-protected files must be unlocked first. Legacy `.doc` files must be saved as `.docx` in Word before upload.

**PDF export:** Print / PDF produces a clean text layout using your browser’s print dialog. For a PDF that matches an edited DOCX’s Word formatting, open the downloaded DOCX in Word and use its PDF export. Print / PDF does not reproduce the DOCX layout.

Imports are limited to 15 MB, PDF resumes to 30 pages, role descriptions to 60,000 characters, and AI requests to 800 paragraphs. The AI needs at least three editable paragraphs for its three rewrites. Some unusually complex or long documents will require simplifying the source.

## Storage and privacy

All originals, drafts, roles, versions and interview packs live in this browser’s IndexedDB for this site origin. They are not synced between devices, browser profiles or deployments. Clearing browser data or using private browsing can remove them. Download backups regularly. Backups contain the original file and your personal data; keep them private.

AI requests send resume **text**, the job description and rewrite direction to your configured gateway and OpenAI. The original binary resume is not sent. Job import sends the listing URL to the gateway and fetches it from the job host. Fonts and document parsers are bundled locally; there are no analytics or external font requests.

Changing the resume or role marks existing analysis and prep as outdated. Rewrites only apply while their original paragraph still matches. Restoring any version preserves the current draft in a new automatic snapshot and clears analysis/prep so you regenerate against the restored content. Backup imports are restored into a separate workspace and checked against the original file. Baseline and versions remain unaffected by everyday editing.

## Project layout

- `src/main.jsx` — workflow UI, editing, snapshots, restore, settings and downloads.
- `src/documents.js` — DOCX/PDF import, conservative Word XML patching, export and print.
- `src/storage.js` — IndexedDB and portable backups.
- `src/api.js` — authenticated gateway client and response validation.
- `src/demo.js` — explicitly labeled sample data.
- `shared/contracts.js` — request/response schemas, evidence checks and stale-edit guards.
- `server/worker.js` — authenticated OpenAI gateway and job-link import.
- `server/local.js` — local Node development adapter.
- `tests/core.test.js` — document preservation, stale edits, evidence checks, import safety and gateway tests.
- `.github/workflows/pages.yml` — GitHub Pages deployment.

## Validation status

The production build and all 16 automated core tests pass on Node 22. A dependency audit reports no known vulnerabilities. Browser checks covered the example workflow, accepting an edit, saving a named version, restoring the baseline with an automatic snapshot, study-pack generation, Word preview, DOCX download and re-upload. A text-based PDF upload was verified to extract its four paragraphs correctly. Live OpenAI behavior requires your API key; no live paid requests were made during development. The GitHub Pages workflow builds and publishes the frontend. Worker deployment and live OpenAI verification still require your own backend setup and API key.

## Official references

- [GitHub Pages custom Actions workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [OpenAI JSON and structured output guidance](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
