"""Treat & Bill: the claim builder (CMS-1500 + the 8 pre-submission checks) and export."""

from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException

from billing_rules import code_for, code_kind_label, code_timeline, is_generic, item19, units, waste_modifier
from core.db import supabase
from core.lookups import patient_name, payer_policy
from treat_and_bill.shared import (
    administration_view,
    complete_task,
    fetch_treatment_bundle,
    fetch_treatment_task,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Treat & Bill: claim builder (CMS-1500 + the 8 pre-submission checks)
# ---------------------------------------------------------------------------
# Built from the treatment row whenever the nurse record changes and on every
# claim view until export, so later fixes (an invoice, a prior-auth number, a
# documentation check) show up without a rebuild button. Once exported the
# stored claim is frozen. Response fields follow what ClaimPage.jsx reads.

# 24F charges for administration lines. The practice's own fee schedule isn't
# collected anywhere yet, so these are labeled demo values.
DEMO_ADMIN_FEES = {"96365": 150.00, "96366": 40.00, "96374": 60.00, "96409": 120.00, "96413": 280.00, "96415": 60.00}


DEMO_TAX_ID = "98-7654321"


CLAIM_CHECK_LABELS = {
    "item19": "Drug details complete in Item 19",
    "ndc": "NDC in 11-digit format and matches the invoice",
    "units": "Units correct for the code type and payer",
    "waste_modifier": "JW/JZ applied correctly",
    "diagnosis": "Diagnosis matches an approved use",
    "documentation": "Documentation complete",
    "admin_code": "Administration code matches the infusion times",
    "attachments": "Attachments ready (prior auth on file if required)",
}


def _invoice_line(practice_drug: dict, ndc_11: Optional[str], lot: Optional[str]) -> Optional[dict]:
    """The invoice line for these vials: same NDC and lot if possible, else same NDC."""
    lines = [
        line
        for invoice in practice_drug.get("invoices") or []
        for line in invoice.get("lines") or []
        if line.get("ndc_11") == ndc_11
    ]
    return next((line for line in lines if lot and line.get("lot") == lot), lines[0] if lines else None)


def _money(value) -> float:
    return round(float(value), 2)


def _day(value) -> str:
    d = value if isinstance(value, date) else date.fromisoformat(str(value)[:10])
    return f"{d:%b} {d.day}, {d.year}"


def _code_note(codes: list, payer: Optional[str], dos, code: Optional[dict]) -> Optional[str]:
    """Why this claim uses this code, in plain English. The date the drug was
    given decides the code, so a dose given before a switch keeps the old code
    even if the claim is sent after it."""
    if not code:
        return None
    try:
        t = code_timeline(codes, dos, payer)
    except ValueError:
        return None
    kind = code_kind_label(code)
    if t["next"]:
        return (
            f"Given {_day(dos)}, before {t['next']['code']} takes effect {_day(t['changes_on'])}: "
            f"billed as {kind} {code['code']}. The date the drug was given decides the code."
        )
    if t["previous"]:
        return (
            f"Given {_day(dos)}, on or after {code['code']} took effect {_day(t['changed_on'])} "
            f"(replacing {code_kind_label(t['previous'])} {t['previous']['code']}): billed as {kind} {code['code']}."
        )
    return f"Billed as {kind} {code['code']} for a dose given {_day(dos)}."


def build_claim(
    treatment: dict,
    practice_drug: dict,
    patient: dict,
    drug: dict,
    practice: dict,
    auth_number: Optional[str],
    replaces: Optional[dict] = None,
) -> dict:
    """The CMS-1500 for one administered treatment, plus its 8 checks, in the
    shape ClaimPage.jsx reads.

    Pure: no database or network calls. Everything it needs is passed in
    (`refresh_claim` looks it up), so the same inputs always build the same
    claim and it can be tested directly (tests/test_claims.py).

    `replaces` is the earlier exported version when this is a corrected claim
    ({billing_code, exported_at}); it fills Box 22 with resubmission code 7."""
    brand = drug.get("brand_name") or ""
    payer = patient.get("payer")
    dos = treatment["date_of_service"]
    dose_unit = treatment["dose_unit"]
    dose_given = float(treatment.get("dose_given") or 0)
    waste = float(treatment.get("waste_amount") or 0)
    vials = treatment.get("vials_used") or []
    vial_count = sum(v.get("quantity") or 0 for v in vials)
    ndc_11 = vials[0].get("ndc_11") if vials else None
    lot = vials[0].get("lot") if vials else None
    ndc_digits = (ndc_11 or "").replace("-", "")
    checks = []

    def check(check_id: str, passed: bool, message: str, fix_field: Optional[str]) -> None:
        checks.append(
            {
                "id": check_id,
                "label": CLAIM_CHECK_LABELS[check_id],
                "passed": passed,
                "message": message,
                "fix_field": None if passed else fix_field,
            }
        )

    # Code by date of service and payer (the Switch Day rule).
    try:
        code = code_for(drug.get("codes") or [], payer, dos)
        code_problem = None if code else f"No billing code covers {dos} for {brand}"
    except ValueError as err:
        code, code_problem = None, str(err)
    generic = bool(code) and is_generic(code)

    # Invoice: price for Box 19 and 24F, and the NDC/lot match for check 2.
    invoice_line = _invoice_line(practice_drug, ndc_11, lot)
    cost_per_vial = invoice_line.get("cost_per_vial") if invoice_line else None
    vials_cost = _money(cost_per_vial * vial_count) if cost_per_vial is not None else None

    # 1. Item 19 -- required for generic codes (drug name, dose, route, NDC, invoice cost).
    item19_text = None
    if not generic and code:
        check("item19", True, f"Not required: {code['code']} is a {code_kind_label(code)} code", "field-item19")
    elif len(ndc_digits) != 11 or not ndc_digits.isdigit():
        check("item19", False, f"Item 19 needs an 11-digit NDC; recorded: {ndc_11 or '(none)'}", "field-item19")
    else:
        item19_text, fits = item19(
            brand, dose_given, dose_unit, drug.get("route_of_administration") or "", ndc_11, vials_cost
        )
        if vials_cost is None:
            check("item19", False, "Invoice price missing: record the invoice so Item 19 includes the cost", "field-item19")
        elif not fits:
            check("item19", False, f"Item 19 is {len(item19_text)} characters; the limit is 80", "field-item19")
        else:
            check("item19", True, f"Name, dose, route, NDC and cost present ({len(item19_text)}/80 characters)", "field-item19")

    # 2. NDC is 11 digits and matches the invoice.
    if len(ndc_digits) != 11 or not ndc_digits.isdigit():
        check("ndc", False, f"NDC {ndc_11 or '(none)'} isn't in 11-digit 5-4-2 format", "field-ndc")
    elif not invoice_line and generic:
        check("ndc", False, f"No invoice line for NDC {ndc_11}: record the invoice", "field-ndc")
    elif not invoice_line:
        check("ndc", True, f"{ndc_11} is in 11-digit format (no invoice on file to compare)", "field-ndc")
    elif lot and invoice_line.get("lot") != lot:
        check("ndc", False, f"Lot {lot} isn't on the invoice (invoice lot {invoice_line.get('lot')})", "field-ndc")
    else:
        check("ndc", True, f"{ndc_11} matches the invoice{f' (lot {lot})' if lot else ''}", "field-ndc")

    # 3. Units for the code type.
    drug_units = waste_units = None
    if code_problem:
        check("units", False, code_problem, "field-code")
    else:
        try:
            drug_units = units(dose_given, dose_unit, code)
            waste_units = units(waste, dose_unit, code) if waste > 0 else None
            rule = (
                "Generic code: 1 unit per line"
                if generic
                else f"{dose_given:g} {dose_unit} ÷ {code['unit']} = {drug_units} units"
            )
            check("units", True, rule, "field-units")
        except ValueError as err:
            check("units", False, str(err), "field-units")

    # 4. JW/JZ.
    modifier = waste_modifier(drug.get("is_single_dose_vial"), waste)
    largest_vial = max((p["strength"] for p in treatment.get("vial_mix") or []), default=None)
    if largest_vial is not None and waste >= largest_vial:
        check(
            "waste_modifier",
            False,
            f"{waste:g} {dose_unit} wasted is a whole vial or more: recheck the vials used",
            "field-waste_modifier",
        )
    elif modifier == "JW":
        check("waste_modifier", True, f"Single-dose vial, {waste:g} {dose_unit} discarded: JW line added", "field-waste_modifier")
    elif modifier == "JZ":
        check("waste_modifier", True, "Single-dose vial with no waste: JZ on the drug line", "field-waste_modifier")
    else:
        check("waste_modifier", True, "Not a single-dose vial: no JW/JZ", "field-waste_modifier")

    # 5. Diagnosis matches an approved use.
    diagnosis = patient.get("diagnosis") or ""
    diagnosis_code, _, diagnosis_text = diagnosis.partition(" ")
    approved = drug.get("approved_uses_and_conditions") or []
    match = next(
        (
            use["approved_diagnosis"]
            for use in approved
            if diagnosis_text and diagnosis_text.lower() in (use.get("approved_diagnosis") or "").lower()
        ),
        None,
    )
    if not diagnosis_code:
        check("diagnosis", False, "No diagnosis on the patient record", "field-diagnosis")
    elif match:
        check("diagnosis", True, f"{diagnosis_code} matches the approved use: {match}", "field-diagnosis")
    else:
        check("diagnosis", False, f"{diagnosis} doesn't match an approved use of {brand}", "field-diagnosis")

    # 6. Documentation complete (the doctor's documentation check at signing).
    doc = treatment.get("documentation_check") or {}
    doc_items = doc.get("items") or []
    missing = [i.get("requirement") for i in doc_items if not i.get("passed")]
    if not doc_items:
        check("documentation", False, "The documentation check hasn't been run on the patient chart", None)
    elif missing:
        check("documentation", False, f"Missing from the note: {'; '.join(missing)}", None)
    else:
        check("documentation", True, f"All {len(doc_items)} requirements documented in the signed note", None)

    # 7. Administration code matches the infusion times.
    admin = administration_view(treatment, drug)
    if not admin:
        check("admin_code", False, "Infusion start/stop times missing", "field-admin_code")
    else:
        check(
            "admin_code",
            True,
            f"{admin['duration_minutes']} minutes → {' + '.join(admin['admin_codes'])}",
            "field-admin_code",
        )

    # 8. Attachments (invoice, FDA label, signed note) and prior auth if required.
    policy = payer_policy(drug, payer)
    gaps = []
    if not invoice_line and generic:
        gaps.append("invoice")
    if not treatment.get("signed_note"):
        gaps.append("signed note")
    if policy and policy.get("prior_auth") and not auth_number:
        gaps.append(f"{payer} prior authorization number")
    if gaps:
        check("attachments", False, f"Missing: {', '.join(gaps)}", "field-attachments")
    else:
        auth_text = f"; prior auth {auth_number}" if auth_number else ""
        ready = "Invoice, FDA label and signed note" if invoice_line else "FDA label and signed note"
        check("attachments", True, f"{ready} ready{auth_text}", "field-attachments")

    # Service lines (Box 24), with charges split between the dose used and the waste.
    drawn = dose_given + waste
    lines = []
    if code and drug_units is not None:
        used_charge = _money(vials_cost * dose_given / drawn) if vials_cost is not None and drawn else None
        lines.append(
            {
                "code": code["code"],
                "modifiers": ["JZ"] if modifier == "JZ" else [],
                "units": drug_units,
                "charge": used_charge,
                "ndc_line": f"N4{ndc_digits} UN{vial_count}" if ndc_digits else None,
            }
        )
        if modifier == "JW" and waste_units:
            lines.append(
                {
                    "code": code["code"],
                    "modifiers": ["JW"],
                    "units": waste_units,
                    "charge": _money(vials_cost - used_charge) if used_charge is not None else None,
                    "ndc_line": f"N4{ndc_digits} UN{vial_count}" if ndc_digits else None,
                }
            )
    for admin_line in (admin or {}).get("admin_code_lines", []):
        fee = DEMO_ADMIN_FEES.get(admin_line["code"])
        lines.append(
            {
                "code": admin_line["code"],
                "modifiers": [],
                "units": admin_line["units"],
                "charge": _money(fee * admin_line["units"]) if fee is not None else None,
                "ndc_line": None,
            }
        )
    for number, line in enumerate(lines, start=1):
        line.update(
            {
                "line": number,
                "date_of_service": dos,
                "place_of_service": "11",
                "diagnosis_pointer": "A",
                "rendering_npi": practice["npi"],
            }
        )
    charges = [line["charge"] for line in lines]

    signed_on = (treatment.get("signed_at") or "")[:10]
    return {
        "treatment_id": treatment["id"],
        "date_of_service": dos,
        "patient": {
            "name": patient_name(patient),
            "dob": patient.get("date_of_birth"),
            "sex": patient.get("sex"),
            "address": patient.get("address"),
            "member_id": patient.get("member_id"),
            "insurance": payer,
            "insurance_type": "Medicare" if (payer or "").lower() == "medicare" else "Group Health Plan",
        },
        "drug": {
            "brand_name": brand,
            "code": code["code"] if code else None,
            "code_type": code["type"] if code else None,
            "code_kind": code_kind_label(code) if code else None,
            "units": drug_units,
            "jw_jz": modifier,
            "waste_mg": waste,
            "waste_units": waste_units,
            "ndc_11": ndc_11,
            "lot": lot,
        },
        "code_note": _code_note(drug.get("codes") or [], payer, dos, code),
        "resubmission": (
            {"code": "7", "original_code": replaces.get("billing_code"), "original_exported_at": replaces.get("exported_at")}
            if replaces
            else None
        ),
        "item19": item19_text,
        "admin_codes": (admin or {}).get("admin_codes", []),
        "diagnosis_code": diagnosis_code or None,
        "prior_auth_number": auth_number,
        "provider_npi": practice["npi"],
        "billing_provider": practice["name"],
        "federal_tax_id": DEMO_TAX_ID,
        "physician_signature": f"{practice['name']} · {signed_on}" if signed_on else None,
        "service_lines": lines,
        "total_charge": _money(sum(charges)) if charges and None not in charges else None,
        "checks": checks,
        "all_passed": all(c["passed"] for c in checks),
    }


def refresh_claim(treatment_id: int) -> Optional[dict]:
    """Rebuild and store the claim for an administered, not-yet-exported
    treatment; returns the claim view (the stored one once exported)."""
    treatment, practice_drug, patient, drug = fetch_treatment_bundle(treatment_id)
    if treatment["status"] in ("exported", "needs_recoding"):
        return {**treatment["claim"], "checks": treatment["claim_checks"], "status": treatment["status"]}
    if not treatment.get("date_of_service"):
        return None

    practice = (
        supabase.table("practices").select("*").eq("id", practice_drug["practice_id"]).execute().data[0]
    )
    auth_task = fetch_treatment_task(treatment_id, "prior_auth")
    auth_number = ((auth_task or {}).get("inputs") or {}).get("auth_number")

    versions = treatment.get("claim_versions") or []
    replaces = versions[-1] if versions else None
    claim = build_claim(treatment, practice_drug, patient, drug, practice, auth_number, replaces)
    checks = claim.pop("checks")
    supabase.table("treatments").update(
        {
            "claim": claim,
            "claim_checks": checks,
            "billing_code": claim["drug"]["code"],
            "status": "claim_ready",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", treatment_id).execute()
    return {**claim, "checks": checks, "status": "claim_ready"}


@router.get("/api/treatments/{treatment_id}/claim")
def get_claim(treatment_id: int):
    claim = refresh_claim(treatment_id)
    if claim is None:
        raise HTTPException(status_code=409, detail="No claim yet: the infusion hasn't been recorded")
    return claim


@router.post("/api/treatments/{treatment_id}/export")
def export_claim(treatment_id: int):
    """"Export for clearinghouse": freezes the claim once all 8 checks pass.
    Exporting again (the page's "print again") returns the frozen claim."""
    claim = refresh_claim(treatment_id)
    if claim is None:
        raise HTTPException(status_code=409, detail="No claim yet: the infusion hasn't been recorded")
    if claim["status"] == "exported":
        return claim
    if claim["status"] == "needs_recoding":
        raise HTTPException(
            status_code=409, detail="This claim used an outdated code: build the corrected claim first"
        )
    failing = [c["label"] for c in claim["checks"] if not c["passed"]]
    if failing:
        raise HTTPException(status_code=409, detail=f"Fix before exporting: {'; '.join(failing)}")

    now = datetime.now(timezone.utc).isoformat()
    stored = {k: v for k, v in claim.items() if k not in ("checks", "status")}
    stored["exported_at"] = now
    supabase.table("treatments").update(
        {"claim": stored, "status": "exported", "updated_at": now}
    ).eq("id", treatment_id).execute()
    complete_task(fetch_treatment_task(treatment_id, "claim_review"))
    if stored.get("resubmission"):
        _complete_recode_task_if_done(treatment_id)
    return {**stored, "checks": claim["checks"], "status": "exported"}


@router.post("/api/treatments/{treatment_id}/recode")
def recode_claim(treatment_id: int):
    """"Build corrected claim" for an exported claim that used an outdated code
    (Switch flags these as needs_recoding). The exported version is kept in
    `claim_versions`; the claim is rebuilt with the code in effect on the date
    of service and marked as a replacement (Box 22, resubmission code 7), then
    goes back through the 8 checks and Export like any claim."""
    treatment, _practice_drug, _patient, _drug = fetch_treatment_bundle(treatment_id)
    if treatment["status"] != "needs_recoding":
        raise HTTPException(status_code=409, detail="Only claims flagged for recoding can be corrected")

    now = datetime.now(timezone.utc).isoformat()
    replaced = {
        **(treatment.get("claim") or {}),
        "claim_checks": treatment.get("claim_checks"),
        "billing_code": treatment.get("billing_code"),
        "replaced_at": now,
    }
    supabase.table("treatments").update(
        {
            "claim_versions": (treatment.get("claim_versions") or []) + [replaced],
            "status": "administered",  # so refresh_claim rebuilds instead of returning the frozen claim
            "updated_at": now,
        }
    ).eq("id", treatment_id).execute()
    return refresh_claim(treatment_id)


def _complete_recode_task_if_done(treatment_id: int) -> None:
    """Close the workspace's "code change" card once none of its flagged claims
    are still waiting to be corrected."""
    practice_drug_id = (
        supabase.table("treatments").select("practice_drug_id").eq("id", treatment_id).execute().data[0][
            "practice_drug_id"
        ]
    )
    still_flagged = (
        supabase.table("treatments")
        .select("id")
        .eq("practice_drug_id", practice_drug_id)
        .eq("status", "needs_recoding")
        .execute()
        .data
    )
    if still_flagged:
        return
    for task in (
        supabase.table("tasks")
        .select("*")
        .eq("practice_drug_id", practice_drug_id)
        .eq("kind", "recode_claims")
        .execute()
        .data
        or []
    ):
        if (task.get("inputs") or {}).get("affected_treatment_ids"):
            complete_task(task)
