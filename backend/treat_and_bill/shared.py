"""Treat & Bill helpers used by more than one step: loading a treatment with its
workspace, patient and drug, the page-shaped views, and finishing tasks.

One treatments row is one dose for one patient, from order to claim. The
columns keep the shapes in their Postgres COMMENTs; `treatment_view` returns
them in the shape the patient chart and treatment record pages read."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

from billing_rules import admin_codes, waste_modifier
from core.db import supabase
from core.lookups import fetch_drug, patient_name


def fetch_practice_patient(patient_id: int, practice: dict) -> dict:
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


def fetch_practice_treatment(treatment_id: int, practice: dict) -> tuple[dict, dict]:
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


def vial_summary(rows: Optional[list], dose) -> Optional[dict]:
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


def treatment_view(treatment: dict, patient: dict, drug: dict) -> dict:
    return {
        **treatment,
        "patient": {
            "id": patient["id"],
            "name": patient_name(patient),
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
        "vial_mix": vial_summary(treatment.get("vial_mix"), treatment["ordered_dose"]),
        "preparation": preparation_view(treatment, drug),
        "administration": administration_view(treatment, drug),
    }


def preparation_view(treatment: dict, drug: dict) -> Optional[dict]:
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


def administration_view(treatment: dict, drug: dict) -> Optional[dict]:
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


def fetch_treatment_bundle(treatment_id: int) -> tuple[dict, dict, dict, dict]:
    """(treatment, practice_drug, patient, drug), 404 if the treatment doesn't exist."""
    response = supabase.table("treatments").select("*").eq("id", treatment_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail=f"No treatment found for id {treatment_id}")
    treatment = response.data[0]
    practice_drug = (
        supabase.table("practice_drugs").select("*").eq("id", treatment["practice_drug_id"]).execute().data[0]
    )
    patient = supabase.table("patients").select("*").eq("id", treatment["patient_id"]).execute().data[0]
    return treatment, practice_drug, patient, fetch_drug(practice_drug["application_id"])


def fetch_treatment_task(treatment_id: int, kind: str) -> Optional[dict]:
    response = (
        supabase.table("tasks")
        .select("*")
        .eq("treatment_id", treatment_id)
        .eq("kind", kind)
        .limit(1)
        .execute()
    )
    return response.data[0] if response.data else None


def complete_task(task: Optional[dict]) -> None:
    if task and task["status"] != "done":
        supabase.table("tasks").update(
            {"status": "done", "completed_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", task["id"]).execute()
