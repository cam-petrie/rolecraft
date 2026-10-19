# Rolecraft

A private-by-default resume and interview workspace. The React frontend runs on **GitHub Pages**. A small authenticated backend calls **OpenAI**; the owner’s backend API key never goes into the browser or the GitHub Pages build. Other users may enter their own key for the current session.

## What is included

- A document-first workspace with compact top navigation, a large formatted resume viewport and a contextual right panel for the target role, fit review or recommendations.
- Direct paragraph editing on the rendered DOCX page. Enter saves, Escape cancels, and pasted text does not import foreign formatting. Complex or mismatched rendered paragraphs remain read-only.
- Suggestions can be previewed on the resume without saving, then applied or cancelled. An original/draft toggle, zoom controls and fit-to-width keep the document in focus.

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

Open the Local URL printed by Vite, normally `http://127.0.0.1:5173`. Click **Explore an example** to walk through the workflow without an API key. The top resume-library selector switches files; the adjacent upload control adds another resume. For real resumes, upload a file and configure the gateway below. File import, manual editing, versions and exports work without AI access.

```bash
npm test
npm run build
npm run preview
```

`dist/` contains the static site. Relative asset URLs support both `username.github.io` and `username.github.io/repository/` hosting.

## GitHub sign-in and OpenAI access

Read [LOGIN_SETUP.md](./LOGIN_SETUP.md) for the complete backend activation steps.

- Only verified GitHub account **cam-petrie** (immutable ID `90569344`) can use the backend’s optional OpenAI key.
- Other users may sign in with GitHub and use their own OpenAI key for the current session. The backend never falls back to the owner’s key for other accounts.
- Personal keys and signed sessions are held in memory only and cleared on refresh, expiry or sign-out. Personal keys are sent over HTTPS to the gateway for each AI request, so users must trust its operator. They are not intentionally logged or persisted.
- GitHub login requests public identity without repository access, uses state and S256 PKCE, and verifies the account server-side.
- Local resume libraries are separated by GitHub account ID. Earlier drafts remain in the signed-out local workspace and can be moved by backup/import. Browser-profile separation is still needed on shared devices; IndexedDB is not encrypted.
- Anonymous users can edit locally and try the example. AI requests and job-link import require sign-in. The old shared-token login is removed.

The gateway is not deployed yet. Create the Cloudflare account and dedicated GitHub OAuth App, configure the secrets, then follow the activation guide. Until then, sign-in and real AI requests are unavailable and fail closed.

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

Paragraphs with Word fields, tracked changes, tabs, line breaks, content controls and certain embedded objects are read-only to avoid damaging them. The viewport only enables an editor when its rendered text exactly matches the source paragraph; unsupported rendering remains protected. The browser preview is approximate and may use substitute fonts when an original font is unavailable. The editor changes existing paragraph text; it does not add/reorder sections or offer a full Word formatting toolbar. Header/footer text is preserved in the file but is not part of the editable main-body analysis. Mixed bold/italic runs are retained mechanically; review styling around rewritten words. Tracked-change documents should be finalized in Word before uploading.

**PDF uploads become an editable copy of the original design.** Text-based PDFs are inspected locally for the main style: typeface, body and heading sizes, accent color, section rules, name alignment, and dated role lines. A new upload is rebuilt as a flowing resume that follows those choices, so edits wrap instead of trying to preserve every original coordinate. Resumes saved before this copy still recover their earlier line-by-line styling from the original file. Unavailable fonts substitute, graphics and multi-column artwork are not copied, and the copy will not match the uploaded file pixel for pixel. Very pale text is darkened so it stays readable. Use View original to compare before submitting. Scanned/image-only PDFs still need OCR; password-protected PDFs must be unlocked first. A backup from a line-by-line PDF still restores; a backup whose paragraphs were grouped differently has to be re-uploaded.

**PDF export:** Print / Save styled PDF renders the same styled DOCX used by the viewport, rather than the former plain-text print template. Disable browser headers/footers and select the source paper size in the browser print dialog. Word's PDF export remains useful for checking final pagination.

Imports are limited to 15 MB, PDF resumes to 30 pages, role descriptions to 60,000 characters, and AI requests to 800 paragraphs. The AI needs at least three editable paragraphs for its three rewrites. Some unusually complex or long documents will require simplifying the source.

## Storage and privacy

All originals, drafts, roles, versions and interview packs live in this browser’s IndexedDB for this site origin, separated by signed-in GitHub ID or the signed-out local workspace. They are not synced between devices, browser profiles or deployments. Clearing browser data or using private browsing can remove them. Download backups regularly. Backups contain the original file and your personal data; keep them private.

AI requests send resume **text**, the job description and rewrite direction to your configured gateway and OpenAI. Personal-key users also send their own API key to the gateway for that request; it is held in memory and not persisted. The original binary resume is not sent. Job import sends the listing URL to the gateway and fetches it from the job host. Fonts and document parsers are bundled locally; there are no analytics or external font requests.

Changing the resume or role marks existing analysis and prep as outdated. Rewrites only apply while their original paragraph still matches. Restoring any version preserves the current draft in a new automatic snapshot and clears analysis/prep so you regenerate against the restored content. Backup imports are restored into a separate workspace and checked against the original file. Baseline and versions remain unaffected by everyday editing.

## Project layout

- `src/main.jsx` — workflow UI, snapshots, restore, settings and downloads.
- `src/ResumeWorkspace.jsx` — document-centered role, analysis and recommendation panels.
- `src/DocumentViewport.jsx` — formatted resume rendering, safe in-place editing, original PDF canvas view and zoom.
- `src/document-markers.js` — disposable preview markers that map rendered paragraphs to stable Word XML IDs. The original and exported files do not contain these markers.
- `src/documents.js` — DOCX/PDF import, conservative Word XML patching, export and styled print.
- `src/pdf-layout.js` — local PDF font, color and geometry inspection with source-safe style recovery.
- `src/pdf-replica.js` — flowing editable copy that keeps a PDF's type, colors, and section style.
- `src/pdf-docx.js` — line-by-line PDF reconstruction for resumes saved before the flowing copy.
- `src/storage.js` — IndexedDB and portable backups.
- `src/api.js` — authenticated gateway client and response validation.
- `src/demo.js` — explicitly labeled sample data.
- `shared/contracts.js` — request/response schemas, evidence checks and stale-edit guards.
- `server/worker.js` — authenticated OpenAI gateway and job-link import.
- `server/auth.js` — GitHub OAuth, PKCE, signed sessions and owner-only key selection.
- `src/auth.jsx` — sign-in, personal-key controls and in-memory session handling.
- `tests/auth.test.js` — owner isolation, key routing, forged/expired sessions and OAuth checks.
- `server/local.js` — local Node development adapter.
- `tests/core.test.js` — document preservation, stale edits, evidence checks, import safety and gateway tests.
- `.github/workflows/pages.yml` — GitHub Pages deployment.

## Validation status

The production build and all 56 automated tests pass on Node 22. Coverage includes authentication and owner-only key routing, source-grounded AI outputs, Word run preservation, stale-edit guards, PDF font/color extraction, inherited styling, source markers, visual ordering, page dimensions and simple columns. New PDF uploads are also covered for style copying: wrapped lines group into flowing paragraphs, accent color and section rules are kept, and a short dated line keeps a right tab until the line grows. Live GitHub OAuth and OpenAI analysis were verified against the deployed gateway. Browser QA compared single- and two-column styled PDFs with their originals, edited a paragraph in place, confirmed reflow without overlap, inspected the downloaded DOCX for the retained colors/fonts/table/edited text, and recovered styling for a PDF saved before this feature. The styled print document uses the same renderer; the final browser print dialog and Word pagination should be reviewed before submitting a resume. A customer-provided embedded-font PDF was additionally checked against its original for Times New Roman faces, six section rules, centered contact details, right-aligned dates, mixed emphasis and inline-edit preservation. No private resume files are included in the repository. No AI calls were needed for PDF style recovery.


## Official references

- [GitHub Pages custom Actions workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [OpenAI JSON and structured output guidance](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
