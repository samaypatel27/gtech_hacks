"""openFDA lookups and Claude's extraction of facts from the FDA label."""

import json

import anthropic
import httpx
from fastapi import APIRouter, HTTPException

from billing_rules import is_single_dose_package, ndc_10_to_11, vial_strength_mg
from core.ai import claude

router = APIRouter()


OPENFDA_BASE_URL = "https://api.fda.gov/drug"


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


@router.get("/api/fda/label/{application_number}")
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


@router.get("/api/fda/label-extraction/{application_number}")
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


@router.get("/api/fda/ndc/{application_number}")
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
        # Vial strength needs a single active ingredient (a combination
        # product's mg per vial is ambiguous); anything unreadable stays None.
        ingredients = result.get("active_ingredients") or []
        strength = ingredients[0].get("strength") if len(ingredients) == 1 else None
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
                    "strength_mg": vial_strength_mg(strength, package.get("description")),
                    "single_dose": is_single_dose_package(package.get("description")),
                }
            )

    return {"route": route, "ndcs": ndcs}
