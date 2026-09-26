# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Georgia Tech hackathon project. React (Vite) frontend + FastAPI backend, each with its own `.env` file, backed by a Supabase Postgres project.

```
gtech_hacks/
├── frontend/   # React + Vite app
└── backend/    # FastAPI app
```

## Commands

### Backend (from `backend/`)

```powershell
.\venv\Scripts\Activate.ps1
uvicorn main:app --reload --port 8000
```

No test suite or linter is configured for the backend yet.

### Frontend (from `frontend/`)

```powershell
npm run dev       # dev server at http://localhost:5173
npm run build     # production build
npm run lint      # oxlint
npm run preview   # preview a production build
```

No test suite is configured for the frontend yet.

### Running both together

Both dev servers must run concurrently in separate terminals. The frontend calls the backend at `VITE_API_URL` (`frontend/.env`); the backend allows that origin via `FRONTEND_URL` (`backend/.env`) for CORS.

## Environment variables

Neither `.env` file is committed — only `.env.example` is tracked. After pulling changes that add new variables, diff against `.env.example` and add the new keys to your own `.env`.

- `backend/.env`: `FRONTEND_URL` (CORS origin), plus Supabase connection info — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`. The service role key and DB password are not retrievable via the Supabase MCP server and must be copied from the Supabase dashboard (Settings → API / Settings → Database).
- `frontend/.env`: `VITE_API_URL` (backend base URL). Any variable exposed to the frontend must be prefixed with `VITE_`.

A Supabase MCP server is configured in `.mcp.json` (docs/account/database/debugging/development/functions/branching features enabled) for inspecting the project, running SQL, and reading logs/advisors directly from this session.

## Architecture

### Backend

Single-file FastAPI app (`backend/main.py`). CORS is the only configured middleware, restricted to `FRONTEND_URL`.

- `GET /api/fda/label/{application_number}` and `GET /api/fda/ndc/{application_number}` proxy openFDA live.
- `GET /api/fda/label-extraction/{application_number}` sends the label's indications/dosage/supply sections to Claude (`claude-opus-5`, JSON-schema structured output) to extract dosing, infusion time, preparation, single-dose vial, approved uses, antineoplastic flag and per-field label-section citations. Needs `ANTHROPIC_API_KEY`; returns 503 without it.
- `GET /api/cms/hcpcs-status/{brand_name}` looks the brand up (case-insensitive exact match on "Drug Name") in the CMS ASP NDC-HCPCS crosswalk and payment limit file checked into `backend/data/` (loaded at startup; quarter in `CMS_QUARTER`). NOC codes (J3490/J3590/J9999…) don't count as permanent. Drugs missing from the crosswalk report "no code found", which can be wrong for drugs CMS doesn't price via ASP. Refresh the files each quarter with `python scripts/update_cms_files.py <crosswalk zip url> <payment limit zip url>`.
- `GET /api/cms/application-status/{brand_name}` returns `code_assigned` for crosswalk drugs; otherwise it's still a hardcoded stub pending the CMS HCPCS application summary PDF integration.
- `POST /api/drugs` upserts into the Supabase `drugs` table (PK `application_id`) via the `supabase` Python client using the **service role key** — `drugs` has RLS enabled with no policies, so all DB writes go through the backend, never the frontend. It dumps with `exclude_unset=True`, so omitted fields leave existing column values untouched while explicit `null`s overwrite.
- `GET /api/drugs/search?q=` returns every row (ordered by `brand_name`) when `q` is empty, or an `ilike` brand-name match when it's set. The frontend grid has no search UI and always calls it with no `q`, so in practice this always returns the full seeded set; the `q` filter is left in place for future reuse rather than deleted.
- `GET /api/drugs/profile/{application_id}` returns the full row for one drug (404 if not found) — backs the drug detail page.
- `drugs` columns beyond the original schema: `generic_name`, `approval_date`, `pubchem_query`, `code_status` (`"generic"` | `"permanent"`); `route_of_administration` doubles as the "route" field rather than adding a duplicate column. Seeded via `backend/scripts/resolve_drug_data.py` (resolves NDA/route/approval date against openFDA, writes `backend/scripts/drug_seed_data.json`) and `backend/scripts/seed_drugs.py` (loads that JSON and upserts via the Supabase client) — both re-runnable, network-free after the JSON snapshot exists.

### Frontend

- `main.jsx` wraps `App` in `BrowserRouter` — routing is React Router (`react-router-dom`), route table lives in `App.jsx`.
- `App.jsx` renders `ShaderBackground` once, outside `<Routes>`, so a single fixed full-viewport Three.js canvas (`position: fixed`, `z-index: -1`) persists as a global background behind every page rather than being re-mounted per route.
- Pages live in `src/pages/` and are matched 1:1 to entries in `App.jsx`'s route table. `/temp/*` routes (e.g. `/temp/drug-search`) mark pages that are scaffolding/in-progress rather than final navigation. `/drugs/:applicationId` (`DrugDetailPage.jsx`) is currently a placeholder destination for drug search cards — the real "Considering" detail view for a specific drug is a separate, not-yet-built task.
- Feature UI lives in `src/components/<Feature>/`, colocating the component, its CSS Module, and any mock data (e.g. `DrugSearch/DrugSearch.jsx` + `DrugSearch.module.css` + `mockTherapies.js`). Components in this layer are written route-agnostic — they take data/callbacks as props (e.g. `therapies`, `onSelectTherapy`) rather than reaching into routing or fetching themselves — so pages own data-fetching/wiring and components stay reusable.
- Styling is CSS Modules by default (`*.module.css`, imported as `styles` and referenced via `styles.foo`), not a CSS framework or global stylesheet beyond `index.css`. **Exception:** `src/components/DoctorDashboard/` uses Tailwind CSS instead — `src/tailwind.css` imports only `theme.css` + `utilities.css` (no Preflight), scoped intentionally so it doesn't reset native form/button styling on the rest of the app's plain-CSS pages. Any component using Tailwind classes there imports that file directly. Because Preflight is skipped, native form controls (`<input>`, `<button>`) need explicit `appearance-none border-0 bg-transparent` etc. themselves — nothing resets them for free.
- `DoctorDashboard`'s `DrugSearchGrid.jsx` debounces (300ms) against the live `GET /api/drugs/search?q=` backend endpoint (Enter also searches immediately); `DrugCard.jsx` renders each result as a `react-router-dom` `Link` to `/drugs/:applicationId`, with border/accent color (amber = unclassified generic billing code, green = permanent HCPCS code) derived from `has_permanent_code`/`generic_billing_code`/`permanent_hcpcs_code` on the row. Sibling-dimming on hover is a plain CSS rule (`.drug-grid:hover .drug-card:not(:hover)`) in `tailwind.css`, not React state. `ConsideringDashboard.tsx` (search-then-bento-grid mock) is currently unused/orphaned pending that detail-page work — not deleted since it may be reused.
- `DrugSearch` (a different, older component under `src/components/DrugSearch/`) still runs against local mock data (`mockTherapies.js`); it has not been wired to the backend.
- Styling is CSS Modules throughout (`*.module.css`, imported as `styles` and referenced via `styles.foo`), not a CSS framework or global stylesheet beyond `index.css`.
- Backend calls live in `src/api/` (e.g. `drugMaker.js`), using `VITE_API_URL`. `DrugMakerPage` calls the five FDA/CMS endpoints in parallel from the two `DrugMaker` inputs (application ID → FDA, drug name → CMS), maps each response to `drugs` columns (empty values → `null`), then `POST`s to `/api/drugs`. It skips the save if both the label and NDC calls fail, and omits columns from any call that failed. When two sources map the same column (e.g. `route_of_administration` from label, falling back to NDC), the earlier source in `SOURCES` wins unless its value is null; `citations` is instead concatenated across sources. `deriveColumns` then computes the cross-source columns: `generic_billing_code` (null when a permanent code exists, else J9999 cancer / J3590 BLA / J3490) and `cost_per_dose` (CMS payment limit × Claude's typical adult dose; only possible once a drug has a permanent code).
- `DrugSearch` currently runs against local mock data (`mockTherapies.js`); it has not yet been wired to the FastAPI/Supabase backend.
- Linting is `oxlint`, not ESLint — config in `.oxlintrc.json` enables the `react` and `oxc` plugins with `react/rules-of-hooks` as an error.
