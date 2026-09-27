"""Treat & Bill: the nurse's treatment record (preparation + administration).

Like the rest of /staff/*, these have no login yet, so they're reached by
treatment id alone."""

from datetime import date, datetime, time, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.db import supabase
from core.task_rules import raise_if_waiting
from treat_and_bill.claims import refresh_claim
from treat_and_bill.shared import (
    complete_task,
    fetch_treatment_bundle,
    fetch_treatment_task,
    treatment_view,
    vial_summary,
)

router = APIRouter()


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


@router.get("/api/treatments/{treatment_id}")
def get_treatment(treatment_id: int):
    treatment, _practice_drug, patient, drug = fetch_treatment_bundle(treatment_id)
    return treatment_view(treatment, patient, drug)


class PreparationRecord(BaseModel):
    vials_used: Optional[int] = None  # defaults to the order's planned vial count
    lot_number: Optional[str] = None
    waste_mg: Optional[float] = None  # defaults to the order's planned waste


@router.patch("/api/treatments/{treatment_id}/preparation")
def save_preparation(treatment_id: int, payload: PreparationRecord):
    treatment, practice_drug, patient, drug = fetch_treatment_bundle(treatment_id)
    _raise_unless_recordable(treatment)
    prep_task = fetch_treatment_task(treatment_id, "prep_dose")
    if prep_task:
        raise_if_waiting(prep_task)

    summary = vial_summary(treatment["vial_mix"], treatment["ordered_dose"])
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
    complete_task(prep_task)
    # A correction after the infusion changes the dose given, so rebuild the claim.
    refresh_claim(treatment_id)
    return get_treatment(treatment_id)


class AdministrationRecord(BaseModel):
    date_of_service: date
    start_time: time  # wall-clock "HH:MM" on the date of service
    stop_time: time


@router.patch("/api/treatments/{treatment_id}/administration")
def save_administration(treatment_id: int, payload: AdministrationRecord):
    treatment, _practice_drug, patient, drug = fetch_treatment_bundle(treatment_id)
    _raise_unless_recordable(treatment)
    if not treatment.get("vials_used"):
        raise HTTPException(status_code=409, detail="Save the preparation first")
    give_task = fetch_treatment_task(treatment_id, "give_infusion")
    if give_task:
        raise_if_waiting(give_task)

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
    complete_task(give_task)
    refresh_claim(treatment_id)
    return get_treatment(treatment_id)
