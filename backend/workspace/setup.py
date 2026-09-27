""""Get my team ready": creates the drug's workspace and its setup tasks."""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from core.db import supabase

router = APIRouter()


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


@router.post("/api/practice-drugs/{practice_drug_id}/team-ready")
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

    # Idempotent: if tasks already exist for this practice_drug, return them
    # without inserting again.  A second click on "Get my team ready" is a
    # no-op -- the user just gets navigated to the workspace that already exists.
    existing_resp = (
        supabase.table("tasks")
        .select("*")
        .eq("practice_drug_id", practice_drug_id)
        .order("id")
        .execute()
    )
    if existing_resp.data:
        return {
            "practice_drug_id": practice_drug_id,
            "status": practice_drug["status"],
            "tasks": existing_resp.data,
        }

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
    created = task_resp.data

    # Dependencies need the new ids, so they're set after the insert:
    # Receiving waits on Purchasing.
    id_by_kind = {t["kind"]: t["id"] for t in created}
    receiving = next(t for t in created if t["kind"] == "receiving")
    receiving["waits_on"] = [id_by_kind["purchasing"]]
    supabase.table("tasks").update({"waits_on": receiving["waits_on"]}).eq(
        "id", receiving["id"]
    ).execute()

    return {
        "practice_drug_id": practice_drug_id,
        "status": "adopting",
        "tasks": created,
    }
