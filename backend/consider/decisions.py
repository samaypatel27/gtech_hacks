"""The doctor's decisions on a drug's page, before the team gets involved.

  * Planned patients per month: feeds the payment-timing estimate, so the
    lights are recomputed and returned right away.
  * Hold list: patients the doctor wants to treat later (typically once the
    permanent code arrives). Adding the first patient moves the drug from
    "considering" to "holding"; when the code changes, Switch gives the doctor
    a "Review hold list" card (switch/code_changes.py).

Scoped to the signed-in practice via `current_practice`: another practice's
workspace or patient ids 404 like missing ones.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from consider.lights import compute_lights
from core.auth import current_practice
from core.db import supabase
from core.lookups import fetch_drug, patient_name

router = APIRouter()


class PlanUpdate(BaseModel):
    planned_patients_per_month: Optional[int] = Field(default=None, ge=0, le=1000)


class HoldRequest(BaseModel):
    patient_id: int
    note: Optional[str] = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _own_practice_drug(practice_drug_id: int, practice: dict) -> dict:
    response = (
        supabase.table("practice_drugs")
        .select("*")
        .eq("id", practice_drug_id)
        .eq("practice_id", practice["id"])
        .limit(1)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail=f"No workspace {practice_drug_id} for this practice")
    return response.data[0]


def _hold_list_view(hold_list: list) -> list:
    """Hold-list entries with each patient's name and insurer, oldest first."""
    ids = [entry["patient_id"] for entry in hold_list]
    patients = {}
    if ids:
        rows = (
            supabase.table("patients")
            .select("id,first_name,last_name,payer")
            .in_("id", ids)
            .execute()
            .data
            or []
        )
        patients = {p["id"]: p for p in rows}
    view = []
    for entry in hold_list:
        patient = patients.get(entry["patient_id"])
        if patient:  # a deleted patient drops off the list
            view.append({**entry, "name": patient_name(patient), "payer": patient.get("payer")})
    return view


@router.patch("/api/practice-drugs/{practice_drug_id}/plan")
def update_plan(practice_drug_id: int, payload: PlanUpdate, practice: dict = Depends(current_practice)):
    practice_drug = _own_practice_drug(practice_drug_id, practice)
    practice_drug["planned_patients_per_month"] = payload.planned_patients_per_month
    lights = compute_lights(fetch_drug(practice_drug["application_id"]), practice, practice_drug)
    return (
        supabase.table("practice_drugs")
        .update(
            {
                "planned_patients_per_month": payload.planned_patients_per_month,
                "lights": lights,
                "updated_at": _now(),
            }
        )
        .eq("id", practice_drug_id)
        .execute()
        .data[0]
    )


@router.get("/api/practice-drugs/{practice_drug_id}/hold-list")
def get_hold_list(practice_drug_id: int, practice: dict = Depends(current_practice)):
    practice_drug = _own_practice_drug(practice_drug_id, practice)
    return {
        "status": practice_drug["status"],
        "hold_list": _hold_list_view(practice_drug.get("hold_list") or []),
    }


@router.post("/api/practice-drugs/{practice_drug_id}/hold-list")
def add_to_hold_list(practice_drug_id: int, payload: HoldRequest, practice: dict = Depends(current_practice)):
    practice_drug = _own_practice_drug(practice_drug_id, practice)
    patient = (
        supabase.table("patients")
        .select("id")
        .eq("id", payload.patient_id)
        .eq("practice_id", practice["id"])
        .limit(1)
        .execute()
        .data
    )
    if not patient:
        raise HTTPException(status_code=404, detail=f"No patient {payload.patient_id} in this practice")

    note = (payload.note or "").strip() or None
    hold_list = practice_drug.get("hold_list") or []
    existing = next((e for e in hold_list if e["patient_id"] == payload.patient_id), None)
    if existing:  # adding someone already held just updates the note
        existing["note"] = note
    else:
        hold_list.append({"patient_id": payload.patient_id, "added_at": _now(), "note": note})

    update = {"hold_list": hold_list, "updated_at": _now()}
    if practice_drug["status"] == "considering":
        update["status"] = "holding"
    row = supabase.table("practice_drugs").update(update).eq("id", practice_drug_id).execute().data[0]
    return {"status": row["status"], "hold_list": _hold_list_view(hold_list)}


@router.delete("/api/practice-drugs/{practice_drug_id}/hold-list/{patient_id}")
def remove_from_hold_list(practice_drug_id: int, patient_id: int, practice: dict = Depends(current_practice)):
    practice_drug = _own_practice_drug(practice_drug_id, practice)
    hold_list = [e for e in practice_drug.get("hold_list") or [] if e["patient_id"] != patient_id]

    update = {"hold_list": hold_list, "updated_at": _now()}
    if not hold_list and practice_drug["status"] == "holding":
        update["status"] = "considering"
    row = supabase.table("practice_drugs").update(update).eq("id", practice_drug_id).execute().data[0]
    return {"status": row["status"], "hold_list": _hold_list_view(hold_list)}
