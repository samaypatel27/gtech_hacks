# gtech_hacks

georgia tech hackathon - official repo

Stack: **React (Vite)** frontend + **FastAPI** backend, each with its own `.env` file.

```
gtech_hacks/
├── frontend/   # React + Vite app
└── backend/    # FastAPI app
```

## 1. Install prerequisites (Windows)

- **Node.js** (includes npm): https://nodejs.org (LTS version)
- **Python 3.14** (latest): https://www.python.org/downloads/ — during install, check **"Add python.exe to PATH"**

Check both are installed by opening PowerShell and running:

```powershell
node -v
py -3.14 --version
```

## 2. Backend setup (FastAPI)

Open PowerShell in the project folder and run:

```powershell
cd backend
py -3.14 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

> If activation fails with a "running scripts is disabled" error, run PowerShell as Administrator once and execute:
> `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`
> then try activating again.

Create your `.env` file (copy the example):

```powershell
copy .env.example .env
```

### Run the backend

Every time you want to start the backend, from the `backend` folder:

```powershell
.\venv\Scripts\Activate.ps1
uvicorn main:app --reload --port 8000
```

The API will be running at http://localhost:8000

## 3. Frontend setup (React + Vite)

Open a **new** PowerShell window in the project folder and run:

```powershell
cd frontend
npm install
```

Create your `.env` file (copy the example):

```powershell
copy .env.example .env
```

### Run the frontend

Every time you want to start the frontend, from the `frontend` folder:

```powershell
npm run dev
```

The app will be running at http://localhost:5173

## 4. Using both together

Keep **two PowerShell windows open**: one running the backend (`uvicorn main:app --reload --port 8000`), one running the frontend (`npm run dev`). The frontend reads the backend's URL from `frontend/.env` (`VITE_API_URL`), and the backend allows requests from the frontend's URL via `backend/.env` (`FRONTEND_URL`).

## Environment variables

- `backend/.env` — currently just `FRONTEND_URL` (used for CORS). Add API keys/secrets here as needed.
- `frontend/.env` — currently just `VITE_API_URL` (the backend's address). Any variable exposed to the frontend must be prefixed with `VITE_`.

Neither `.env` file is committed to git — only `.env.example` is. If you pull changes that add new variables, check the `.env.example` files and add the new keys to your own `.env`.
