"""Drugs a practice has pinned to the top of its grid."""

from fastapi import APIRouter, Depends, HTTPException

from core.auth import current_practice
from core.db import supabase

router = APIRouter()


@router.get("/api/pins")
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
@router.put("/api/pins/{application_id}", status_code=204)
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


@router.delete("/api/pins/{application_id}", status_code=204)
def unpin_drug(application_id: str, practice: dict = Depends(current_practice)):
    (
        supabase.table("pinned_drugs")
        .delete()
        .eq("practice_id", practice["id"])
        .eq("application_id", application_id)
        .execute()
    )
