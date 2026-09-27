"""LaunchReady backend: creates the FastAPI app and plugs in each stage's routes.

The code lives in one folder per product stage:
  core/            shared pieces: Supabase + Claude clients, the login check, lookups, task rules
  drug_engine/     behind the scenes: FDA + CMS data, the drug catalog
  consider/        Stage 1: sign-up (NPI), pins, the "can my practice use this?" lights
  workspace/       Stage 2 (Prepare): "Get my team ready", the team board
  treat_and_bill/  Stage 3: patients, orders + signing, documentation check, nurse record, claims
"""

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from consider import lights, pins, practices
from drug_engine import cms, drugs, fda
from treat_and_bill import claims, doc_check, nurse, orders, patients
from workspace import receiving, setup, tasks

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_URL", "http://localhost:5173")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def read_root():
    return {"message": "Hello from FastAPI"}


# Order matters: FastAPI matches routes in the order they're added, and this
# keeps the same order the endpoints had when they all lived in this file.
for module in (
    fda, cms, drugs,                               # drug engine
    practices, pins, lights,                       # consider
    setup, tasks, receiving,                       # workspace
    patients, orders, doc_check, nurse, claims,    # treat & bill
):
    app.include_router(module.router)
