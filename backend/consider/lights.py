"""The "Can my practice use this?" lights shown on a drug's page."""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.db import supabase

router = APIRouter()


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


@router.post("/api/practice-drugs/considering")
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
