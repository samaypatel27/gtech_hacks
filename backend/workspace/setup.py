""""Get my team ready": creates the drug's workspace and its setup tasks."""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from core.db import supabase

router = APIRouter()


def _build_plan_patients_instruction(drug: dict) -> str:
    brand = drug.get("brand_name") or "this drug"
    return (
        f"How many patients a month do you plan to start on {brand}? "
        "Purchasing uses this number to work out how much to order."
    )


def _policy_status(policy: dict) -> str:
    if policy.get("covered") is False:
        status = "not covered"
    elif policy.get("covered") is None:
        status = "policy under review"
    else:
        status = "covered for approved uses"
    if policy.get("prior_auth"):
        status += ", prior authorization required"
    return status


def _build_payer_review_instruction(drug: dict, practice: dict) -> str:
    brand = drug.get("brand_name") or "this drug"
    payers = practice.get("payers") or []
    if not payers:
        return (
            "Your practice profile lists no insurers. Add them, then review each one's "
            f"policy for {brand}."
        )
    policies = {(p.get("payer") or "").lower(): p for p in drug.get("payer_policies") or []}
    rows = []
    for payer in payers:
        policy = policies.get(payer.lower())
        if policy:
            notes = f" ({policy['notes']})" if policy.get("notes") else ""
            rows.append(f"{payer}: {_policy_status(policy)}{notes}")
        else:
            rows.append(f"{payer}: no policy on file, verify coverage before the first treatment")
    return (
        f"Review how each of your insurers covers {brand}, then mark each one reviewed. "
        + " · ".join(rows)
    )


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
    permanent = next((c for c in drug.get("codes") or [] if c.get("type") == "permanent"), None)
    permanent_note = (
        f"Permanent code {permanent['code']} takes effect {permanent['from']}; claims switch "
        "automatically by date of service. "
        if permanent and not drug.get("has_permanent_code")
        else ""
    )
    return (
        f"{brand} bills under {code_note}. "
        f"{permanent_note}"
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
    practice = (
        supabase.table("practices").select("payers").eq("id", practice_drug["practice_id"]).execute().data[0]
    )

    # Advance the practice's status with this drug to 'adopting'.
    supabase.table("practice_drugs").update(
        {"status": "adopting", "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", practice_drug_id).execute()

    # The six setup tasks from Comp_Details/DataContract.md §3 (kind, role,
    # title), in board order. `status` defaults to 'todo' in the DB, but it's
    # set explicitly so the insert is self-documenting.
    setup = [
        ("plan_patients", "doctor", "Set planned patients", _build_plan_patients_instruction(drug)),
        ("purchasing", "front_desk", "Place the order", _build_purchasing_instruction(drug)),
        ("receiving", "front_desk", "Receive & store", _build_receiving_instruction(drug)),
        ("nurse_setup", "nurse", "Nurse setup", _build_nurse_instruction(drug)),
        ("payer_review", "biller", "Review insurers", _build_payer_review_instruction(drug, practice)),
        ("billing_setup", "biller", "Confirm billing setup", _build_billing_instruction(drug)),
    ]
    tasks = [
        {
            "practice_drug_id": practice_drug_id,
            "stage": "prepare",
            "role": role,
            "kind": kind,
            "title": title,
            "instruction": instruction,
            "status": "todo",
        }
        for kind, role, title, instruction in setup
    ]
    created = supabase.table("tasks").insert(tasks).execute().data

    # What each task waits for (DataContract.md §7). Dependencies need the new
    # ids, so they're set after the insert. Nurse setup and Review insurers
    # can start right away.
    waits = {"purchasing": "plan_patients", "receiving": "purchasing", "billing_setup": "receiving"}
    id_by_kind = {t["kind"]: t["id"] for t in created}
    for task in created:
        if task["kind"] in waits:
            task["waits_on"] = [id_by_kind[waits[task["kind"]]]]
            supabase.table("tasks").update({"waits_on": task["waits_on"]}).eq("id", task["id"]).execute()

    return {
        "practice_drug_id": practice_drug_id,
        "status": "adopting",
        "tasks": created,
    }
