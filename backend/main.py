import csv
import hashlib
import json
import os
import re
from collections import defaultdict
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Optional

import anthropic
import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client
from supabase_auth.errors import AuthError

from billing_rules import (
    admin_codes,
    code_for,
    dose_for,
    item19,
    ndc_10_to_11,
    units,
    vial_mix,
    waste_modifier,
)

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

# Credentials resolve lazily (ANTHROPIC_API_KEY or an `ant auth login` profile),
# so the app still starts without them; only label extraction needs Claude.
claude = anthropic.AsyncAnthropic()

OPENFDA_BASE_URL = "https://api.fda.gov/drug"
DAILYMED_BASE_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2"
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png")


class DrugImageResponse(BaseModel):
    brand_name: str
    setid: Optional[str] = None
    images: list[str]

# Loaded from CMS's quarterly ASP release; refresh with scripts/update_cms_files.py.
CMS_QUARTER = "October 2026"
CMS_DATA_DIR = Path(__file__).resolve().parent / "data"
CROSSWALK_CITATION = f"CMS ASP NDC-HCPCS Crosswalk, {CMS_QUARTER}"
PAYMENT_LIMIT_CITATION = f"CMS Medicare Part B Payment Limit File, {CMS_QUARTER}"

# "Not otherwise classified" codes are what a drug is billed under *until* it
# has its own code, so a crosswalk row pointing at one isn't a permanent code.
NOC_CODES = {"J3490", "J3590", "J7599", "J7699", "J7799", "J8499", "J8999", "J9999", "C9399"}


def normalize_name(name: str) -> str:
    return " ".join(name.lower().split())


def load_crosswalk() -> dict[str, list[dict]]:
    by_brand = defaultdict(list)
    with open(CMS_DATA_DIR / "asp_ndc_hcpcs_crosswalk.csv", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader)
        for code, description, _labeler, _ndc, drug_name, billing_unit, *_ in reader:
            by_brand[normalize_name(drug_name)].append(
                {"code": code, "description": description, "billing_unit": billing_unit}
            )
    return by_brand


def load_payment_limits() -> dict[str, float]:
    limits = {}
    with open(CMS_DATA_DIR / "asp_payment_limits.csv", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader)
        for code, _description, _dosage, limit, *_ in reader:
            try:
                limits[code] = float(limit)
            except ValueError:
                pass  # e.g. "N/A" for products priced outside the ASP methodology
    return limits


CROSSWALK_BY_BRAND = load_crosswalk()
PAYMENT_LIMITS = load_payment_limits()


def find_permanent_codes(brand_name: str) -> list[dict]:
    """One entry per distinct drug-specific HCPCS code the brand's NDCs map to."""
    codes = {}
    for row in CROSSWALK_BY_BRAND.get(normalize_name(brand_name), []):
        if row["code"] not in NOC_CODES and row["code"] not in codes:
            codes[row["code"]] = {
                **row,
                "payment_limit": PAYMENT_LIMITS.get(row["code"]),
            }
    return list(codes.values())


@app.get("/")
def read_root():
    return {"message": "Hello from FastAPI"}


async def fetch_label_record(application_number: str) -> dict:
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
    return results[0] if results else {}


@app.get("/api/fda/label/{application_number}")
async def get_fda_label(application_number: str):
    record = await fetch_label_record(application_number)
    openfda = record.get("openfda", {})

    # Labels vary in which section holds a given piece of info (e.g. storage is
    # often only under "how_supplied"), so use the first field that's present.
    def section(*fields):
        for field in fields:
            values = record.get(field)
            if values:
                return {
                    "value": values[0],
                    "citation": f"openfda_label_section: {field}",
                }
        return {"value": "", "citation": f"openfda_label_section: {fields[0]}"}

    return {
        "brand_name": (openfda.get("brand_name") or [""])[0],
        "generic_name": (openfda.get("generic_name") or [""])[0].lower(),
        # Multi-route drugs (e.g. leucovorin: IM and IV) list every route.
        "route": ", ".join(openfda.get("route") or []),
        "indications_and_usage": section("indications_and_usage"),
        "dosage_and_administration": section("dosage_and_administration"),
        "storage_requirements": section("storage_and_handling", "how_supplied"),
    }


EXTRACTION_SECTIONS = [
    "indications_and_usage",
    "dosage_and_administration",
    "dosage_forms_and_strengths",
    "how_supplied",
    "storage_and_handling",
]

CITED_FIELDS = [
    "dosing_formula",
    "typical_adult_dose",
    "infusion_time_minutes",
    "preparation_instructions",
    "is_single_dose_vial",
    "approved_uses_and_conditions",
]


def nullable(schema: dict) -> dict:
    return {"anyOf": [schema, {"type": "null"}]}


def closed_object(properties: dict) -> dict:
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


EXTRACTION_SCHEMA = closed_object(
    {
        "dosing_formula": nullable({"type": "string"}),
        "typical_adult_dose": nullable(
            closed_object({"amount": {"type": "number"}, "unit": {"type": "string"}})
        ),
        "infusion_time_minutes": nullable({"type": "integer"}),
        "preparation_instructions": nullable({"type": "string"}),
        "is_single_dose_vial": nullable({"type": "boolean"}),
        "is_antineoplastic": {"type": "boolean"},
        "approved_uses_and_conditions": {
            "type": "array",
            "items": closed_object(
                {
                    "approved_diagnosis": {"type": "string"},
                    "prior_therapy": nullable({"type": "string"}),
                    "required_test_method": nullable({"type": "string"}),
                }
            ),
        },
        "citations": {
            "type": "array",
            "items": closed_object(
                {
                    "field": {"type": "string", "enum": CITED_FIELDS},
                    "label_section": {"type": "string", "enum": EXTRACTION_SECTIONS},
                }
            ),
        },
    }
)

EXTRACTION_INSTRUCTIONS = """\
You are extracting facts from an FDA drug label for a medical-billing app. \
Use only what the label sections below state; use null (or an empty list) for \
anything the label does not say rather than inferring it.

- dosing_formula: the dosing rule(s) in one concise line, e.g. \
"200 mg IV every 3 weeks or 400 mg every 6 weeks (adults); 2 mg/kg up to 200 mg every 3 weeks (pediatrics)".
- typical_adult_dose: the most common single adult dose as an amount and unit. \
Prefer a fixed dose (e.g. 200, "mg") when the label gives one. If adult dosing \
is only weight- or BSA-based, give the per-kg or per-m² rate with unit exactly \
"mg/kg" or "mg/m2" (e.g. 10, "mg/kg"). Null only if the label states no adult dose.
- infusion_time_minutes: infusion duration in minutes, if the drug is infused.
- preparation_instructions: the preparation/administration steps a nurse needs \
(dilution, compatible diluents, in-line filters, stability of the prepared product), condensed.
- is_single_dose_vial: true for single-dose vials, false for multiple-dose \
vials, null if not supplied in vials.
- is_antineoplastic: whether the drug is indicated to treat cancer.
- approved_uses_and_conditions: one entry per approved indication, with the \
diagnosis, any required prior therapy, and any required test (e.g. \
"PD-L1 expression (CPS >= 1) by FDA-authorized test").
- citations: for each non-null field above, the label section it came from."""


@app.get("/api/fda/label-extraction/{application_number}")
async def get_fda_label_extraction(application_number: str):
    record = await fetch_label_record(application_number)
    sections = "\n\n".join(
        f"<{field}>\n{record[field][0]}\n</{field}>"
        for field in EXTRACTION_SECTIONS
        if record.get(field)
    )
    if not sections:
        raise HTTPException(
            status_code=404,
            detail=f"openFDA label for {application_number} has no sections to extract from",
        )

    try:
        async with claude.beta.messages.stream(
            model="claude-opus-5",
            max_tokens=64000,
            thinking={"type": "adaptive"},
            # On a safety-classifier decline, re-run on Anthropic's recommended
            # fallback model instead of returning the refusal.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"format": {"type": "json_schema", "schema": EXTRACTION_SCHEMA}},
            messages=[
                {"role": "user", "content": f"{EXTRACTION_INSTRUCTIONS}\n\n{sections}"}
            ],
        ) as stream:
            message = await stream.get_final_message()
    except (anthropic.AuthenticationError, TypeError) as err:
        # The SDK raises TypeError (not an API error) when no credentials are set.
        if isinstance(err, TypeError) and "authentication" not in str(err):
            raise
        raise HTTPException(
            status_code=503,
            detail="Label extraction needs a valid ANTHROPIC_API_KEY in backend/.env",
        )
    except anthropic.APIStatusError as err:
        raise HTTPException(status_code=502, detail=f"Claude API error: {err.message}")
    except anthropic.APIConnectionError:
        raise HTTPException(status_code=502, detail="Could not reach the Claude API")

    if message.stop_reason != "end_turn":
        raise HTTPException(
            status_code=502,
            detail=f"Label extraction stopped early ({message.stop_reason})",
        )

    extraction = json.loads(next(b.text for b in message.content if b.type == "text"))
    extraction["citations"] = [
        {"field": c["field"], "citation": f"openfda_label_section: {c['label_section']}"}
        for c in extraction["citations"]
    ]
    return extraction


@app.get("/api/fda/ndc/{application_number}")
async def get_fda_ndc(application_number: str):
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{OPENFDA_BASE_URL}/ndc.json",
            # openFDA returns only 1 result unless a limit is given (max 1000).
            params={
                "search": f"application_number:{application_number}",
                "limit": 1000,
            },
        )

    if response.status_code == 404:
        raise HTTPException(
            status_code=404,
            detail=f"No openFDA NDC records found for application number {application_number}",
        )
    response.raise_for_status()

    results = response.json().get("results", [])
    route = ", ".join(sorted({route for r in results for route in r.get("route", [])}))
    ndcs = []
    for result in results:
        for package in result.get("packaging", []):
            ndc_10 = package.get("package_ndc", "")
            try:
                ndc_11 = ndc_10_to_11(ndc_10)
            except ValueError:
                ndc_11 = None  # malformed upstream NDC; keep the package, skip the conversion
            ndcs.append(
                {
                    "ndc_10": ndc_10,
                    "ndc_11": ndc_11,
                    "description": package.get("description", ""),
                    "sample": bool(package.get("sample", False)),
                }
            )

    return {"route": route, "ndcs": ndcs}


@app.get("/api/cms/hcpcs-status/{brand_name}")
async def get_cms_hcpcs_status(brand_name: str):
    codes = find_permanent_codes(brand_name)
    if not codes:
        return {
            "status": "no_code_found",
            "has_permanent_code": False,
            "permanent_hcpcs_code": None,
            "codes": [],
            "message": (
                f"No permanent HCPCS code was found for '{brand_name}' in the "
                f"{CROSSWALK_CITATION}. A generic (miscellaneous) code is required "
                "until one is assigned."
            ),
            "citation": CROSSWALK_CITATION,
        }

    code_list = ", ".join(c["code"] for c in codes)
    return {
        "status": "code_found",
        "has_permanent_code": True,
        "permanent_hcpcs_code": code_list,
        # Each code's billing unit (e.g. "1 MG") and Medicare payment limit per unit.
        "codes": codes,
        "message": f"'{brand_name}' bills under {code_list} per the {CROSSWALK_CITATION}.",
        "citation": CROSSWALK_CITATION,
        "payment_limit_citation": PAYMENT_LIMIT_CITATION,
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
def search_drugs(q: str = "", limit: int = 100):
    try:
        query = supabase.table("drugs").select("*")
        if q.strip():
            query = query.ilike("brand_name", f"%{q}%")
        response = query.order("brand_name").limit(limit).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Supabase query failed: {e}")

    return response.data


@app.get("/api/drugs/profile/{application_id}")
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


@app.post("/api/drugs")
def upsert_drug(drug: DrugRecord):
    # exclude_unset: fields the client omitted (e.g. an upstream API call failed)
    # are left untouched on an existing row instead of being overwritten with null.
    row = drug.model_dump(mode="json", exclude_unset=True)
    response = supabase.table("drugs").upsert(row, on_conflict="application_id").execute()
    return response.data[0]


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


@app.get("/api/npi/{number}")
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


@app.post("/api/practices")
def upsert_practice(practice: PracticeRecord):
    row = practice.model_dump(mode="json", exclude_unset=True)
    response = supabase.table("practices").upsert(row, on_conflict="email").execute()
    return response.data[0]


@app.get("/api/practices/by-npi/{npi}")
def get_practice_by_npi(npi: str):
    response = supabase.table("practices").select("*").eq("npi", npi).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail=f"No practice found for NPI {npi}")
    return response.data[0]


@app.get("/api/practices/by-email/{email}")
def get_practice_by_email(email: str):
    response = supabase.table("practices").select("*").eq("email", email).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail=f"No practice found for email {email}")
    return response.data[0]


# Unlike the email-in-the-URL endpoints above, this trusts only a verified
# Supabase Auth session: the frontend sends the user's access token and
# Supabase itself confirms which email it belongs to.
def current_practice(authorization: Optional[str] = Header(default=None)) -> dict:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    try:
        user = supabase.auth.get_user(token).user
    except AuthError:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    if not user or not user.email:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    response = supabase.table("practices").select("*").eq("email", user.email).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail=f"No practice found for email {user.email}")
    return response.data[0]


@app.get("/api/pins")
def list_pins(practice: dict = Depends(current_practice)):
    response = (
        supabase.table("pinned_drugs")
        .select("application_id")
        .eq("practice_id", practice["id"])
        .execute()
    )
    return [row["application_id"] for row in response.data]


# PUT/DELETE rather than a toggle so a repeated request (double-click,
# retry) can't flip the pin back.
@app.put("/api/pins/{application_id}", status_code=204)
def pin_drug(application_id: str, practice: dict = Depends(current_practice)):
    drug_resp = (
        supabase.table("drugs").select("application_id").eq("application_id", application_id).limit(1).execute()
    )
    if not drug_resp.data:
        raise HTTPException(status_code=404, detail=f"No drug found for {application_id}")
    supabase.table("pinned_drugs").upsert(
        {"practice_id": practice["id"], "application_id": application_id},
        on_conflict="practice_id,application_id",
        ignore_duplicates=True,
    ).execute()


@app.delete("/api/pins/{application_id}", status_code=204)
def unpin_drug(application_id: str, practice: dict = Depends(current_practice)):
    (
        supabase.table("pinned_drugs")
        .delete()
        .eq("practice_id", practice["id"])
        .eq("application_id", application_id)
        .execute()
    )


class ConsideringRequest(BaseModel):
    email: str
    application_id: str


# One field: the citation strings from `drugs.citations` (Claude's
# label-extraction citations) that back a given light, so the light can
# show its own sources instead of a raw field list.
def _citations_for(drug, fields):
    citations = drug.get("citations") or []
    return [c["citation"] for c in citations if c.get("field") in fields]


def _billing_path_light(drug):
    if drug.get("has_permanent_code"):
        code = drug.get("permanent_hcpcs_code") or "—"
        return {
            "color": "green",
            "text": f"Permanent code {code}.",
            "sources": _citations_for(drug, ["has_permanent_code", "permanent_hcpcs_code"]),
        }
    code = drug.get("generic_billing_code")
    if not code:
        return {"color": "gray", "text": "Billing code not yet available.", "sources": []}
    return {
        "color": "yellow",
        "text": f"Billed under generic code {code} until a permanent code is assigned.",
        "sources": _citations_for(drug, ["generic_billing_code"]),
    }


def _payment_timing_light(drug):
    cost = drug.get("cost_per_dose")
    if cost is None:
        return {"color": "gray", "text": "Cost per dose not yet available.", "sources": []}
    if drug.get("has_permanent_code"):
        return {
            "color": "green",
            "text": f"${cost} per dose under the permanent code.",
            "sources": _citations_for(drug, ["cost_per_dose"]),
        }
    return {
        "color": "yellow",
        "text": f"${cost} per dose — generic-code claims are typically priced by hand and pay slower.",
        "sources": _citations_for(drug, ["cost_per_dose"]),
    }


# Storage/route are free text from the label, not structured flags, so this
# is a keyword heuristic against the practice's capabilities checklist --
# good enough to demo, not a real requirements parser.
def _workflow_light(drug, practice):
    storage = (drug.get("storage_requirements") or "").lower()
    route = (drug.get("route_of_administration") or "").lower()
    if not storage and not route:
        return {"color": "gray", "text": "Workflow requirements not yet available.", "sources": []}

    capabilities = (practice or {}).get("capabilities") or {}
    missing = []
    if "refrigerat" in storage and not capabilities.get("refrigeration"):
        missing.append("refrigeration")
    # "intravenous" (openFDA's spelled-out form) doesn't contain "iv" as a
    # substring, so that needs its own check alongside the abbreviation.
    if (
        "intravenous" in route or "infusion" in route or "iv" in route.split("/")
    ) and not capabilities.get("infusion_chairs"):
        missing.append("infusion chairs")

    sources = _citations_for(drug, ["storage_requirements", "route_of_administration"])
    if missing:
        return {
            "color": "yellow",
            "text": f"Your practice profile doesn't list: {', '.join(missing)}.",
            "sources": sources,
        }
    return {
        "color": "green",
        "text": "Your practice has what this drug's label requires.",
        "sources": sources,
    }


# Coverage needs real insurer policy documents (per drug, per payer) that
# nothing in this app fetches or parses yet -- always the same default
# until that exists, rather than fabricating a coverage status.
_DEFAULT_COVERAGE_LIGHT = {
    "color": "gray",
    "text": "Coverage information not yet available for your payers.",
    "sources": [],
}


@app.post("/api/practice-drugs/considering")
def get_or_create_considering(payload: ConsideringRequest):
    practice_resp = (
        supabase.table("practices").select("*").eq("email", payload.email).limit(1).execute()
    )
    if not practice_resp.data:
        raise HTTPException(status_code=404, detail=f"No practice found for email {payload.email}")
    practice = practice_resp.data[0]

    drug_resp = (
        supabase.table("drugs")
        .select("*")
        .eq("application_id", payload.application_id)
        .limit(1)
        .execute()
    )
    if not drug_resp.data:
        raise HTTPException(status_code=404, detail=f"No drug found for {payload.application_id}")
    drug = drug_resp.data[0]

    lights = {
        "coverage": _DEFAULT_COVERAGE_LIGHT,
        "billing_path": _billing_path_light(drug),
        "payment_timing": _payment_timing_light(drug),
        "workflow": _workflow_light(drug, practice),
    }

    # Only `lights` (+ the conflict key) is in this payload, so an existing
    # row's status/hold_list/etc. from a later decision are left untouched
    # -- this only ever refreshes the computed lights on each page visit.
    row = {
        "practice_id": practice["id"],
        "application_id": payload.application_id,
        "lights": lights,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    response = (
        supabase.table("practice_drugs")
        .upsert(row, on_conflict="practice_id,application_id")
        .execute()
    )
    return response.data[0]


def _build_purchasing_instruction(drug: dict) -> str:
    brand = drug.get("brand_name") or "this drug"
    distributors = drug.get("distributors")
    if distributors and isinstance(distributors, list) and len(distributors) > 0:
        dist_text = ", ".join(
            d.get("name", str(d)) if isinstance(d, dict) else str(d)
            for d in distributors
        )
    else:
        dist_text = "not yet available"
    ndcs = drug.get("ndcs")
    if ndcs and isinstance(ndcs, list) and len(ndcs) > 0:
        ndc_samples = [
            n.get("ndc_10", "") if isinstance(n, dict) else str(n)
            for n in ndcs[:3]
        ]
        ndc_text = ", ".join(ndc_samples)
    else:
        ndc_text = "not yet available"
    return (
        f"Order {brand} from your distributor. "
        f"Distributors: {dist_text}. "
        f"NDC(s): {ndc_text}. "
        "Confirm availability and pricing before placing the order."
    )


def _build_receiving_instruction(drug: dict) -> str:
    brand = drug.get("brand_name") or "this drug"
    storage = drug.get("storage_requirements") or "not yet available"
    return (
        f"When {brand} arrives, inspect the shipment and verify the NDC and lot number "
        f"match the purchase order. "
        f"Storage requirements: {storage}. "
        "Record the vials received in stock and file the invoice."
    )


def _build_nurse_instruction(drug: dict) -> str:
    brand = drug.get("brand_name") or "this drug"
    formula = drug.get("dosing_formula") or "not yet available"
    route = drug.get("route_of_administration") or "not yet available"
    infusion_min = drug.get("infusion_time_minutes")
    infusion_text = f"{infusion_min} minutes" if infusion_min is not None else "not yet available"
    prep = drug.get("preparation_instructions") or "not yet available"
    return (
        f"Prepare to administer {brand}. "
        f"Dosing formula: {formula}. "
        f"Route: {route}. "
        f"Infusion time: {infusion_text}. "
        f"Preparation instructions: {prep}. "
        "Record the date of service, dose given, vials used (NDC, lot), "
        "and start/stop times for each administration."
    )


def _build_billing_instruction(drug: dict) -> str:
    brand = drug.get("brand_name") or "this drug"
    if drug.get("has_permanent_code"):
        code = drug.get("permanent_hcpcs_code") or "not yet available"
        code_note = f"permanent HCPCS code {code}"
    else:
        code = drug.get("generic_billing_code") or "not yet available"
        code_note = f"generic (miscellaneous) billing code {code} until a permanent code is assigned"
    return (
        f"{brand} bills under {code_note}. "
        "Units: 1 for a generic code; for a permanent code, units equal dose divided by the "
        "billing unit rounded up. "
        "Include the 11-digit NDC on every claim line. "
        "Apply modifier JW for discarded waste from a single-dose vial, or JZ if there is no waste. "
        "An invoice from the distributor is required as a claim attachment. "
        "Check the payer's prior-authorization requirements before the first treatment."
    )


@app.post("/api/practice-drugs/{practice_drug_id}/team-ready")
def team_ready(practice_drug_id: int):
    # Fetch the practice_drugs row to confirm it exists and to get application_id.
    pd_resp = (
        supabase.table("practice_drugs")
        .select("*")
        .eq("id", practice_drug_id)
        .limit(1)
        .execute()
    )
    if not pd_resp.data:
        raise HTTPException(
            status_code=404,
            detail=f"No practice_drugs row found for id {practice_drug_id}",
        )
    practice_drug = pd_resp.data[0]

    # Idempotent: if tasks already exist for this practice_drug, return them
    # without inserting again.  A second click on "Get my team ready" is a
    # no-op -- the user just gets navigated to the workspace that already exists.
    existing_resp = (
        supabase.table("tasks")
        .select("*")
        .eq("practice_drug_id", practice_drug_id)
        .order("id")
        .execute()
    )
    if existing_resp.data:
        return {
            "practice_drug_id": practice_drug_id,
            "status": practice_drug["status"],
            "tasks": existing_resp.data,
        }

    # Fetch the drug row so we can write instruction text from real field values.
    drug_resp = (
        supabase.table("drugs")
        .select("*")
        .eq("application_id", practice_drug["application_id"])
        .limit(1)
        .execute()
    )
    drug = drug_resp.data[0] if drug_resp.data else {}

    # Advance the practice's status with this drug to 'adopting'.
    supabase.table("practice_drugs").update(
        {"status": "adopting", "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", practice_drug_id).execute()

    # Insert the four prepare-stage task cards.  `status` defaults to 'todo'
    # in the DB, but we set it explicitly so the insert is self-documenting.
    tasks = [
        {
            "practice_drug_id": practice_drug_id,
            "stage": "prepare",
            "role": "front_desk",
            "kind": "purchasing",
            "title": "Purchasing",
            "instruction": _build_purchasing_instruction(drug),
            "status": "todo",
        },
        {
            "practice_drug_id": practice_drug_id,
            "stage": "prepare",
            "role": "front_desk",
            "kind": "receiving",
            "title": "Receiving",
            "instruction": _build_receiving_instruction(drug),
            "status": "todo",
        },
        {
            "practice_drug_id": practice_drug_id,
            "stage": "prepare",
            "role": "nurse",
            "kind": "nurse_setup",
            "title": "Nurse setup",
            "instruction": _build_nurse_instruction(drug),
            "status": "todo",
        },
        {
            "practice_drug_id": practice_drug_id,
            "stage": "prepare",
            "role": "biller",
            "kind": "billing_setup",
            "title": "Billing setup",
            "instruction": _build_billing_instruction(drug),
            "status": "todo",
        },
    ]
    task_resp = supabase.table("tasks").insert(tasks).execute()
    created = task_resp.data

    # Dependencies need the new ids, so they're set after the insert:
    # Receiving waits on Purchasing.
    id_by_kind = {t["kind"]: t["id"] for t in created}
    receiving = next(t for t in created if t["kind"] == "receiving")
    receiving["waits_on"] = [id_by_kind["purchasing"]]
    supabase.table("tasks").update({"waits_on": receiving["waits_on"]}).eq(
        "id", receiving["id"]
    ).execute()

    return {
        "practice_drug_id": practice_drug_id,
        "status": "adopting",
        "tasks": created,
    }



ROLE_LABELS = {"doctor": "Doctor", "front_desk": "Front Desk", "nurse": "Nurse", "biller": "Biller"}


def _task_label(task: dict) -> str:
    return f"{task['title']} ({ROLE_LABELS.get(task['role'], task['role'])})"


def _waiting_on(task: dict, tasks_by_id: dict[int, dict]) -> list[str]:
    """Labels of the tasks in `waits_on` that aren't done yet -- the card's
    "Waiting on: ..." line. Empty means the task can be worked on now. A
    dependency that no longer exists doesn't block."""
    return [
        _task_label(tasks_by_id[dep])
        for dep in (int(d) for d in task.get("waits_on") or [])
        if dep in tasks_by_id and tasks_by_id[dep]["status"] != "done"
    ]


def _raise_if_waiting(task: dict) -> None:
    """409 "Waiting on: ..." while any task in `waits_on` is unfinished."""
    if not task.get("waits_on"):
        return
    deps_resp = (
        supabase.table("tasks")
        .select("id,title,role,status")
        .in_("id", [int(d) for d in task["waits_on"]])
        .execute()
    )
    waiting_on = _waiting_on(task, {t["id"]: t for t in deps_resp.data or []})
    if waiting_on:
        raise HTTPException(status_code=409, detail=f"Waiting on: {', '.join(waiting_on)}")


@app.get("/api/practice-drugs/{practice_drug_id}/tasks")
def get_practice_drug_tasks(practice_drug_id: int):
    """Return tasks plus the full practice_drug context and a drug summary,
    so the workspace page has everything it needs in one request."""
    pd_resp = (
        supabase.table("practice_drugs")
        .select("*")
        .eq("id", practice_drug_id)
        .limit(1)
        .execute()
    )
    if not pd_resp.data:
        raise HTTPException(
            status_code=404,
            detail=f"No practice_drugs row found for id {practice_drug_id}",
        )
    practice_drug = pd_resp.data[0]

    drug_resp = (
        supabase.table("drugs")
        .select("brand_name,application_id,codes,approval_date,storage_requirements")
        .eq("application_id", practice_drug["application_id"])
        .limit(1)
        .execute()
    )
    drug_row = drug_resp.data[0] if drug_resp.data else {}

    tasks_resp = (
        supabase.table("tasks")
        .select("*")
        .eq("practice_drug_id", practice_drug_id)
        .order("id")
        .execute()
    )

    tasks = tasks_resp.data or []
    tasks_by_id = {t["id"]: t for t in tasks}
    # Per-patient cards also carry who they're for, so the board can link
    # "Order + sign" to that patient's chart.
    patients = _patients_by_treatment([t["treatment_id"] for t in tasks if t.get("treatment_id")])
    for t in tasks:
        t["waiting_on"] = _waiting_on(t, tasks_by_id)
        patient = patients.get(t.get("treatment_id"))
        t["patient_id"] = patient["id"] if patient else None
        t["patient_name"] = _patient_name(patient) if patient else None

    hold_list = practice_drug.get("hold_list") or []
    stock = practice_drug.get("stock_on_hand") or []

    return {
        # Kept for backward compat with the DrugSearchGrid workspaces list.
        "drug_name": drug_row.get("brand_name", ""),
        "drug": {
            "brand_name": drug_row.get("brand_name", ""),
            "application_id": drug_row.get("application_id", ""),
            "codes": drug_row.get("codes") or [],
            "approval_date": drug_row.get("approval_date"),
            "storage_requirements": drug_row.get("storage_requirements"),
        },
        "practice_drug": {
            "id": practice_drug["id"],
            "status": practice_drug["status"],
            "planned_patients_per_month": practice_drug.get("planned_patients_per_month"),
            "hold_list_count": len(hold_list),
            "stock_on_hand": stock,
            "ready_at": practice_drug.get("ready_at"),
        },
        "tasks": tasks,
    }


def _recalculate_readiness(practice_drug_id: int) -> None:
    """After any task update, check whether the workspace has reached 'active'.
    All setup (stage='prepare') tasks done AND stock_on_hand non-empty with total
    quantity > 0 → active. If a setup task is un-done and status was active →
    revert to adopting. Per-patient and Switch tasks don't count: an open
    "Give Maria's infusion" must not knock the drug out of Ready. Stock only
    gates reaching Ready: once active, running out (vials used on patients) is
    handled by "Buy for this patient" cards, not by un-readying the drug."""
    tasks_resp = (
        supabase.table("tasks")
        .select("status")
        .eq("practice_drug_id", practice_drug_id)
        .eq("stage", "prepare")
        .execute()
    )
    pd_resp = (
        supabase.table("practice_drugs")
        .select("status,stock_on_hand")
        .eq("id", practice_drug_id)
        .limit(1)
        .execute()
    )
    if not pd_resp.data:
        return

    practice_drug = pd_resp.data[0]
    tasks = tasks_resp.data or []

    all_done = tasks and all(t["status"] == "done" for t in tasks)
    stock = practice_drug.get("stock_on_hand") or []
    has_stock = bool(stock) and sum(
        (s.get("quantity") or 0) for s in stock if isinstance(s, dict)
    ) > 0

    if practice_drug["status"] != "active" and all_done and has_stock:
        supabase.table("practice_drugs").update(
            {
                "status": "active",
                "ready_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", practice_drug_id).execute()
    elif practice_drug["status"] == "active" and not all_done:
        # A setup task was un-done — revert.
        supabase.table("practice_drugs").update(
            {
                "status": "adopting",
                "ready_at": None,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", practice_drug_id).execute()


class TaskUpdate(BaseModel):
    status: Optional[str] = None   # 'todo' | 'done' (tasks_status_check allows only these)
    inputs: Optional[dict] = None  # merged non-destructively into existing inputs


@app.patch("/api/tasks/{task_id}")
def update_task(task_id: int, payload: TaskUpdate):
    """Update a task's status and/or inputs.  Inputs are merged (not replaced):
    existing keys not in the payload survive.  Recalculates workspace readiness."""
    if payload.status is not None and payload.status not in ("todo", "done"):
        raise HTTPException(status_code=422, detail="status must be 'todo' or 'done'")

    # Fetch the current task to get practice_drug_id and existing inputs.
    current_resp = supabase.table("tasks").select("*").eq("id", task_id).limit(1).execute()
    if not current_resp.data:
        raise HTTPException(status_code=404, detail=f"No task found for id {task_id}")
    current = current_resp.data[0]

    if (
        payload.status is not None
        and payload.status != current["status"]
        and current["kind"] in PAGE_COMPLETED_KINDS
    ):
        raise HTTPException(status_code=409, detail=PAGE_COMPLETED_KINDS[current["kind"]])
    if (
        payload.status == "done"
        and current["kind"] == "prior_auth"
        and not {**(current.get("inputs") or {}), **(payload.inputs or {})}.get("auth_number")
    ):
        raise HTTPException(status_code=422, detail="Enter the authorization number first")

    # A task can't be finished while anything it waits on is unfinished.
    if payload.status == "done":
        _raise_if_waiting(current)

    update: dict = {}
    if payload.status is not None:
        update["status"] = payload.status
        if payload.status == "done":
            update["completed_at"] = datetime.now(timezone.utc).isoformat()
        else:
            update["completed_at"] = None

    if payload.inputs is not None:
        # Merge: start from existing inputs (may be {} if column missing or new)
        existing_inputs = current.get("inputs") or {}
        update["inputs"] = {**existing_inputs, **payload.inputs}

    if not update:
        return current

    resp = supabase.table("tasks").update(update).eq("id", task_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail=f"No task found for id {task_id}")

    _recalculate_readiness(current["practice_drug_id"])
    return resp.data[0]


# Backward-compat alias so the old endpoint keeps working during transition.
class TaskStatusUpdate(BaseModel):
    status: str  # 'todo' | 'done'


@app.patch("/api/tasks/{task_id}/status")
def update_task_status(task_id: int, payload: TaskStatusUpdate):
    """Legacy alias for PATCH /api/tasks/{task_id} — kept so existing callers
    don't break. Delegates to the unified endpoint logic."""
    return update_task(task_id, TaskUpdate(status=payload.status))



@app.get("/api/practices/{email}/workspaces")
def get_practice_workspaces(email: str):
    """List every practice_drugs row for this practice that has at least one task,
    with the drug's brand_name and a simple done/total task count.
    Used by the 'View Tasks' toggle on /doctor/drugs."""
    # Resolve the practice.
    practice_resp = (
        supabase.table("practices")
        .select("id")
        .eq("email", email)
        .limit(1)
        .execute()
    )
    if not practice_resp.data:
        raise HTTPException(
            status_code=404,
            detail=f"No practice found for email {email}",
        )
    practice_id = practice_resp.data[0]["id"]

    # All practice_drugs rows for this practice.
    pd_resp = (
        supabase.table("practice_drugs")
        .select("id,application_id,status")
        .eq("practice_id", practice_id)
        .execute()
    )
    if not pd_resp.data:
        return []

    # Fetch all tasks for these practice_drug ids in one query.
    pd_ids = [row["id"] for row in pd_resp.data]
    tasks_resp = (
        supabase.table("tasks")
        .select("practice_drug_id,status")
        .in_("practice_drug_id", pd_ids)
        .execute()
    )

    # Group task counts by practice_drug_id; skip rows with zero tasks.
    counts: dict[int, dict] = {}
    for t in (tasks_resp.data or []):
        pid = t["practice_drug_id"]
        if pid not in counts:
            counts[pid] = {"total": 0, "done": 0}
        counts[pid]["total"] += 1
        if t["status"] == "done":
            counts[pid]["done"] += 1

    # Collect application_ids that need brand names.
    app_ids = [row["application_id"] for row in pd_resp.data if row["id"] in counts]
    if not app_ids:
        return []

    drugs_resp = (
        supabase.table("drugs")
        .select("application_id,brand_name")
        .in_("application_id", app_ids)
        .execute()
    )
    brand_by_app = {d["application_id"]: d["brand_name"] for d in (drugs_resp.data or [])}

    result = []
    for row in pd_resp.data:
        if row["id"] not in counts:
            continue
        result.append(
            {
                "practice_drug_id": row["id"],
                "application_id": row["application_id"],
                "status": row["status"],
                "brand_name": brand_by_app.get(row["application_id"], ""),
                "tasks_done": counts[row["id"]]["done"],
                "tasks_total": counts[row["id"]]["total"],
            }
        )
    return result


@app.get("/api/workspaces/by-role/{role}")
def get_workspaces_by_role(role: str):
    """List every practice_drugs workspace, across ALL practices, that has at
    least one task for this role. Unlike /api/practices/{email}/workspaces,
    this is not scoped to a single practice -- it backs the unauthenticated
    Nurse/Biller tabs, which have no session to scope by. Task counts are
    limited to this role's own tasks, not the workspace's full task list."""
    if role not in ("front_desk", "nurse", "biller"):
        raise HTTPException(status_code=400, detail=f"Unknown role {role}")

    tasks_resp = (
        supabase.table("tasks")
        .select("practice_drug_id,status")
        .eq("role", role)
        .execute()
    )
    if not tasks_resp.data:
        return []

    counts: dict[int, dict] = {}
    for t in tasks_resp.data:
        pid = t["practice_drug_id"]
        if pid not in counts:
            counts[pid] = {"total": 0, "done": 0}
        counts[pid]["total"] += 1
        if t["status"] == "done":
            counts[pid]["done"] += 1

    pd_resp = (
        supabase.table("practice_drugs")
        .select("id,application_id,status,practice_id")
        .in_("id", list(counts.keys()))
        .execute()
    )
    pd_rows = pd_resp.data or []
    if not pd_rows:
        return []

    app_ids = [row["application_id"] for row in pd_rows]
    drugs_resp = (
        supabase.table("drugs")
        .select("application_id,brand_name")
        .in_("application_id", app_ids)
        .execute()
    )
    brand_by_app = {d["application_id"]: d["brand_name"] for d in (drugs_resp.data or [])}

    practice_ids = [row["practice_id"] for row in pd_rows]
    practices_resp = (
        supabase.table("practices")
        .select("id,name")
        .in_("id", practice_ids)
        .execute()
    )
    name_by_practice = {p["id"]: p["name"] for p in (practices_resp.data or [])}

    result = [
        {
            "practice_drug_id": row["id"],
            "application_id": row["application_id"],
            "status": row["status"],
            "brand_name": brand_by_app.get(row["application_id"], ""),
            "practice_name": name_by_practice.get(row["practice_id"], ""),
            "tasks_done": counts[row["id"]]["done"],
            "tasks_total": counts[row["id"]]["total"],
        }
        for row in pd_rows
    ]
    result.sort(key=lambda r: r["brand_name"] or "")
    return result


# ---------------------------------------------------------------------------
# Treat & Bill: patients
# ---------------------------------------------------------------------------
# Patient data is the practice-only tier, so every query here is scoped to the
# signed-in practice via `current_practice` -- another practice's patient ids
# 404 exactly like missing ones.


def _practice_patient(patient_id: int, practice: dict) -> dict:
    response = (
        supabase.table("patients")
        .select("*")
        .eq("id", patient_id)
        .eq("practice_id", practice["id"])
        .limit(1)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail=f"No patient found for id {patient_id}")
    return response.data[0]


def _patient_name(patient: dict) -> str:
    return f"{patient['first_name']} {patient['last_name']}"


def _patient_view(patient: dict) -> dict:
    """The row plus the display fields the patient chart reads (name, dob,
    insurance) -- aliases only, the columns themselves are unchanged."""
    return {
        **patient,
        "name": _patient_name(patient),
        "dob": patient.get("date_of_birth"),
        "insurance": patient.get("payer"),
    }


@app.get("/api/patients")
def list_patients(practice: dict = Depends(current_practice)):
    response = (
        supabase.table("patients")
        .select("*")
        .eq("practice_id", practice["id"])
        .order("last_name")
        .execute()
    )
    return [_patient_view(p) for p in response.data]


@app.get("/api/patients/{patient_id}")
def get_patient(patient_id: int, practice: dict = Depends(current_practice)):
    return _patient_view(_practice_patient(patient_id, practice))


class VisitNoteUpdate(BaseModel):
    # The chart page sends `note`; `visit_note` (the column name) works too.
    note: Optional[str] = None
    visit_note: Optional[str] = None


# The note is edited live in the demo (delete a line -> the documentation
# check flips to a gap), so it's its own small endpoint.
@app.patch("/api/patients/{patient_id}/note")
def update_visit_note(
    patient_id: int, payload: VisitNoteUpdate, practice: dict = Depends(current_practice)
):
    note = payload.note if payload.note is not None else payload.visit_note
    if note is None:
        raise HTTPException(status_code=422, detail="Send the note as `note`")
    _practice_patient(patient_id, practice)
    response = (
        supabase.table("patients")
        .update({"visit_note": note, "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", patient_id)
        .execute()
    )
    return _patient_view(response.data[0])


# ---------------------------------------------------------------------------
# Treat & Bill: treatments (order -> sign -> nurse record -> claim)
# ---------------------------------------------------------------------------
# One treatments row is one dose for one patient, from order to claim. The
# columns keep the shapes in their Postgres COMMENTs; `_treatment_view` returns
# them in the shape the patient chart and treatment record pages read.

# Per-patient cards finished by their own page's endpoint (signing, the nurse
# record, exporting the claim) rather than by moving the card to Complete, so
# the card can never say done while the treatment row says otherwise.
PAGE_COMPLETED_KINDS = {
    "order_sign": "Sign the order on the patient chart",
    "prep_dose": "Save the preparation on the treatment record",
    "give_infusion": "Save the administration on the treatment record",
    "claim_review": "Export the claim from the claim page",
}


def _practice_drug_for(
    practice: dict, practice_drug_id: Optional[int], application_id: Optional[str]
) -> dict:
    """This practice's workspace for a drug, by id or by the drug's application id."""
    query = supabase.table("practice_drugs").select("*").eq("practice_id", practice["id"])
    if practice_drug_id is not None:
        query = query.eq("id", practice_drug_id)
    elif application_id:
        query = query.eq("application_id", application_id)
    else:
        raise HTTPException(status_code=422, detail="Send practice_drug_id or application_id")
    response = query.limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="This practice has no workspace for that drug")
    return response.data[0]


def _drug_row(application_id: str) -> dict:
    response = (
        supabase.table("drugs").select("*").eq("application_id", application_id).limit(1).execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail=f"No drug found for {application_id}")
    return response.data[0]


def _practice_treatment(treatment_id: int, practice: dict) -> tuple[dict, dict]:
    """The treatment and its workspace, 404 unless it belongs to this practice."""
    response = supabase.table("treatments").select("*").eq("id", treatment_id).limit(1).execute()
    if response.data:
        treatment = response.data[0]
        pd_resp = (
            supabase.table("practice_drugs")
            .select("*")
            .eq("id", treatment["practice_drug_id"])
            .eq("practice_id", practice["id"])
            .limit(1)
            .execute()
        )
        if pd_resp.data:
            return treatment, pd_resp.data[0]
    raise HTTPException(status_code=404, detail=f"No treatment found for id {treatment_id}")


def _vial_packages(drug: dict) -> dict[float, str]:
    """Vial strength in mg → its 11-digit NDC, from the drug's `ndcs` list."""
    packages = {}
    for ndc in drug.get("ndcs") or []:
        if ndc.get("strength_mg") and ndc.get("ndc_11"):
            packages.setdefault(float(ndc["strength_mg"]), ndc["ndc_11"])
    return packages


def _order_for(drug: dict, patient: dict, dose_override: Optional[float]):
    """The dose for this patient and its least-waste vials, as
    (dose, unit, vial_mix column rows [{ndc_11, strength, count}])."""
    if dose_override is not None:
        if dose_override <= 0:
            raise HTTPException(status_code=422, detail="Dose must be positive")
        dose, unit = dose_override, "mg"
    else:
        typical = drug.get("typical_adult_dose")
        if not typical:
            raise HTTPException(
                status_code=422,
                detail=f"{drug.get('brand_name')} has no label dose to calculate from; enter the dose",
            )
        try:
            dose, unit = dose_for(typical["amount"], typical["unit"], weight_kg=patient.get("weight_kg"))
        except ValueError as err:
            raise HTTPException(status_code=422, detail=str(err))

    packages = _vial_packages(drug)
    if not packages:
        raise HTTPException(
            status_code=422, detail=f"No vial strengths on file for {drug.get('brand_name')}"
        )
    if unit.lower() != "mg":
        raise HTTPException(status_code=422, detail=f"Vial strengths are in mg but the dose is in {unit}")

    mix = vial_mix(dose, list(packages))
    rows = [
        {"ndc_11": packages[float(size)], "strength": size, "count": count}
        for size, count in mix["vials"].items()
    ]
    return dose, unit, rows


def _vial_summary(rows: Optional[list], dose) -> Optional[dict]:
    """The flat vial summary the pages read ({vials, vial_size_mg, waste_mg}),
    with the per-NDC rows kept under `packages`. vial_size_mg is null when the
    mix uses more than one vial size."""
    if not rows:
        return None
    total = sum(r["strength"] * r["count"] for r in rows)
    sizes = {r["strength"] for r in rows}
    return {
        "vials": sum(r["count"] for r in rows),
        "vial_size_mg": next(iter(sizes)) if len(sizes) == 1 else None,
        "total_mg": total,
        "waste_mg": round(total - float(dose), 3),
        "packages": rows,
    }


def _vial_text(summary: dict) -> str:
    if summary["vial_size_mg"] is not None:
        return f"{summary['vials']} × {summary['vial_size_mg']} mg vials"
    return f"{summary['vials']} vials"


def _treatment_view(treatment: dict, patient: dict, drug: dict) -> dict:
    return {
        **treatment,
        "patient": {
            "id": patient["id"],
            "name": _patient_name(patient),
            "weight_kg": patient.get("weight_kg"),
            "payer": patient.get("payer"),
        },
        "drug": {
            "brand_name": drug.get("brand_name"),
            "application_id": drug.get("application_id"),
            "route": drug.get("route_of_administration"),
            "infusion_time_minutes": drug.get("infusion_time_minutes"),
            "preparation_instructions": drug.get("preparation_instructions"),
            "is_single_dose_vial": drug.get("is_single_dose_vial"),
        },
        "dose": {"amount": treatment["ordered_dose"], "unit": treatment["dose_unit"]},
        "vial_mix": _vial_summary(treatment.get("vial_mix"), treatment["ordered_dose"]),
        "preparation": _preparation_view(treatment, drug),
        "administration": _administration_view(treatment, drug),
    }


def _preparation_view(treatment: dict, drug: dict) -> Optional[dict]:
    """The nurse's preparation record, or None until it's saved."""
    vials = treatment.get("vials_used")
    if not vials:
        return None
    waste = float(treatment.get("waste_amount") or 0)
    return {
        "vials_used": sum(v.get("quantity") or 0 for v in vials),
        "lot_number": next((v["lot"] for v in vials if v.get("lot")), None),
        "waste_mg": treatment.get("waste_amount"),
        "dose_given": treatment.get("dose_given"),
        "jw_jz": waste_modifier(drug.get("is_single_dose_vial"), waste),
        "packages": vials,
    }


def _administration_view(treatment: dict, drug: dict) -> Optional[dict]:
    """The nurse's administration record, or None until it's saved. Times are
    the wall-clock times the nurse entered (stored without converting zones)."""
    if not (treatment.get("infusion_start") and treatment.get("infusion_stop")):
        return None
    start = datetime.fromisoformat(treatment["infusion_start"])
    stop = datetime.fromisoformat(treatment["infusion_stop"])
    lines = admin_codes(start, stop, bool(drug.get("is_antineoplastic")))
    return {
        "date_of_service": treatment.get("date_of_service"),
        "start_time": start.strftime("%H:%M"),
        "stop_time": stop.strftime("%H:%M"),
        "duration_minutes": int((stop - start).total_seconds() // 60),
        "admin_codes": [code if count == 1 else f"{code} × {count}" for code, count in lines],
        "admin_code_lines": [{"code": code, "units": count} for code, count in lines],
    }


class TreatmentCreate(BaseModel):
    patient_id: int
    # The chart page sends both; either one finds the practice's workspace.
    practice_drug_id: Optional[int] = None
    application_id: Optional[str] = None
    dose: Optional[float] = None  # the doctor's override, in mg; else calculated from the label


# "New Order": creates the treatment and the doctor's "Order + sign" card.
@app.post("/api/treatments")
def create_treatment(payload: TreatmentCreate, practice: dict = Depends(current_practice)):
    patient = _practice_patient(payload.patient_id, practice)
    practice_drug = _practice_drug_for(practice, payload.practice_drug_id, payload.application_id)
    drug = _drug_row(practice_drug["application_id"])
    dose, unit, rows = _order_for(drug, patient, payload.dose)

    treatment = (
        supabase.table("treatments")
        .insert(
            {
                "practice_drug_id": practice_drug["id"],
                "patient_id": patient["id"],
                "status": "ordered",
                "ordered_dose": dose,
                "dose_unit": unit,
                "vial_mix": rows,
            }
        )
        .execute()
        .data[0]
    )

    name = _patient_name(patient)
    brand = drug.get("brand_name") or "this drug"
    supabase.table("tasks").insert(
        {
            "practice_drug_id": practice_drug["id"],
            "treatment_id": treatment["id"],
            "stage": "treat_and_bill",
            "role": "doctor",
            "kind": "order_sign",
            "title": f"Order + sign: {name}",
            "instruction": (
                f"Check {name}'s visit note against the payer documentation requirements, "
                f"then sign the order for {dose} {unit} of {brand} "
                f"({_vial_text(_vial_summary(rows, dose))})."
            ),
            "status": "todo",
        }
    ).execute()

    return _treatment_view(treatment, patient, drug)


def _patients_by_treatment(treatment_ids: list[int]) -> dict[int, dict]:
    """treatment id → its patient row (id, first_name, last_name)."""
    if not treatment_ids:
        return {}
    treatments = (
        supabase.table("treatments")
        .select("id,patient_id")
        .in_("id", list(set(treatment_ids)))
        .execute()
        .data
        or []
    )
    patient_rows = (
        supabase.table("patients")
        .select("id,first_name,last_name")
        .in_("id", list({t["patient_id"] for t in treatments}))
        .execute()
        .data
        or []
    )
    by_id = {p["id"]: p for p in patient_rows}
    return {t["id"]: by_id[t["patient_id"]] for t in treatments if t["patient_id"] in by_id}


# The Patients tab's tracker: one row per dose, each with its steps. No login,
# like the task board it sits next to (staff views have no session yet).
@app.get("/api/practice-drugs/{practice_drug_id}/treatments")
def list_practice_drug_treatments(practice_drug_id: int):
    treatments = (
        supabase.table("treatments")
        .select("*")
        .eq("practice_drug_id", practice_drug_id)
        .order("created_at")
        .order("id")
        .execute()
        .data
        or []
    )
    if not treatments:
        return []

    patients = _patients_by_treatment([t["id"] for t in treatments])
    tasks = (
        supabase.table("tasks")
        .select("id,treatment_id,kind,title,role,status,waits_on")
        .in_("treatment_id", [t["id"] for t in treatments])
        .order("id")
        .execute()
        .data
        or []
    )
    tasks_by_id = {t["id"]: t for t in tasks}

    doses_so_far: dict[int, int] = defaultdict(int)
    rows = []
    for treatment in treatments:
        doses_so_far[treatment["patient_id"]] += 1
        patient = patients.get(treatment["id"])
        steps = []
        for task in (t for t in tasks if t["treatment_id"] == treatment["id"]):
            waiting_on = _waiting_on(task, tasks_by_id)
            state = "done" if task["status"] == "done" else "waiting" if waiting_on else "todo"
            steps.append(
                {
                    "task_id": task["id"],
                    "kind": task["kind"],
                    "title": task["title"],
                    "role": task["role"],
                    "state": state,
                    "waiting_on": waiting_on,
                }
            )
        rows.append(
            {
                "treatment_id": treatment["id"],
                "patient_id": treatment["patient_id"],
                "patient_name": _patient_name(patient) if patient else None,
                "dose_number": doses_so_far[treatment["patient_id"]],
                "status": treatment["status"],
                "dose": {"amount": treatment["ordered_dose"], "unit": treatment["dose_unit"]},
                "date_of_service": treatment.get("date_of_service"),
                "created_at": treatment["created_at"],
                "steps": steps,
            }
        )
    return rows


def _payer_policy(drug: dict, payer: Optional[str]) -> Optional[dict]:
    if not payer:
        return None
    return next(
        (
            p
            for p in drug.get("payer_policies") or []
            if (p.get("payer") or "").lower() == payer.lower()
        ),
        None,
    )


def _stock_quantity(practice_drug: dict) -> float:
    return sum(
        s.get("quantity") or 0 for s in practice_drug.get("stock_on_hand") or [] if isinstance(s, dict)
    )


def _create_patient_chain(treatment: dict, patient: dict, practice_drug: dict, drug: dict) -> None:
    """The rest of this patient's cards, created at signing so everyone sees
    what's coming before it's their turn. Prior auth (B) and buy-for-patient
    (C) only appear when needed; the nurse's prep (D) waits on the signed order
    plus whichever of them exist, then give (E) waits on D and claim review (F)
    waits on E."""
    name = _patient_name(patient)
    brand = drug.get("brand_name") or "this drug"
    summary = _vial_summary(treatment["vial_mix"], treatment["ordered_dose"])
    dose = f"{treatment['ordered_dose']} {treatment['dose_unit']}"

    def add(role: str, kind: str, title: str, instruction: str, waits_on: list[int]) -> int:
        row = {
            "practice_drug_id": practice_drug["id"],
            "treatment_id": treatment["id"],
            "stage": "treat_and_bill",
            "role": role,
            "kind": kind,
            "title": title,
            "instruction": instruction,
            "status": "todo",
            "waits_on": waits_on,
        }
        return supabase.table("tasks").insert(row).execute().data[0]["id"]

    order_resp = (
        supabase.table("tasks")
        .select("id")
        .eq("treatment_id", treatment["id"])
        .eq("kind", "order_sign")
        .execute()
    )
    before_prep = [t["id"] for t in order_resp.data or []]

    policy = _payer_policy(drug, patient.get("payer"))
    if policy and policy.get("prior_auth"):
        notes = f" {policy['notes']}" if policy.get("notes") else ""
        before_prep.append(
            add(
                "biller",
                "prior_auth",
                f"Get prior auth: {name}",
                f"{policy['payer']} requires prior authorization for {brand} before {name}'s "
                f"first dose.{notes} Submit the request, then enter the authorization number "
                "on this card (it goes in Box 23 of the claim).",
                [],
            )
        )

    in_stock = _stock_quantity(practice_drug)
    if in_stock < summary["vials"]:
        distributors = ", ".join(
            d.get("name", str(d)) if isinstance(d, dict) else str(d)
            for d in drug.get("distributors") or []
        )
        from_text = f" from {distributors}" if distributors else ""
        before_prep.append(
            add(
                "front_desk",
                "buy_for_patient",
                f"Buy {brand} for {name}",
                f"{name}'s dose needs {_vial_text(summary)} and {in_stock:g} are in stock. "
                f"Order{from_text}, then record the invoice so the stock is updated.",
                [],
            )
        )

    prep_id = add(
        "nurse",
        "prep_dose",
        f"Prepare {name}'s dose",
        f"Prepare {dose} of {brand} for {name} from {_vial_text(summary)}. Record the vials, "
        f"lot number and waste (planned waste: {summary['waste_mg']:g} mg) on the treatment record.",
        before_prep,
    )
    infusion = drug.get("infusion_time_minutes")
    over = f" over {infusion} minutes" if infusion else ""
    give_id = add(
        "nurse",
        "give_infusion",
        f"Give {name}'s infusion",
        f"Give {name}'s {brand} infusion{over}. Record the date of service and the start and "
        "stop times: the date of service decides which billing code the claim uses.",
        [prep_id],
    )
    add(
        "biller",
        "claim_review",
        f"Review claim: {name}",
        f"Review {name}'s generated CMS-1500 claim, clear all 8 pre-submission checks, then "
        "export it for your clearinghouse.",
        [give_id],
    )


# ---------------------------------------------------------------------------
# Treat & Bill: documentation check (AI reads, code decides what to check)
# ---------------------------------------------------------------------------
# Code builds the requirement list from the label, the dosing and the patient's
# payer policy, so the same note always gets the same list and deleting one
# line flips exactly one item. Claude only judges the note against that list
# and quotes it; code then verifies every quote really is in the note.

DOC_CHECK_SCHEMA_BASE = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "passed": {"type": "boolean"},
                    "quote": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                },
                "required": ["id", "passed", "quote"],
                "additionalProperties": False,
            },
        },
        "draft_text": {"anyOf": [{"type": "string"}, {"type": "null"}]},
    },
    "required": ["results", "draft_text"],
    "additionalProperties": False,
}

DOC_CHECK_INSTRUCTIONS = """\
You are checking a physician's visit note before a drug order is signed, for a \
medical-billing app. For each requirement below, decide whether the note \
documents it.

- passed: true only if the note itself states it. Do not infer from the order \
or assume anything the note doesn't say.
- quote: when passed, the shortest exact span copied verbatim from the note \
(same characters, no ellipses or paraphrase) that shows it; null when not passed.
- draft_text: if any requirement failed, one or two sentences the doctor could \
add to the note to cover the missing items, using square-bracket placeholders \
such as [date] or [lab] for facts you don't know. Never invent patient facts \
or results. null if everything passed.

Return one result per requirement id."""


def _doc_requirements(drug: dict, patient: dict) -> list[dict]:
    """[{id, label, detail}] -- what this note must document for this drug and payer."""
    requirements = []
    uses = drug.get("approved_uses_and_conditions") or []
    if uses:
        all_uses = "; ".join(u["approved_diagnosis"] for u in uses)
        label = (
            f"Diagnosis: {uses[0]['approved_diagnosis'].split(' — ')[0]}"
            if len(uses) == 1
            else "Diagnosis matches an approved use"
        )
        requirements.append(
            {"id": "diagnosis", "label": label, "detail": f"A diagnosis matching the FDA-approved use: {all_uses}"}
        )
        if len(uses) == 1 and uses[0].get("prior_therapy"):
            requirements.append(
                {
                    "id": "prior_therapy",
                    "label": f"Prior therapy: {uses[0]['prior_therapy']}",
                    "detail": f"Required prior therapy: {uses[0]['prior_therapy']}",
                }
            )
        if len(uses) == 1 and uses[0].get("required_test_method"):
            requirements.append(
                {
                    "id": "required_test",
                    "label": f"Required test: {uses[0]['required_test_method']}",
                    "detail": f"Required test result: {uses[0]['required_test_method']}",
                }
            )

    dose_unit = ((drug.get("typical_adult_dose") or {}).get("unit") or "").lower()
    if dose_unit.endswith("/kg"):
        requirements.append(
            {
                "id": "weight",
                "label": "Current weight documented",
                "detail": f"The patient's current weight (the dose is calculated in {dose_unit})",
            }
        )
    elif dose_unit.endswith("/m2"):
        requirements.append(
            {
                "id": "body_surface_area",
                "label": "Height and weight documented",
                "detail": "Current height and weight or body surface area (the dose is per m²)",
            }
        )

    policy = _payer_policy(drug, patient.get("payer")) or {}
    for index, requirement in enumerate(policy.get("documentation_requirements") or [], start=1):
        requirements.append(
            {
                "id": f"payer_{index}",
                "label": f"{requirement} ({policy['payer']} policy)",
                "detail": f"{policy['payer']} coverage policy requires: {requirement}",
            }
        )
    return requirements


def _doc_check_key(note: str, requirements: list[dict]) -> str:
    return hashlib.sha256(json.dumps([note, requirements], sort_keys=True).encode()).hexdigest()


def _doc_check_view(stored: dict) -> dict:
    """What the chart page reads: {checks: [{id, label, passed, quote}], draft_text}."""
    return {
        "checks": [
            {"id": i["id"], "label": i["requirement"], "passed": i["passed"], "quote": i.get("quote")}
            for i in stored.get("items") or []
        ],
        "draft_text": stored.get("draft_text"),
        "prior_auth_required": stored.get("prior_auth_required", False),
        "checked_at": stored.get("checked_at"),
    }


async def _run_doc_check(note: str, requirements: list[dict], brand: str) -> dict:
    """Claude's judgment of the note against the requirements, as {results, draft_text}."""
    schema = json.loads(json.dumps(DOC_CHECK_SCHEMA_BASE))
    schema["properties"]["results"]["items"]["properties"]["id"]["enum"] = [r["id"] for r in requirements]
    listed = "\n".join(f"- {r['id']}: {r['detail']}" for r in requirements)
    prompt = (
        f"{DOC_CHECK_INSTRUCTIONS}\n\nDrug being ordered: {brand}\n\n"
        f"<requirements>\n{listed}\n</requirements>\n\n<visit_note>\n{note}\n</visit_note>"
    )
    try:
        async with claude.beta.messages.stream(
            model="claude-opus-5",
            max_tokens=16000,
            # Low effort: this re-runs on every note save, so it has to feel instant.
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            message = await stream.get_final_message()
    except (anthropic.AuthenticationError, TypeError) as err:
        if isinstance(err, TypeError) and "authentication" not in str(err):
            raise
        raise HTTPException(
            status_code=503, detail="The documentation check needs a valid ANTHROPIC_API_KEY in backend/.env"
        )
    except anthropic.APIStatusError as err:
        raise HTTPException(status_code=502, detail=f"Claude API error: {err.message}")
    except anthropic.APIConnectionError:
        raise HTTPException(status_code=502, detail="Could not reach the Claude API")

    if message.stop_reason != "end_turn":
        raise HTTPException(
            status_code=502, detail=f"Documentation check stopped early ({message.stop_reason})"
        )
    return json.loads(next(b.text for b in message.content if b.type == "text"))


def _in_note(quote: Optional[str], note: str) -> bool:
    """Whether the quote is really in the note (ignoring whitespace differences)."""
    if not quote or not quote.strip():
        return False
    return " ".join(quote.split()).lower() in " ".join(note.split()).lower()


def _has_blank(quote: str, note: str) -> bool:
    """Whether the quote, or the note line it comes from, still has an unfilled
    [placeholder] -- Claude may quote just the part next to the blank."""
    wanted = " ".join(quote.split()).lower()
    lines = [line for line in note.splitlines() if wanted in " ".join(line.split()).lower()]
    return any(re.search(r"\[[^\]]+\]", text) for text in [quote, *lines])


@app.post("/api/treatments/{treatment_id}/doc-check")
async def documentation_check(treatment_id: int, practice: dict = Depends(current_practice)):
    treatment, practice_drug = _practice_treatment(treatment_id, practice)
    stored = treatment.get("documentation_check")
    # After signing, the check is part of the signed order: show it, don't redo it.
    if treatment["status"] != "ordered":
        if not stored:
            raise HTTPException(status_code=409, detail="This order was signed without a documentation check")
        return _doc_check_view(stored)

    patient = _practice_patient(treatment["patient_id"], practice)
    drug = _drug_row(practice_drug["application_id"])
    note = patient.get("visit_note") or ""
    requirements = _doc_requirements(drug, patient)
    key = _doc_check_key(note, requirements)
    if stored and stored.get("key") == key:
        return _doc_check_view(stored)  # same note, same requirements: no new Claude call

    if not note.strip():
        results, draft = [], None
    else:
        judged = await _run_doc_check(note, requirements, drug.get("brand_name") or "the drug")
        results, draft = judged["results"], judged["draft_text"]
    by_id = {r["id"]: r for r in results}

    items = []
    unfilled = False
    for requirement in requirements:
        result = by_id.get(requirement["id"]) or {}
        # A pass only stands if its quote really is in the note, and isn't an
        # approved draft whose [placeholders] were never filled in.
        quote_ok = _in_note(result.get("quote"), note)
        has_blank = quote_ok and _has_blank(result["quote"], note)
        unfilled = unfilled or (bool(result.get("passed")) and has_blank)
        passed = bool(result.get("passed")) and quote_ok and not has_blank
        items.append(
            {
                "id": requirement["id"],
                "requirement": requirement["label"],
                "passed": passed,
                "quote": result.get("quote") if passed else None,
            }
        )
    policy = _payer_policy(drug, patient.get("payer")) or {}
    if unfilled:
        draft = "Fill in the [bracketed] placeholders in the note, then the check will re-run."
    stored = {
        "items": items,
        "draft_text": None if all(i["passed"] for i in items) else draft,
        "prior_auth_required": bool(policy.get("prior_auth")),
        "payer": patient.get("payer"),
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "key": key,
        "note_sha256": hashlib.sha256(note.encode()).hexdigest(),
    }
    supabase.table("treatments").update({"documentation_check": stored}).eq("id", treatment_id).execute()
    return _doc_check_view(stored)


@app.post("/api/treatments/{treatment_id}/sign")
def sign_treatment(treatment_id: int, practice: dict = Depends(current_practice)):
    treatment, practice_drug = _practice_treatment(treatment_id, practice)
    patient = _practice_patient(treatment["patient_id"], practice)
    drug = _drug_row(practice_drug["application_id"])

    # The check must have been run on the note being signed. Gaps don't block
    # signing -- the doctor decides -- but the claim's documentation check
    # will flag them.
    check = treatment.get("documentation_check") or {}
    current_note = hashlib.sha256((patient.get("visit_note") or "").encode()).hexdigest()
    if treatment["status"] == "ordered" and check.get("note_sha256") != current_note:
        raise HTTPException(
            status_code=409, detail="Run the documentation check on the current note before signing"
        )

    now = datetime.now(timezone.utc).isoformat()
    # Only matches while still 'ordered', so a double-click can't sign twice
    # (or build the patient's chain twice).
    signed_resp = (
        supabase.table("treatments")
        .update(
            {
                "status": "signed",
                "signed_at": now,
                "signed_note": patient.get("visit_note"),
                "updated_at": now,
            }
        )
        .eq("id", treatment_id)
        .eq("status", "ordered")
        .execute()
    )
    if not signed_resp.data:
        raise HTTPException(
            status_code=409, detail=f"This order is already {treatment['status']}, not awaiting a signature"
        )
    signed = signed_resp.data[0]

    supabase.table("tasks").update({"status": "done", "completed_at": now}).eq(
        "treatment_id", treatment_id
    ).eq("kind", "order_sign").execute()
    _create_patient_chain(signed, patient, practice_drug, drug)

    return _treatment_view(signed, patient, drug)


# The nurse's treatment record. Like the rest of /staff/*, these have no login
# yet, so they're reached by treatment id alone.


def _treatment_bundle(treatment_id: int) -> tuple[dict, dict, dict, dict]:
    """(treatment, practice_drug, patient, drug), 404 if the treatment doesn't exist."""
    response = supabase.table("treatments").select("*").eq("id", treatment_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail=f"No treatment found for id {treatment_id}")
    treatment = response.data[0]
    practice_drug = (
        supabase.table("practice_drugs").select("*").eq("id", treatment["practice_drug_id"]).execute().data[0]
    )
    patient = supabase.table("patients").select("*").eq("id", treatment["patient_id"]).execute().data[0]
    return treatment, practice_drug, patient, _drug_row(practice_drug["application_id"])


def _treatment_task(treatment_id: int, kind: str) -> Optional[dict]:
    response = (
        supabase.table("tasks")
        .select("*")
        .eq("treatment_id", treatment_id)
        .eq("kind", kind)
        .limit(1)
        .execute()
    )
    return response.data[0] if response.data else None


def _complete_task(task: Optional[dict]) -> None:
    if task and task["status"] != "done":
        supabase.table("tasks").update(
            {"status": "done", "completed_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", task["id"]).execute()


def _raise_unless_recordable(treatment: dict) -> None:
    """The nurse record can be saved once the order is signed, and corrected
    until the claim is exported."""
    if treatment["status"] == "ordered":
        raise HTTPException(status_code=409, detail="The order hasn't been signed yet")
    if treatment["status"] in ("exported", "needs_recoding"):
        raise HTTPException(status_code=409, detail="This claim was already exported")


def _move_stock(stock: list, put_back: list, take: list) -> list:
    """Stock after returning `put_back` vials and using `take` vials (both
    [{ndc_11, lot, quantity}]). Uses the same lot first, then any lot of the
    same NDC, and never goes below zero; emptied lots are dropped."""
    stock = [dict(s) for s in stock if isinstance(s, dict)]
    for row in put_back:
        match = next(
            (s for s in stock if s.get("ndc_11") == row.get("ndc_11") and s.get("lot") == row.get("lot")),
            None,
        )
        if match:
            match["quantity"] = (match.get("quantity") or 0) + row["quantity"]
        else:
            stock.append({"ndc_11": row.get("ndc_11"), "lot": row.get("lot"), "quantity": row["quantity"]})
    for row in take:
        remaining = row["quantity"]
        same_ndc = [s for s in stock if s.get("ndc_11") in (row.get("ndc_11"), None)]
        for s in sorted(same_ndc, key=lambda s: s.get("lot") != row.get("lot")):
            used = min(remaining, s.get("quantity") or 0)
            s["quantity"] = (s.get("quantity") or 0) - used
            remaining -= used
    return [s for s in stock if (s.get("quantity") or 0) > 0]


@app.get("/api/treatments/{treatment_id}")
def get_treatment(treatment_id: int):
    treatment, _practice_drug, patient, drug = _treatment_bundle(treatment_id)
    return _treatment_view(treatment, patient, drug)


class PreparationRecord(BaseModel):
    vials_used: Optional[int] = None  # defaults to the order's planned vial count
    lot_number: Optional[str] = None
    waste_mg: Optional[float] = None  # defaults to the order's planned waste


@app.patch("/api/treatments/{treatment_id}/preparation")
def save_preparation(treatment_id: int, payload: PreparationRecord):
    treatment, practice_drug, patient, drug = _treatment_bundle(treatment_id)
    _raise_unless_recordable(treatment)
    prep_task = _treatment_task(treatment_id, "prep_dose")
    if prep_task:
        _raise_if_waiting(prep_task)

    summary = _vial_summary(treatment["vial_mix"], treatment["ordered_dose"])
    vials = payload.vials_used if payload.vials_used is not None else summary["vials"]
    waste = payload.waste_mg if payload.waste_mg is not None else summary["waste_mg"]
    if vials <= 0:
        raise HTTPException(status_code=422, detail="Vials used must be at least 1")
    if waste < 0:
        raise HTTPException(status_code=422, detail="Waste can't be negative")

    packages = summary["packages"]
    if len(packages) == 1:
        rows = [{"ndc_11": packages[0]["ndc_11"], "lot": payload.lot_number, "quantity": vials}]
        drawn = vials * packages[0]["strength"]
    elif vials == summary["vials"]:
        rows = [{"ndc_11": p["ndc_11"], "lot": payload.lot_number, "quantity": p["count"]} for p in packages]
        drawn = summary["total_mg"]
    else:
        raise HTTPException(
            status_code=422, detail="This dose mixes vial sizes; record the planned vials"
        )
    dose_given = round(drawn - waste, 3)
    if dose_given <= 0:
        raise HTTPException(
            status_code=422, detail=f"Waste can't be all of the {drawn:g} mg drawn from the vials"
        )

    stock = _move_stock(
        practice_drug.get("stock_on_hand") or [], put_back=treatment.get("vials_used") or [], take=rows
    )
    updated = (
        supabase.table("treatments")
        .update(
            {
                "vials_used": rows,
                "waste_amount": waste,
                "dose_given": dose_given,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", treatment_id)
        .execute()
        .data[0]
    )
    supabase.table("practice_drugs").update({"stock_on_hand": stock}).eq(
        "id", practice_drug["id"]
    ).execute()
    _complete_task(prep_task)
    # A correction after the infusion changes the dose given, so rebuild the claim.
    _refresh_claim(treatment_id)
    return get_treatment(treatment_id)


class AdministrationRecord(BaseModel):
    date_of_service: date
    start_time: time  # wall-clock "HH:MM" on the date of service
    stop_time: time


@app.patch("/api/treatments/{treatment_id}/administration")
def save_administration(treatment_id: int, payload: AdministrationRecord):
    treatment, _practice_drug, patient, drug = _treatment_bundle(treatment_id)
    _raise_unless_recordable(treatment)
    if not treatment.get("vials_used"):
        raise HTTPException(status_code=409, detail="Save the preparation first")
    give_task = _treatment_task(treatment_id, "give_infusion")
    if give_task:
        _raise_if_waiting(give_task)

    start = datetime.combine(payload.date_of_service, payload.start_time)
    stop = datetime.combine(payload.date_of_service, payload.stop_time)
    if stop <= start:
        raise HTTPException(status_code=422, detail="Stop time must be after start time")

    updated = (
        supabase.table("treatments")
        .update(
            {
                "date_of_service": payload.date_of_service.isoformat(),
                "infusion_start": start.isoformat(),
                "infusion_stop": stop.isoformat(),
                "status": "administered",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", treatment_id)
        .execute()
        .data[0]
    )
    _complete_task(give_task)
    _refresh_claim(treatment_id)
    return get_treatment(treatment_id)


# ---------------------------------------------------------------------------
# Treat & Bill: claim builder (CMS-1500 + the 8 pre-submission checks)
# ---------------------------------------------------------------------------
# Built from the treatment row whenever the nurse record changes and on every
# claim view until export, so later fixes (an invoice, a prior-auth number, a
# documentation check) show up without a rebuild button. Once exported the
# stored claim is frozen. Response fields follow what ClaimPage.jsx reads.

# 24F charges for administration lines. The practice's own fee schedule isn't
# collected anywhere yet, so these are labeled demo values.
DEMO_ADMIN_FEES = {"96365": 150.00, "96366": 40.00, "96374": 60.00, "96409": 120.00, "96413": 280.00, "96415": 60.00}
DEMO_TAX_ID = "98-7654321"

CLAIM_CHECK_LABELS = {
    "item19": "Drug details complete in Item 19",
    "ndc": "NDC in 11-digit format and matches the invoice",
    "units": "Units correct for the code type and payer",
    "waste_modifier": "JW/JZ applied correctly",
    "diagnosis": "Diagnosis matches an approved use",
    "documentation": "Documentation complete",
    "admin_code": "Administration code matches the infusion times",
    "attachments": "Attachments ready (prior auth on file if required)",
}


def _invoice_line(practice_drug: dict, ndc_11: Optional[str], lot: Optional[str]) -> Optional[dict]:
    """The invoice line for these vials: same NDC and lot if possible, else same NDC."""
    lines = [
        line
        for invoice in practice_drug.get("invoices") or []
        for line in invoice.get("lines") or []
        if line.get("ndc_11") == ndc_11
    ]
    return next((line for line in lines if lot and line.get("lot") == lot), lines[0] if lines else None)


def _money(value) -> float:
    return round(float(value), 2)


def _build_claim(treatment: dict, practice_drug: dict, patient: dict, drug: dict) -> dict:
    """The CMS-1500 for one administered treatment, plus its 8 checks, in the
    shape ClaimPage.jsx reads."""
    practice = (
        supabase.table("practices").select("*").eq("id", practice_drug["practice_id"]).execute().data[0]
    )
    brand = drug.get("brand_name") or ""
    payer = patient.get("payer")
    dos = treatment["date_of_service"]
    dose_unit = treatment["dose_unit"]
    dose_given = float(treatment.get("dose_given") or 0)
    waste = float(treatment.get("waste_amount") or 0)
    vials = treatment.get("vials_used") or []
    vial_count = sum(v.get("quantity") or 0 for v in vials)
    ndc_11 = vials[0].get("ndc_11") if vials else None
    lot = vials[0].get("lot") if vials else None
    ndc_digits = (ndc_11 or "").replace("-", "")
    checks = []

    def check(check_id: str, passed: bool, message: str, fix_field: Optional[str]) -> None:
        checks.append(
            {
                "id": check_id,
                "label": CLAIM_CHECK_LABELS[check_id],
                "passed": passed,
                "message": message,
                "fix_field": None if passed else fix_field,
            }
        )

    # Code by date of service and payer (the Switch Day rule).
    try:
        code = code_for(drug.get("codes") or [], payer, dos)
        code_problem = None if code else f"No billing code covers {dos} for {brand}"
    except ValueError as err:
        code, code_problem = None, str(err)
    is_generic = bool(code) and code["type"] == "generic"

    # Invoice: price for Box 19 and 24F, and the NDC/lot match for check 2.
    invoice_line = _invoice_line(practice_drug, ndc_11, lot)
    cost_per_vial = invoice_line.get("cost_per_vial") if invoice_line else None
    vials_cost = _money(cost_per_vial * vial_count) if cost_per_vial is not None else None

    # 1. Item 19 -- required for generic codes (drug name, dose, route, NDC, invoice cost).
    item19_text = None
    if not is_generic and code:
        check("item19", True, f"Not required: {code['code']} is a permanent code", "field-item19")
    elif len(ndc_digits) != 11 or not ndc_digits.isdigit():
        check("item19", False, f"Item 19 needs an 11-digit NDC; recorded: {ndc_11 or '(none)'}", "field-item19")
    else:
        item19_text, fits = item19(
            brand, dose_given, dose_unit, drug.get("route_of_administration") or "", ndc_11, vials_cost
        )
        if vials_cost is None:
            check("item19", False, "Invoice price missing: record the invoice so Item 19 includes the cost", "field-item19")
        elif not fits:
            check("item19", False, f"Item 19 is {len(item19_text)} characters; the limit is 80", "field-item19")
        else:
            check("item19", True, f"Name, dose, route, NDC and cost present ({len(item19_text)}/80 characters)", "field-item19")

    # 2. NDC is 11 digits and matches the invoice.
    if len(ndc_digits) != 11 or not ndc_digits.isdigit():
        check("ndc", False, f"NDC {ndc_11 or '(none)'} isn't in 11-digit 5-4-2 format", "field-ndc")
    elif not invoice_line:
        check("ndc", False, f"No invoice line for NDC {ndc_11}: record the invoice", "field-ndc")
    elif lot and invoice_line.get("lot") != lot:
        check("ndc", False, f"Lot {lot} isn't on the invoice (invoice lot {invoice_line.get('lot')})", "field-ndc")
    else:
        check("ndc", True, f"{ndc_11} matches the invoice{f' (lot {lot})' if lot else ''}", "field-ndc")

    # 3. Units for the code type.
    drug_units = waste_units = None
    if code_problem:
        check("units", False, code_problem, "field-code")
    else:
        try:
            drug_units = units(dose_given, dose_unit, code)
            waste_units = units(waste, dose_unit, code) if waste > 0 else None
            rule = (
                "Generic code: 1 unit per line"
                if is_generic
                else f"{dose_given:g} {dose_unit} ÷ {code['unit']} = {drug_units} units"
            )
            check("units", True, rule, "field-units")
        except ValueError as err:
            check("units", False, str(err), "field-units")

    # 4. JW/JZ.
    modifier = waste_modifier(drug.get("is_single_dose_vial"), waste)
    largest_vial = max((p["strength"] for p in treatment.get("vial_mix") or []), default=None)
    if largest_vial is not None and waste >= largest_vial:
        check(
            "waste_modifier",
            False,
            f"{waste:g} {dose_unit} wasted is a whole vial or more: recheck the vials used",
            "field-waste_modifier",
        )
    elif modifier == "JW":
        check("waste_modifier", True, f"Single-dose vial, {waste:g} {dose_unit} discarded: JW line added", "field-waste_modifier")
    elif modifier == "JZ":
        check("waste_modifier", True, "Single-dose vial with no waste: JZ on the drug line", "field-waste_modifier")
    else:
        check("waste_modifier", True, "Not a single-dose vial: no JW/JZ", "field-waste_modifier")

    # 5. Diagnosis matches an approved use.
    diagnosis = patient.get("diagnosis") or ""
    diagnosis_code, _, diagnosis_text = diagnosis.partition(" ")
    approved = drug.get("approved_uses_and_conditions") or []
    match = next(
        (
            use["approved_diagnosis"]
            for use in approved
            if diagnosis_text and diagnosis_text.lower() in (use.get("approved_diagnosis") or "").lower()
        ),
        None,
    )
    if not diagnosis_code:
        check("diagnosis", False, "No diagnosis on the patient record", "field-diagnosis")
    elif match:
        check("diagnosis", True, f"{diagnosis_code} matches the approved use: {match}", "field-diagnosis")
    else:
        check("diagnosis", False, f"{diagnosis} doesn't match an approved use of {brand}", "field-diagnosis")

    # 6. Documentation complete (the doctor's documentation check at signing).
    doc = treatment.get("documentation_check") or {}
    doc_items = doc.get("items") or []
    missing = [i.get("requirement") for i in doc_items if not i.get("passed")]
    if not doc_items:
        check("documentation", False, "The documentation check hasn't been run on the patient chart", None)
    elif missing:
        check("documentation", False, f"Missing from the note: {'; '.join(missing)}", None)
    else:
        check("documentation", True, f"All {len(doc_items)} requirements documented in the signed note", None)

    # 7. Administration code matches the infusion times.
    admin = _administration_view(treatment, drug)
    if not admin:
        check("admin_code", False, "Infusion start/stop times missing", "field-admin_code")
    else:
        check(
            "admin_code",
            True,
            f"{admin['duration_minutes']} minutes → {' + '.join(admin['admin_codes'])}",
            "field-admin_code",
        )

    # 8. Attachments (invoice, FDA label, signed note) and prior auth if required.
    policy = _payer_policy(drug, payer)
    auth_task = _treatment_task(treatment["id"], "prior_auth")
    auth_number = ((auth_task or {}).get("inputs") or {}).get("auth_number")
    gaps = []
    if not invoice_line:
        gaps.append("invoice")
    if not treatment.get("signed_note"):
        gaps.append("signed note")
    if policy and policy.get("prior_auth") and not auth_number:
        gaps.append(f"{payer} prior authorization number")
    if gaps:
        check("attachments", False, f"Missing: {', '.join(gaps)}", "field-attachments")
    else:
        auth_text = f"; prior auth {auth_number}" if auth_number else ""
        check("attachments", True, f"Invoice, FDA label and signed note ready{auth_text}", "field-attachments")

    # Service lines (Box 24), with charges split between the dose used and the waste.
    drawn = dose_given + waste
    lines = []
    if code and drug_units is not None:
        used_charge = _money(vials_cost * dose_given / drawn) if vials_cost is not None and drawn else None
        lines.append(
            {
                "code": code["code"],
                "modifiers": ["JZ"] if modifier == "JZ" else [],
                "units": drug_units,
                "charge": used_charge,
                "ndc_line": f"N4{ndc_digits} UN{vial_count}" if ndc_digits else None,
            }
        )
        if modifier == "JW" and waste_units:
            lines.append(
                {
                    "code": code["code"],
                    "modifiers": ["JW"],
                    "units": waste_units,
                    "charge": _money(vials_cost - used_charge) if used_charge is not None else None,
                    "ndc_line": f"N4{ndc_digits} UN{vial_count}" if ndc_digits else None,
                }
            )
    for admin_line in (admin or {}).get("admin_code_lines", []):
        fee = DEMO_ADMIN_FEES.get(admin_line["code"])
        lines.append(
            {
                "code": admin_line["code"],
                "modifiers": [],
                "units": admin_line["units"],
                "charge": _money(fee * admin_line["units"]) if fee is not None else None,
                "ndc_line": None,
            }
        )
    for number, line in enumerate(lines, start=1):
        line.update(
            {
                "line": number,
                "date_of_service": dos,
                "place_of_service": "11",
                "diagnosis_pointer": "A",
                "rendering_npi": practice["npi"],
            }
        )
    charges = [line["charge"] for line in lines]

    signed_on = (treatment.get("signed_at") or "")[:10]
    return {
        "treatment_id": treatment["id"],
        "date_of_service": dos,
        "patient": {
            "name": _patient_name(patient),
            "dob": patient.get("date_of_birth"),
            "sex": patient.get("sex"),
            "address": patient.get("address"),
            "member_id": patient.get("member_id"),
            "insurance": payer,
            "insurance_type": "Medicare" if (payer or "").lower() == "medicare" else "Group Health Plan",
        },
        "drug": {
            "brand_name": brand,
            "code": code["code"] if code else None,
            "code_type": code["type"] if code else None,
            "units": drug_units,
            "jw_jz": modifier,
            "waste_mg": waste,
            "waste_units": waste_units,
            "ndc_11": ndc_11,
            "lot": lot,
        },
        "item19": item19_text,
        "admin_codes": (admin or {}).get("admin_codes", []),
        "diagnosis_code": diagnosis_code or None,
        "prior_auth_number": auth_number,
        "provider_npi": practice["npi"],
        "billing_provider": practice["name"],
        "federal_tax_id": DEMO_TAX_ID,
        "physician_signature": f"{practice['name']} · {signed_on}" if signed_on else None,
        "service_lines": lines,
        "total_charge": _money(sum(charges)) if charges and None not in charges else None,
        "checks": checks,
        "all_passed": all(c["passed"] for c in checks),
    }


def _refresh_claim(treatment_id: int) -> Optional[dict]:
    """Rebuild and store the claim for an administered, not-yet-exported
    treatment; returns the claim view (the stored one once exported)."""
    treatment, practice_drug, patient, drug = _treatment_bundle(treatment_id)
    if treatment["status"] in ("exported", "needs_recoding"):
        return {**treatment["claim"], "checks": treatment["claim_checks"], "status": treatment["status"]}
    if not treatment.get("date_of_service"):
        return None

    claim = _build_claim(treatment, practice_drug, patient, drug)
    checks = claim.pop("checks")
    supabase.table("treatments").update(
        {
            "claim": claim,
            "claim_checks": checks,
            "billing_code": claim["drug"]["code"],
            "status": "claim_ready",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", treatment_id).execute()
    return {**claim, "checks": checks, "status": "claim_ready"}


@app.get("/api/treatments/{treatment_id}/claim")
def get_claim(treatment_id: int):
    claim = _refresh_claim(treatment_id)
    if claim is None:
        raise HTTPException(status_code=409, detail="No claim yet: the infusion hasn't been recorded")
    return claim


@app.post("/api/treatments/{treatment_id}/export")
def export_claim(treatment_id: int):
    """"Export for clearinghouse": freezes the claim once all 8 checks pass.
    Exporting again (the page's "print again") returns the frozen claim."""
    claim = _refresh_claim(treatment_id)
    if claim is None:
        raise HTTPException(status_code=409, detail="No claim yet: the infusion hasn't been recorded")
    if claim["status"] == "exported":
        return claim
    failing = [c["label"] for c in claim["checks"] if not c["passed"]]
    if failing:
        raise HTTPException(status_code=409, detail=f"Fix before exporting: {'; '.join(failing)}")

    now = datetime.now(timezone.utc).isoformat()
    stored = {k: v for k, v in claim.items() if k not in ("checks", "status")}
    stored["exported_at"] = now
    supabase.table("treatments").update(
        {"claim": stored, "status": "exported", "updated_at": now}
    ).eq("id", treatment_id).execute()
    _complete_task(_treatment_task(treatment_id, "claim_review"))
    return {**stored, "checks": claim["checks"], "status": "exported"}
