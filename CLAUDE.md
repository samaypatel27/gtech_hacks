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

Single-file FastAPI app (`backend/main.py`). CORS is currently the only configured middleware, restricted to `FRONTEND_URL`. Supabase credentials are wired into `.env` but no Supabase client or database access code has been added yet (`requirements.txt` only has `fastapi`, `uvicorn`, `python-dotenv`) — this is the intended next integration point, not yet built.

### Frontend

- `main.jsx` wraps `App` in `BrowserRouter` — routing is React Router (`react-router-dom`), route table lives in `App.jsx`.
- `App.jsx` renders `ShaderBackground` once, outside `<Routes>`, so a single fixed full-viewport Three.js canvas (`position: fixed`, `z-index: -1`) persists as a global background behind every page rather than being re-mounted per route.
- Pages live in `src/pages/` and are matched 1:1 to entries in `App.jsx`'s route table. `/temp/*` routes (e.g. `/temp/drug-search`) mark pages that are scaffolding/in-progress rather than final navigation. `/drugs/:applicationId` (`DrugDetailPage.jsx`) is currently a placeholder destination for drug search cards — the real "Considering" detail view for a specific drug is a separate, not-yet-built task.
- Feature UI lives in `src/components/<Feature>/`, colocating the component, its CSS Module, and any mock data (e.g. `DrugSearch/DrugSearch.jsx` + `DrugSearch.module.css` + `mockTherapies.js`). Components in this layer are written route-agnostic — they take data/callbacks as props (e.g. `therapies`, `onSelectTherapy`) rather than reaching into routing or fetching themselves — so pages own data-fetching/wiring and components stay reusable.
- Styling is CSS Modules by default (`*.module.css`, imported as `styles` and referenced via `styles.foo`), not a CSS framework or global stylesheet beyond `index.css`. **Exception:** `src/components/DoctorDashboard/` uses Tailwind CSS instead — `src/tailwind.css` imports only `theme.css` + `utilities.css` (no Preflight), scoped intentionally so it doesn't reset native form/button styling on the rest of the app's plain-CSS pages. Any component using Tailwind classes there imports that file directly. Because Preflight is skipped, native form controls (`<input>`, `<button>`) need explicit `appearance-none border-0 bg-transparent` etc. themselves — nothing resets them for free.
- `DoctorDashboard`'s `DrugSearchGrid.jsx` debounces (300ms) against the live `GET /api/drugs/search?q=` backend endpoint (Enter also searches immediately); `DrugCard.jsx` renders each result as a `react-router-dom` `Link` to `/drugs/:applicationId`, with border/accent color (amber = unclassified generic billing code, green = permanent HCPCS code) derived from `has_permanent_code`/`generic_billing_code`/`permanent_hcpcs_code` on the row. Sibling-dimming on hover is a plain CSS rule (`.drug-grid:hover .drug-card:not(:hover)`) in `tailwind.css`, not React state. `ConsideringDashboard.tsx` (search-then-bento-grid mock) is currently unused/orphaned pending that detail-page work — not deleted since it may be reused.
- `DrugSearch` (a different, older component under `src/components/DrugSearch/`) still runs against local mock data (`mockTherapies.js`); it has not been wired to the backend.
- Linting is `oxlint`, not ESLint — config in `.oxlintrc.json` enables the `react` and `oxc` plugins with `react/rules-of-hooks` as an error.
