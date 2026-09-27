"""Practice sign-up: NPI lookup and the practices table."""

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.db import supabase

router = APIRouter()


NPPES_BASE_URL = "https://npiregistry.cms.hhs.gov/api/"


# Medicare Part B administrative contractor by state (jurisdiction). Real
# CMS MAC assignments, but hand-typed for the states we've checked rather
# than the full 50 -- verify against CMS's current jurisdiction map before
# relying on any state not listed here.
MEDICARE_CONTRACTOR_BY_STATE = {
    "GA": "Palmetto GBA (Jurisdiction J)",
    "AL": "Palmetto GBA (Jurisdiction J)",
    "TN": "Palmetto GBA (Jurisdiction J)",
    "NC": "Palmetto GBA (Jurisdiction M)",
    "SC": "Palmetto GBA (Jurisdiction M)",
    "VA": "Palmetto GBA (Jurisdiction M)",
    "WV": "Palmetto GBA (Jurisdiction M)",
    "FL": "First Coast Service Options (Jurisdiction N)",
    "PR": "First Coast Service Options (Jurisdiction N)",
    "VI": "First Coast Service Options (Jurisdiction N)",
    "CA": "Noridian Healthcare Solutions (Jurisdiction E)",
    "HI": "Noridian Healthcare Solutions (Jurisdiction E)",
    "NV": "Noridian Healthcare Solutions (Jurisdiction E)",
    "TX": "Novitas Solutions (Jurisdiction H)",
    "NY": "National Government Services (Jurisdiction K)",
    "PA": "Novitas Solutions (Jurisdiction L)",
    "NJ": "Novitas Solutions (Jurisdiction L)",
}


class PracticeRecord(BaseModel):
    # Google-verified email, not NPI, is the durable identity going forward
    # (a doctor's NPI is captured once at sign-up, but repeat sign-ins are
    # matched on email since that's what Supabase Auth hands back).
    email: str
    npi: str
    name: str
    specialty: str | None = None
    state: str | None = None
    medicare_contractor: str | None = None
    capabilities: dict | None = None
    payers: list[str] | None = None


@router.get("/api/npi/{number}")
async def get_npi(number: str):
    async with httpx.AsyncClient() as client:
        response = await client.get(NPPES_BASE_URL, params={"version": "2.1", "number": number})
    response.raise_for_status()

    results = response.json().get("results", [])
    if not results:
        raise HTTPException(status_code=404, detail=f"No NPI record found for {number}")

    record = results[0]
    basic = record.get("basic", {})
    is_org = record.get("enumeration_type") == "NPI-2"
    name = (
        basic.get("organization_name")
        if is_org
        else f"{basic.get('first_name', '')} {basic.get('last_name', '')}".strip()
    )

    addresses = record.get("addresses", [])
    location = next((a for a in addresses if a.get("address_purpose") == "LOCATION"), None)
    state = (location or (addresses[0] if addresses else {})).get("state")

    taxonomies = record.get("taxonomies", [])
    primary_taxonomy = next((t for t in taxonomies if t.get("primary")), taxonomies[0] if taxonomies else {})

    return {
        "npi": number,
        "name": name or None,
        "specialty": primary_taxonomy.get("desc"),
        "state": state,
        "medicare_contractor": MEDICARE_CONTRACTOR_BY_STATE.get(
            state, "Not yet mapped for this state — verify with CMS"
        ),
        "enumeration_type": record.get("enumeration_type"),
    }


@router.post("/api/practices")
def upsert_practice(practice: PracticeRecord):
    row = practice.model_dump(mode="json", exclude_unset=True)
    response = supabase.table("practices").upsert(row, on_conflict="email").execute()
    return response.data[0]


@router.get("/api/practices/by-npi/{npi}")
def get_practice_by_npi(npi: str):
    response = supabase.table("practices").select("*").eq("npi", npi).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail=f"No practice found for NPI {npi}")
    return response.data[0]


@router.get("/api/practices/by-email/{email}")
def get_practice_by_email(email: str):
    response = supabase.table("practices").select("*").eq("email", email).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail=f"No practice found for email {email}")
    return response.data[0]
