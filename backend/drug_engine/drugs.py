"""The drug catalog: search, profile, save (from the drug maker) and label images."""

from datetime import date, timedelta
from typing import Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from billing_rules import code_timeline, is_generic
from core.clock import today
from core.db import supabase
from core.notify import notify_every_practice

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


class ExpectedCode(BaseModel):
    """The product-specific code CMS is expected to assign (quarterly updates
    take effect Jan/Apr/Jul/Oct 1), and its billing unit."""

    code: str = Field(min_length=1)
    type: Literal["permanent", "temporary"] = "permanent"
    unit: str = Field(min_length=1)  # e.g. "1 MG"
    effective_from: date


class CoverageRow(BaseModel):
    """One insurer's policy on the drug. covered/prior_auth null = under review."""

    payer: str = Field(min_length=1)
    covered: bool | None = None
    prior_auth: bool | None = None
    notes: str | None = None
    documentation_requirements: list[str] | None = None


class LaunchDetails(BaseModel):
    """What only the drug maker knows at launch, entered on the drug-maker page."""

    approval_date: date | None = None  # FDA approval: the generic code runs from here
    list_price_per_vial: float | None = Field(default=None, gt=0)
    distributors: list[str] | None = None
    expected_code: ExpectedCode | None = None
    coverage: list[CoverageRow] | None = None


def launch_columns(launch: LaunchDetails, generic_code: Optional[str], ndcs: Optional[list]) -> dict:
    """`drugs` columns from the launch details: the dated `codes` list (generic
    from approval to the day before the expected code, then the expected
    code), distributors, payer_policies, and the list price on each vial NDC.
    Raises ValueError when the dates don't make a valid code list."""
    columns = {}
    if launch.distributors is not None:
        columns["distributors"] = [{"name": n.strip()} for n in launch.distributors if n.strip()]
    if launch.coverage is not None:
        columns["payer_policies"] = [row.model_dump(exclude_none=True) for row in launch.coverage]
    if launch.list_price_per_vial is not None and ndcs:
        columns["ndcs"] = [
            {**n, "list_price": launch.list_price_per_vial} if not n.get("sample") else n for n in ndcs
        ]

    expected = launch.expected_code
    if launch.approval_date or expected:
        codes = []
        if launch.approval_date and generic_code:
            generic = {"code": generic_code, "type": "generic", "from": launch.approval_date.isoformat()}
            if expected:
                if expected.effective_from <= launch.approval_date:
                    raise ValueError("The expected code must take effect after the approval date")
                generic["to"] = (expected.effective_from - timedelta(days=1)).isoformat()
            codes.append(generic)
        if expected:
            codes.append(
                {
                    "code": expected.code.strip().upper(),
                    "type": expected.type,
                    "unit": expected.unit.strip().upper(),
                    "from": expected.effective_from.isoformat(),
                }
            )
        if codes:
            code_timeline(codes, codes[0]["from"])  # raises ValueError on overlaps
            columns["codes"] = codes
    return columns


def _day(iso: str) -> str:
    d = date.fromisoformat(str(iso)[:10])
    return f"{d:%b} {d.day}, {d.year}"


def _launch_message(drug: dict) -> tuple[str, str]:
    """(title, body) of the "new drug" notification sent to every practice."""
    brand = drug.get("brand_name") or drug["application_id"]
    generic = f" ({drug['generic_name']})" if drug.get("generic_name") else ""
    uses = drug.get("approved_uses_and_conditions") or []
    use = f" for {uses[0]['approved_diagnosis']}" if uses and uses[0].get("approved_diagnosis") else ""
    body = f"{brand}{generic} is newly approved{use}."
    try:
        timeline = code_timeline(drug.get("codes") or [], today())
    except ValueError:
        timeline = None
    current = timeline and timeline["current"]
    if current and is_generic(current):
        upcoming = timeline["next"]
        until = (
            f" until {upcoming['code']} takes effect {_day(upcoming['from'])}" if upcoming else " until it gets its own code"
        )
        body += f" It bills under the generic code {current['code']}{until}; we prepare the extra claim paperwork for you."
    body += " Open it to see whether your practice can use it."
    return f"New drug: {brand}", body


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
    launch: LaunchDetails | None = None  # not a column: turned into codes/distributors/payer_policies/ndcs


@router.post("/api/drugs")
def upsert_drug(drug: DrugRecord):
    # exclude_unset: fields the client omitted (e.g. an upstream API call failed)
    # are left untouched on an existing row instead of being overwritten with null.
    row = drug.model_dump(mode="json", exclude_unset=True, exclude={"launch"})
    if drug.launch:
        found = (
            supabase.table("drugs").select("*").eq("application_id", drug.application_id).limit(1).execute().data
        )
        existing = found[0] if found else {}
        generic_code = row.get("generic_billing_code", existing.get("generic_billing_code"))
        try:
            row.update(launch_columns(drug.launch, generic_code, row.get("ndcs", existing.get("ndcs"))))
        except ValueError as err:
            raise HTTPException(status_code=422, detail=str(err))

    saved = supabase.table("drugs").upsert(row, on_conflict="application_id").execute().data[0]

    # A launch tells every practice once (re-saving the drug doesn't repeat it).
    if drug.launch:
        title, body = _launch_message(saved)
        notify_every_practice(
            "launch_message",
            title,
            dedupe_key=f"launch:{saved['application_id']}",
            body=body,
            link=f"/drugs/{saved['application_id']}",
            application_id=saved["application_id"],
        )
    return saved


@router.delete("/api/drugs/{application_id}")
def delete_drug(application_id: str):
    response = supabase.table("drugs").delete().eq("application_id", application_id).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail=f"No drug found for {application_id}")
    return {"deleted": application_id}
