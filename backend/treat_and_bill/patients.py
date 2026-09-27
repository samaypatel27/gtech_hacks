"""Treat & Bill: patients.

Patient data is the practice-only tier, so every query here is scoped to the
signed-in practice via `current_practice` -- another practice's patient ids
404 exactly like missing ones."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.auth import current_practice
from core.db import supabase
from core.lookups import patient_name
from treat_and_bill.shared import fetch_practice_patient

router = APIRouter()


def _patient_view(patient: dict) -> dict:
    """The row plus the display fields the patient chart reads (name, dob,
    insurance) -- aliases only, the columns themselves are unchanged."""
    return {
        **patient,
        "name": patient_name(patient),
        "dob": patient.get("date_of_birth"),
        "insurance": patient.get("payer"),
    }


@router.get("/api/patients")
def list_patients(practice: dict = Depends(current_practice)):
    response = (
        supabase.table("patients")
        .select("*")
        .eq("practice_id", practice["id"])
        .order("last_name")
        .execute()
    )
    return [_patient_view(p) for p in response.data]


@router.get("/api/patients/{patient_id}")
def get_patient(patient_id: int, practice: dict = Depends(current_practice)):
    return _patient_view(fetch_practice_patient(patient_id, practice))


class VisitNoteUpdate(BaseModel):
    # The chart page sends `note`; `visit_note` (the column name) works too.
    note: Optional[str] = None
    visit_note: Optional[str] = None


# The note is edited live in the demo (delete a line -> the documentation
# check flips to a gap), so it's its own small endpoint.
@router.patch("/api/patients/{patient_id}/note")
def update_visit_note(
    patient_id: int, payload: VisitNoteUpdate, practice: dict = Depends(current_practice)
):
    note = payload.note if payload.note is not None else payload.visit_note
    if note is None:
        raise HTTPException(status_code=422, detail="Send the note as `note`")
    fetch_practice_patient(patient_id, practice)
    response = (
        supabase.table("patients")
        .update({"visit_note": note, "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", patient_id)
        .execute()
    )
    return _patient_view(response.data[0])
