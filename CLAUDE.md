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
- Pages live in `src/pages/` and are matched 1:1 to entries in `App.jsx`'s route table. `/temp/*` routes (e.g. `/temp/drug-search`) mark pages that are scaffolding/in-progress rather than final navigation.
- Feature UI lives in `src/components/<Feature>/`, colocating the component, its CSS Module, and any mock data (e.g. `DrugSearch/DrugSearch.jsx` + `DrugSearch.module.css` + `mockTherapies.js`). Components in this layer are written route-agnostic — they take data/callbacks as props (e.g. `therapies`, `onSelectTherapy`) rather than reaching into routing or fetching themselves — so pages own data-fetching/wiring and components stay reusable.
- Styling is CSS Modules throughout (`*.module.css`, imported as `styles` and referenced via `styles.foo`), not a CSS framework or global stylesheet beyond `index.css`.
- `DrugSearch` currently runs against local mock data (`mockTherapies.js`); it has not yet been wired to the FastAPI/Supabase backend.
- Linting is `oxlint`, not ESLint — config in `.oxlintrc.json` enables the `react` and `oxc` plugins with `react/rules-of-hooks` as an error.
