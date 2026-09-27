"""Treat & Bill: the doctor's order. Creating it, signing it, the patient's task
chain that signing creates, and the Patients tab tracker."""

import hashlib
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from billing_rules import dose_for, vial_mix
from core.auth import current_practice
from core.db import supabase
from core.lookups import fetch_drug, patient_name, patients_by_treatment, payer_policy
from core.task_rules import waiting_on_labels
from treat_and_bill.shared import (
    fetch_practice_patient,
    fetch_practice_treatment,
    treatment_view,
    vial_summary,
)

router = APIRouter()


def _practice_drug_for(
    practice: dict, practice_drug_id: Optional[int], application_id: Optional[str]
) -> dict:
    """This practice's workspace for a drug, by id or by the drug's application id."""
    query = supabase.table("practice_drugs").select("*").eq("practice_id", practice["id"])
    if practice_drug_id is not None:
        query = query.eq("id", practice_drug_id)
    elif application_id:
        query = query.eq("application_id", application_id)
    else:
        raise HTTPException(status_code=422, detail="Send practice_drug_id or application_id")
    response = query.limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail="This practice has no workspace for that drug")
    return response.data[0]


def _vial_packages(drug: dict) -> dict[float, str]:
    """Vial strength in mg → its 11-digit NDC, from the drug's `ndcs` list."""
    packages = {}
    for ndc in drug.get("ndcs") or []:
        if ndc.get("strength_mg") and ndc.get("ndc_11"):
            packages.setdefault(float(ndc["strength_mg"]), ndc["ndc_11"])
    return packages


def _order_for(drug: dict, patient: dict, dose_override: Optional[float]):
    """The dose for this patient and its least-waste vials, as
    (dose, unit, vial_mix column rows [{ndc_11, strength, count}])."""
    if dose_override is not None:
        if dose_override <= 0:
            raise HTTPException(status_code=422, detail="Dose must be positive")
        dose, unit = dose_override, "mg"
    else:
        typical = drug.get("typical_adult_dose")
        if not typical:
            raise HTTPException(
                status_code=422,
                detail=f"{drug.get('brand_name')} has no label dose to calculate from; enter the dose",
            )
        try:
            dose, unit = dose_for(typical["amount"], typical["unit"], weight_kg=patient.get("weight_kg"))
        except ValueError as err:
            raise HTTPException(status_code=422, detail=str(err))

    packages = _vial_packages(drug)
    if not packages:
        raise HTTPException(
            status_code=422, detail=f"No vial strengths on file for {drug.get('brand_name')}"
        )
    if unit.lower() != "mg":
        raise HTTPException(status_code=422, detail=f"Vial strengths are in mg but the dose is in {unit}")

    mix = vial_mix(dose, list(packages))
    rows = [
        {"ndc_11": packages[float(size)], "strength": size, "count": count}
        for size, count in mix["vials"].items()
    ]
    return dose, unit, rows


def _vial_text(summary: dict) -> str:
    if summary["vial_size_mg"] is not None:
        return f"{summary['vials']} × {summary['vial_size_mg']} mg vials"
    return f"{summary['vials']} vials"


class TreatmentCreate(BaseModel):
    patient_id: int
    # The chart page sends both; either one finds the practice's workspace.
    practice_drug_id: Optional[int] = None
    application_id: Optional[str] = None
    dose: Optional[float] = None  # the doctor's override, in mg; else calculated from the label


# "New Order": creates the treatment and the doctor's "Order + sign" card.
@router.post("/api/treatments")
def create_treatment(payload: TreatmentCreate, practice: dict = Depends(current_practice)):
    patient = fetch_practice_patient(payload.patient_id, practice)
    practice_drug = _practice_drug_for(practice, payload.practice_drug_id, payload.application_id)
    drug = fetch_drug(practice_drug["application_id"])
    dose, unit, rows = _order_for(drug, patient, payload.dose)

    treatment = (
        supabase.table("treatments")
        .insert(
            {
                "practice_drug_id": practice_drug["id"],
                "patient_id": patient["id"],
                "status": "ordered",
                "ordered_dose": dose,
                "dose_unit": unit,
                "vial_mix": rows,
            }
        )
        .execute()
        .data[0]
    )

    name = patient_name(patient)
    brand = drug.get("brand_name") or "this drug"
    supabase.table("tasks").insert(
        {
            "practice_drug_id": practice_drug["id"],
            "treatment_id": treatment["id"],
            "stage": "treat_and_bill",
            "role": "doctor",
            "kind": "order_sign",
            "title": f"Order + sign: {name}",
            "instruction": (
                f"Check {name}'s visit note against the payer documentation requirements, "
                f"then sign the order for {dose} {unit} of {brand} "
                f"({_vial_text(vial_summary(rows, dose))})."
            ),
            "status": "todo",
        }
    ).execute()

    return treatment_view(treatment, patient, drug)


# The Patients tab's tracker: one row per dose, each with its steps. No login,
# like the task board it sits next to (staff views have no session yet).
@router.get("/api/practice-drugs/{practice_drug_id}/treatments")
def list_practice_drug_treatments(practice_drug_id: int):
    treatments = (
        supabase.table("treatments")
        .select("*")
        .eq("practice_drug_id", practice_drug_id)
        .order("created_at")
        .order("id")
        .execute()
        .data
        or []
    )
    if not treatments:
        return []

    patients = patients_by_treatment([t["id"] for t in treatments])
    tasks = (
        supabase.table("tasks")
        .select("id,treatment_id,kind,title,role,status,waits_on")
        .in_("treatment_id", [t["id"] for t in treatments])
        .order("id")
        .execute()
        .data
        or []
    )
    tasks_by_id = {t["id"]: t for t in tasks}

    doses_so_far: dict[int, int] = defaultdict(int)
    rows = []
    for treatment in treatments:
        doses_so_far[treatment["patient_id"]] += 1
        patient = patients.get(treatment["id"])
        steps = []
        for task in (t for t in tasks if t["treatment_id"] == treatment["id"]):
            waiting_on = waiting_on_labels(task, tasks_by_id)
            state = "done" if task["status"] == "done" else "waiting" if waiting_on else "todo"
            steps.append(
                {
                    "task_id": task["id"],
                    "kind": task["kind"],
                    "title": task["title"],
                    "role": task["role"],
                    "state": state,
                    "waiting_on": waiting_on,
                }
            )
        rows.append(
            {
                "treatment_id": treatment["id"],
                "patient_id": treatment["patient_id"],
                "patient_name": patient_name(patient) if patient else None,
                "dose_number": doses_so_far[treatment["patient_id"]],
                "status": treatment["status"],
                "dose": {"amount": treatment["ordered_dose"], "unit": treatment["dose_unit"]},
                "date_of_service": treatment.get("date_of_service"),
                "created_at": treatment["created_at"],
                "steps": steps,
            }
        )
    return rows


def _stock_quantity(practice_drug: dict) -> float:
    return sum(
        s.get("quantity") or 0 for s in practice_drug.get("stock_on_hand") or [] if isinstance(s, dict)
    )


def _create_patient_chain(treatment: dict, patient: dict, practice_drug: dict, drug: dict) -> None:
    """The rest of this patient's cards, created at signing so everyone sees
    what's coming before it's their turn. Prior auth (B) and buy-for-patient
    (C) only appear when needed; the nurse's prep (D) waits on the signed order
    plus whichever of them exist, then give (E) waits on D and claim review (F)
    waits on E."""
    name = patient_name(patient)
    brand = drug.get("brand_name") or "this drug"
    summary = vial_summary(treatment["vial_mix"], treatment["ordered_dose"])
    dose = f"{treatment['ordered_dose']} {treatment['dose_unit']}"

    def add(role: str, kind: str, title: str, instruction: str, waits_on: list[int]) -> int:
        row = {
            "practice_drug_id": practice_drug["id"],
            "treatment_id": treatment["id"],
            "stage": "treat_and_bill",
            "role": role,
            "kind": kind,
            "title": title,
            "instruction": instruction,
            "status": "todo",
            "waits_on": waits_on,
        }
        return supabase.table("tasks").insert(row).execute().data[0]["id"]

    order_resp = (
        supabase.table("tasks")
        .select("id")
        .eq("treatment_id", treatment["id"])
        .eq("kind", "order_sign")
        .execute()
    )
    before_prep = [t["id"] for t in order_resp.data or []]

    policy = payer_policy(drug, patient.get("payer"))
    if policy and policy.get("prior_auth"):
        notes = f" {policy['notes']}" if policy.get("notes") else ""
        before_prep.append(
            add(
                "biller",
                "prior_auth",
                f"Get prior auth: {name}",
                f"{policy['payer']} requires prior authorization for {brand} before {name}'s "
                f"first dose.{notes} Submit the request, then enter the authorization number "
                "on this card (it goes in Box 23 of the claim).",
                [],
            )
        )

    in_stock = _stock_quantity(practice_drug)
    if in_stock < summary["vials"]:
        distributors = ", ".join(
            d.get("name", str(d)) if isinstance(d, dict) else str(d)
            for d in drug.get("distributors") or []
        )
        from_text = f" from {distributors}" if distributors else ""
        before_prep.append(
            add(
                "front_desk",
                "buy_for_patient",
                f"Buy {brand} for {name}",
                f"{name}'s dose needs {_vial_text(summary)} and {in_stock:g} are in stock. "
                f"Order{from_text}, then record the invoice so the stock is updated.",
                [],
            )
        )

    prep_id = add(
        "nurse",
        "prep_dose",
        f"Prepare {name}'s dose",
        f"Prepare {dose} of {brand} for {name} from {_vial_text(summary)}. Record the vials, "
        f"lot number and waste (planned waste: {summary['waste_mg']:g} mg) on the treatment record.",
        before_prep,
    )
    infusion = drug.get("infusion_time_minutes")
    over = f" over {infusion} minutes" if infusion else ""
    give_id = add(
        "nurse",
        "give_infusion",
        f"Give {name}'s infusion",
        f"Give {name}'s {brand} infusion{over}. Record the date of service and the start and "
        "stop times: the date of service decides which billing code the claim uses.",
        [prep_id],
    )
    add(
        "biller",
        "claim_review",
        f"Review claim: {name}",
        f"Review {name}'s generated CMS-1500 claim, clear all 8 pre-submission checks, then "
        "export it for your clearinghouse.",
        [give_id],
    )


@router.post("/api/treatments/{treatment_id}/sign")
def sign_treatment(treatment_id: int, practice: dict = Depends(current_practice)):
    treatment, practice_drug = fetch_practice_treatment(treatment_id, practice)
    patient = fetch_practice_patient(treatment["patient_id"], practice)
    drug = fetch_drug(practice_drug["application_id"])

    # The check must have been run on the note being signed. Gaps don't block
    # signing -- the doctor decides -- but the claim's documentation check
    # will flag them.
    check = treatment.get("documentation_check") or {}
    current_note = hashlib.sha256((patient.get("visit_note") or "").encode()).hexdigest()
    if treatment["status"] == "ordered" and check.get("note_sha256") != current_note:
        raise HTTPException(
            status_code=409, detail="Run the documentation check on the current note before signing"
        )

    now = datetime.now(timezone.utc).isoformat()
    # Only matches while still 'ordered', so a double-click can't sign twice
    # (or build the patient's chain twice).
    signed_resp = (
        supabase.table("treatments")
        .update(
            {
                "status": "signed",
                "signed_at": now,
                "signed_note": patient.get("visit_note"),
                "updated_at": now,
            }
        )
        .eq("id", treatment_id)
        .eq("status", "ordered")
        .execute()
    )
    if not signed_resp.data:
        raise HTTPException(
            status_code=409, detail=f"This order is already {treatment['status']}, not awaiting a signature"
        )
    signed = signed_resp.data[0]

    supabase.table("tasks").update({"status": "done", "completed_at": now}).eq(
        "treatment_id", treatment_id
    ).eq("kind", "order_sign").execute()
    _create_patient_chain(signed, patient, practice_drug, drug)

    return treatment_view(signed, patient, drug)
