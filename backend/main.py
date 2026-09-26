import csv
import json
import os
from collections import defaultdict
from pathlib import Path
from typing import Optional

import anthropic
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
- typical_adult_dose: the most common single adult dose as a fixed amount and \
unit (e.g. 200, "mg"). Null if adult dosing is only weight- or BSA-based.
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
            ndcs.append(
                {
                    "ndc_10": package.get("package_ndc", ""),
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
    response = supabase.table("practices").upsert(row, on_conflict="npi").execute()
    return response.data[0]


@app.get("/api/practices/by-npi/{npi}")
def get_practice_by_npi(npi: str):
    response = supabase.table("practices").select("*").eq("npi", npi).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail=f"No practice found for NPI {npi}")
    return response.data[0]
