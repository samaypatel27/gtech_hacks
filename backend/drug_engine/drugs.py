"""The drug catalog: search, profile, save (from the drug maker) and label images."""

from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.db import supabase

router = APIRouter()


DAILYMED_BASE_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2"


IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png")


class DrugImageResponse(BaseModel):
    brand_name: str
    setid: Optional[str] = None
    images: list[str]


@router.get("/api/drugs/{brand_name}/images", response_model=DrugImageResponse)
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


@router.get("/api/drugs/search")
def search_drugs(q: str = "", limit: int = 100):
    try:
        query = supabase.table("drugs").select("*")
        if q.strip():
            query = query.ilike("brand_name", f"%{q}%")
        response = query.order("brand_name").limit(limit).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Supabase query failed: {e}")

    return response.data


@router.get("/api/drugs/profile/{application_id}")
def get_drug_profile(application_id: str):
    try:
        response = (
            supabase.table("drugs")
            .select("*")
            .eq("application_id", application_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Supabase query failed: {e}")

    rows = response.data
    if not rows:
        raise HTTPException(status_code=404, detail=f"No drug found for {application_id}")

    return rows[0]


class DrugRecord(BaseModel):
    application_id: str
    brand_name: str | None = None
    generic_name: str | None = None
    generic_billing_code: str | None = None
    dosing_formula: str | None = None
    route_of_administration: str | None = None
    infusion_time_minutes: int | None = None
    preparation_instructions: str | None = None
    storage_requirements: str | None = None
    is_single_dose_vial: bool | None = None
    typical_adult_dose: dict | None = None
    is_antineoplastic: bool | None = None
    approved_uses_and_conditions: list[dict] | None = None
    ndcs: list[dict] | None = None
    cost_per_dose: float | None = None
    citations: list[dict] | None = None
    has_permanent_code: bool | None = None
    permanent_hcpcs_code: str | None = None


@router.post("/api/drugs")
def upsert_drug(drug: DrugRecord):
    # exclude_unset: fields the client omitted (e.g. an upstream API call failed)
    # are left untouched on an existing row instead of being overwritten with null.
    row = drug.model_dump(mode="json", exclude_unset=True)
    response = supabase.table("drugs").upsert(row, on_conflict="application_id").execute()
    return response.data[0]


@router.delete("/api/drugs/{application_id}")
def delete_drug(application_id: str):
    response = supabase.table("drugs").delete().eq("application_id", application_id).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail=f"No drug found for {application_id}")
    return {"deleted": application_id}
