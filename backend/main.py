import os
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client

load_dotenv()

# Service role key bypasses RLS; `drugs` has RLS enabled with no policies,
# so it must only ever be used server-side.
supabase = create_client(
    os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_URL", "http://localhost:5173")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OPENFDA_BASE_URL = "https://api.fda.gov/drug"
DAILYMED_BASE_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2"
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png")


class DrugImageResponse(BaseModel):
    brand_name: str
    setid: Optional[str] = None
    images: list[str]


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

    def section(field):
        values = record.get(field, [])
        return {
            "value": values[0] if values else "",
            "citation": f"openfda_label_section: {field}",
        }

    return {
        "brand_name": (openfda.get("brand_name") or [""])[0],
        "indications_and_usage": section("indications_and_usage"),
        "dosage_and_administration": section("dosage_and_administration"),
        "storage_requirements": section("storage_and_handling"),
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

    return {
        "has_permanent_code": has_permanent_code,
        "permanent_hcpcs_code": None,
    }


@app.get("/api/cms/application-status/{brand_name}")
async def get_cms_application_status(brand_name: str):
    return {
        "expected_permanent_code_date": "2025-10-01",
        "citation": "CMS_2024_HCPCS_Application_Summary.pdf",
    }


@app.get("/api/drugs/{brand_name}/images", response_model=DrugImageResponse)
async def get_drug_images(brand_name: str):
    async with httpx.AsyncClient() as client:
        spls_response = await client.get(
            f"{DAILYMED_BASE_URL}/spls.json",
            params={"drug_name": brand_name},
        )
        spls_response.raise_for_status()

        spls_results = spls_response.json().get("data", [])
        if not spls_results:
            return DrugImageResponse(brand_name=brand_name, images=[])

        setid = spls_results[0].get("setid")

        media_response = await client.get(
            f"{DAILYMED_BASE_URL}/spls/{setid}/media.json",
        )
        media_response.raise_for_status()

    media_data = media_response.json().get("data", [])
    media_items = media_data.get("media", []) if isinstance(media_data, dict) else media_data

    images = [
        url
        for item in media_items
        if (url := item.get("url", "")).lower().endswith(IMAGE_EXTENSIONS)
    ]

    return DrugImageResponse(brand_name=brand_name, setid=setid, images=images)


@app.get("/api/drugs/search")
def search_drugs(q: str = "", limit: int = 20):
    if not q.strip():
        return []

    try:
        response = (
            supabase.table("drugs")
            .select("*")
            .ilike("brand_name", f"%{q}%")
            .limit(limit)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Supabase query failed: {e}")

    return response.data
