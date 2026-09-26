import csv
import json
import os
from collections import defaultdict
from datetime import datetime, timezone
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

    return {
        "practice_drug_id": practice_drug_id,
        "status": "adopting",
        "tasks": task_resp.data,
    }


@app.get("/api/practice-drugs/{practice_drug_id}/tasks")
def get_practice_drug_tasks(practice_drug_id: int):
    """Return the tasks for this practice_drugs row plus the drug's brand name,
    so the workspace page can display both without a separate drug-profile fetch."""
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
        .select("brand_name")
        .eq("application_id", practice_drug["application_id"])
        .limit(1)
        .execute()
    )
    drug_name = drug_resp.data[0]["brand_name"] if drug_resp.data else ""

    tasks_resp = (
        supabase.table("tasks")
        .select("*")
        .eq("practice_drug_id", practice_drug_id)
        .order("id")
        .execute()
    )
    return {"drug_name": drug_name, "tasks": tasks_resp.data}


class TaskStatusUpdate(BaseModel):
    status: str  # 'todo' | 'done'


@app.patch("/api/tasks/{task_id}/status")
def update_task_status(task_id: int, payload: TaskStatusUpdate):
    """Toggle a task between 'todo' and 'done'.  Sets completed_at when done."""
    if payload.status not in ("todo", "done"):
        raise HTTPException(
            status_code=422,
            detail="status must be 'todo' or 'done'",
        )
    update = {"status": payload.status}
    if payload.status == "done":
        update["completed_at"] = datetime.now(timezone.utc).isoformat()
    else:
        update["completed_at"] = None  # clear when un-checking

    resp = supabase.table("tasks").update(update).eq("id", task_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail=f"No task found for id {task_id}")
    return resp.data[0]


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
