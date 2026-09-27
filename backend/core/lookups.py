"""Small database lookups used across stages (drugs, patients, payer policies)."""

from typing import Optional

from fastapi import HTTPException

from core.db import supabase


def patient_name(patient: dict) -> str:
    return f"{patient['first_name']} {patient['last_name']}"


def fetch_drug(application_id: str) -> dict:
    response = (
        supabase.table("drugs").select("*").eq("application_id", application_id).limit(1).execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail=f"No drug found for {application_id}")
    return response.data[0]


def patients_by_treatment(treatment_ids: list[int]) -> dict[int, dict]:
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


def payer_policy(drug: dict, payer: Optional[str]) -> Optional[dict]:
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
