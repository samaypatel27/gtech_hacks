import os

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_URL", "http://localhost:5173")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OPENFDA_BASE_URL = "https://api.fda.gov/drug"


@app.get("/")
def read_root():
    return {"message": "Hello from FastAPI"}


@app.get("/api/fda/label/{application_number}")
async def get_fda_label(application_number: str):
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{OPENFDA_BASE_URL}/label.json",
            params={"search": f"openfda.application_number:{application_number}"},
        )

    if response.status_code == 404:
        raise HTTPException(
            status_code=404,
            detail=f"No openFDA label found for application number {application_number}",
        )
    response.raise_for_status()

    results = response.json().get("results", [])
    record = results[0] if results else {}
    openfda = record.get("openfda", {})

    def first_or_default(field):
        values = record.get(field, [])
        return values[0] if values else ""

    return {
        "brand_name": (openfda.get("brand_name") or [""])[0],
        "indications_and_usage": first_or_default("indications_and_usage"),
        "dosage_and_administration": first_or_default("dosage_and_administration"),
        "storage_and_handling": first_or_default("storage_and_handling"),
    }


@app.get("/api/fda/ndc/{application_number}")
async def get_fda_ndc(application_number: str):
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{OPENFDA_BASE_URL}/ndc.json",
            params={"search": f"application_number:{application_number}"},
        )

    if response.status_code == 404:
        raise HTTPException(
            status_code=404,
            detail=f"No openFDA NDC records found for application number {application_number}",
        )
    response.raise_for_status()

    results = response.json().get("results", [])
    ndcs = []
    for result in results:
        for package in result.get("packaging", []):
            ndcs.append(
                {
                    "ndc_10": package.get("package_ndc", ""),
                    "description": package.get("description", ""),
                    "sample": bool(package.get("sample", False)),
                }
            )

    return {"ndcs": ndcs}


@app.get("/api/cms/hcpcs-status/{brand_name}")
async def get_cms_hcpcs_status(brand_name: str):
    has_permanent_code = False

    if not has_permanent_code:
        return {
            "status": "no_code_found",
            "message": (
                f"No permanent HCPCS code was found for '{brand_name}'. "
                "A generic (miscellaneous) code is required until one is assigned."
            ),
        }


@app.get("/api/cms/application-status/{brand_name}")
async def get_cms_application_status(brand_name: str):
    return {
        "application_status": "pending",
        "expected_effective_date": "2025-10-01",
        "source_document": "CMS_2024_HCPCS_Application_Summary.pdf",
    }
