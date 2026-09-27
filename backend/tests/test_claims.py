"""Claim builder tests: the demo drug (Pasatru) and demo patients, no database.

Fixed example data, independent of the live demo: 100 mg vials and J0289 as
a stand-in permanent code (the demo now uses Pasatru's real 300 mg vials; see
scripts/reset_demo.py and scripts/seed_patients.py).
"""

import copy

import pytest

from treat_and_bill.claims import build_claim

NDC_11 = "61755-0012-01"
LOT = "PSA24091"

PASATRU = {
    "application_id": "BLA761508",
    "brand_name": "Pasatru",
    "route_of_administration": "INTRAVENOUS",
    "is_single_dose_vial": True,
    "is_antineoplastic": False,
    "approved_uses_and_conditions": [
        {"approved_diagnosis": "Fibrodysplasia ossificans progressiva (FOP) in adults"}
    ],
    "codes": [
        {"code": "J3590", "type": "generic", "from": "2026-02-01", "to": "2026-09-30"},
        {"code": "J0289", "type": "permanent", "unit": "1 MG", "from": "2026-10-01"},
    ],
    "payer_policies": [
        {"payer": "Medicare", "covered": True, "prior_auth": False},
        {
            "payer": "BCBS",
            "covered": True,
            "prior_auth": True,
            "documentation_requirements": ["Genetic confirmation of an ACVR1 mutation (e.g. R206H)"],
        },
        {"payer": "Aetna", "covered": None, "prior_auth": None},
    ],
}

PRACTICE = {"id": 1, "npi": "1234567893", "name": "Patel Oncology"}

WORKSPACE = {
    "id": 10,
    "practice_id": 1,
    "application_id": "BLA761508",
    "invoices": [
        {
            "distributor": "ASD Healthcare",
            "lines": [{"ndc_11": NDC_11, "lot": LOT, "quantity": 10, "cost_per_vial": 1850.00}],
        }
    ],
}

MARIA = {
    "id": 101,
    "first_name": "Maria",
    "last_name": "Lopez",
    "date_of_birth": "1992-03-14",
    "sex": "F",
    "address": {"street": "418 Ponce De Leon Ave NE", "city": "Atlanta", "state": "GA", "zip": "30308"},
    "payer": "Medicare",
    "member_id": "1EG4-TE5-MK72",
    "diagnosis": "M61.10 Fibrodysplasia ossificans progressiva",
}

ALL_PASSED_DOC_CHECK = {
    "items": [
        {"id": "diagnosis", "requirement": "Diagnosis: FOP", "passed": True, "quote": "FOP"},
        {"id": "weight", "requirement": "Current weight documented", "passed": True, "quote": "68 kg"},
    ]
}


def treatment(dose_given=680, waste=20, vials=7, date_of_service="2026-09-28",
              start="09:00", stop="10:00", lot=LOT, doc_check=ALL_PASSED_DOC_CHECK):
    """Maria's dose: 68 kg x 10 mg/kg = 680 mg from 7 x 100 mg vials, 20 mg wasted."""
    return {
        "id": 501,
        "status": "administered",
        "ordered_dose": dose_given,
        "dose_unit": "mg",
        "dose_given": dose_given,
        "waste_amount": waste,
        "vial_mix": [{"ndc_11": NDC_11, "strength": 100, "count": vials}],
        "vials_used": [{"ndc_11": NDC_11, "lot": lot, "quantity": vials}],
        "date_of_service": date_of_service,
        "infusion_start": f"{date_of_service}T{start}:00" if start else None,
        "infusion_stop": f"{date_of_service}T{stop}:00" if stop else None,
        "documentation_check": doc_check,
        "signed_note": "FOP, ACVR1 R206H confirmed. Weight 68 kg.",
        "signed_at": "2026-09-27T15:00:00+00:00",
    }


def claim_for(t=None, patient=MARIA, workspace=WORKSPACE, auth_number=None):
    return build_claim(t or treatment(), workspace, patient, PASATRU, PRACTICE, auth_number)


def check(claim, check_id):
    return next(c for c in claim["checks"] if c["id"] == check_id)


# --- Maria, Medicare, dose given before Oct 1: the main demo claim ----------

def test_maria_before_switch_uses_generic_code_with_jw_waste_line():
    claim = claim_for()
    assert claim["all_passed"], [c for c in claim["checks"] if not c["passed"]]
    assert claim["drug"]["code"] == "J3590" and claim["drug"]["code_type"] == "generic"

    drug_line, waste_line, admin_line = claim["service_lines"]
    assert drug_line["code"] == "J3590" and drug_line["units"] == 1 and drug_line["modifiers"] == []
    assert waste_line["code"] == "J3590" and waste_line["modifiers"] == ["JW"] and waste_line["units"] == 1
    assert admin_line["code"] == "96365" and admin_line["units"] == 1
    assert drug_line["ndc_line"] == "N461755001201 UN7"


def test_maria_item19_has_name_dose_route_ndc_and_invoice_cost():
    claim = claim_for()
    assert claim["item19"] == "Pasatru 680mg IV NDC 61755001201 $12950.00"  # 7 vials x $1,850
    assert len(claim["item19"]) <= 80


def test_maria_charges_split_between_dose_used_and_waste():
    claim = claim_for()
    drug_line, waste_line, admin_line = claim["service_lines"]
    assert drug_line["charge"] == 12580.00   # 12,950 x 680/700
    assert waste_line["charge"] == 370.00    # the 20 mg thrown away
    assert admin_line["charge"] == 150.00    # demo fee for 96365
    assert claim["total_charge"] == 13100.00


# --- Switch Day: the same dose given on/after Oct 1 --------------------------

def test_dose_on_or_after_oct_1_switches_to_permanent_code_and_real_units():
    claim = claim_for(treatment(date_of_service="2026-10-02"))
    assert claim["all_passed"]
    assert claim["drug"]["code"] == "J0289" and claim["drug"]["code_type"] == "permanent"
    drug_line, waste_line, _ = claim["service_lines"]
    assert drug_line["units"] == 680          # 680 mg / "1 MG"
    assert waste_line["units"] == 20 and waste_line["modifiers"] == ["JW"]
    assert claim["item19"] is None            # only generic codes need Item 19
    assert check(claim, "item19")["passed"]


def test_last_day_of_generic_code_still_bills_generic():
    assert claim_for(treatment(date_of_service="2026-09-30"))["drug"]["code"] == "J3590"


# --- Aisha, Aetna: 700 mg uses exactly 7 vials, nothing wasted ---------------

def test_no_waste_puts_jz_on_the_drug_line_and_no_jw_line():
    aisha = {**MARIA, "id": 103, "first_name": "Aisha", "payer": "Aetna"}
    claim = claim_for(treatment(dose_given=700, waste=0), patient=aisha)
    codes = [(line["code"], line["modifiers"]) for line in claim["service_lines"]]
    assert codes == [("J3590", ["JZ"]), ("96365", [])]


# --- James, BCBS: prior authorization required ------------------------------

JAMES = {**MARIA, "id": 102, "first_name": "James", "last_name": "Carter", "payer": "BCBS"}


def test_bcbs_claim_fails_attachments_check_without_prior_auth_number():
    claim = claim_for(patient=JAMES, auth_number=None)
    attachments = check(claim, "attachments")
    assert not attachments["passed"]
    assert "BCBS prior authorization number" in attachments["message"]
    assert not claim["all_passed"]


def test_bcbs_claim_passes_and_carries_the_auth_number_once_entered():
    claim = claim_for(patient=JAMES, auth_number="PA-778812")
    assert check(claim, "attachments")["passed"]
    assert claim["prior_auth_number"] == "PA-778812"


# --- Problems the checks should catch ---------------------------------------

def test_missing_invoice_fails_item19_ndc_and_attachments():
    no_invoice = {**WORKSPACE, "invoices": []}
    claim = claim_for(workspace=no_invoice)
    failed = {c["id"] for c in claim["checks"] if not c["passed"]}
    assert failed == {"item19", "ndc", "attachments"}
    assert claim["total_charge"] is None


def test_lot_not_on_the_invoice_fails_the_ndc_check():
    claim = claim_for(treatment(lot="OTHER-LOT"))
    assert not check(claim, "ndc")["passed"]


def test_documentation_gap_from_signing_fails_the_documentation_check():
    gap = {"items": [
        {"id": "diagnosis", "requirement": "Diagnosis: FOP", "passed": True, "quote": "FOP"},
        {"id": "payer_1", "requirement": "Genetic confirmation of an ACVR1 mutation", "passed": False},
    ]}
    documentation = check(claim_for(treatment(doc_check=gap)), "documentation")
    assert not documentation["passed"]
    assert "ACVR1" in documentation["message"]


def test_diagnosis_that_is_not_an_approved_use_fails():
    wrong = {**MARIA, "diagnosis": "C34.90 Lung cancer"}
    assert not check(claim_for(patient=wrong), "diagnosis")["passed"]


def test_missing_infusion_times_fail_the_admin_code_check():
    claim = claim_for(treatment(start=None, stop=None))
    assert not check(claim, "admin_code")["passed"]


def test_waste_of_a_whole_vial_or_more_is_flagged():
    claim = claim_for(treatment(dose_given=600, waste=100))
    assert not check(claim, "waste_modifier")["passed"]


@pytest.mark.parametrize(
    "stop, expected",
    [("09:10", ["96374"]), ("10:00", ["96365"]), ("10:35", ["96365", "96366"])],
)
def test_infusion_length_picks_the_administration_codes(stop, expected):
    claim = claim_for(treatment(start="09:00", stop=stop))
    assert [line["code"] for line in claim["service_lines"] if line["code"].startswith("963")] == expected


def test_build_claim_does_not_change_its_inputs():
    t, ws = treatment(), copy.deepcopy(WORKSPACE)
    before = (copy.deepcopy(t), copy.deepcopy(ws))
    build_claim(t, ws, MARIA, PASATRU, PRACTICE, None)
    assert (t, ws) == before


# --- Switch: how a claim explains and handles a code change ------------------

def test_code_note_explains_a_dose_given_before_the_switch():
    note = claim_for(treatment(date_of_service="2026-09-28"))["code_note"]
    assert note.startswith("Given Sep 28, 2026, before J0289 takes effect Oct 1, 2026: billed as generic J3590")


def test_code_note_explains_a_dose_given_after_the_switch():
    claim = claim_for(treatment(date_of_service="2026-10-02"))
    assert claim["drug"]["code_kind"] == "permanent"
    assert "on or after J0289 took effect Oct 1, 2026 (replacing generic J3590)" in claim["code_note"]


def test_permanent_code_claim_passes_without_an_invoice():
    no_invoice = {**WORKSPACE, "invoices": []}
    claim = claim_for(treatment(date_of_service="2026-10-02"), workspace=no_invoice)
    assert check(claim, "ndc")["passed"] and check(claim, "attachments")["passed"]
    assert check(claim, "item19")["passed"]


def test_generic_code_claim_still_needs_the_invoice():
    no_invoice = {**WORKSPACE, "invoices": []}
    claim = claim_for(treatment(date_of_service="2026-09-28"), workspace=no_invoice)
    assert not check(claim, "attachments")["passed"] and "invoice" in check(claim, "attachments")["message"]


def test_corrected_claim_carries_resubmission_code_7():
    original = {"billing_code": "J3590", "exported_at": "2026-10-03T12:00:00+00:00"}
    claim = build_claim(treatment(date_of_service="2026-10-02"), WORKSPACE, MARIA, PASATRU, PRACTICE, None, original)
    assert claim["resubmission"] == {
        "code": "7", "original_code": "J3590", "original_exported_at": "2026-10-03T12:00:00+00:00",
    }
    assert claim["drug"]["code"] == "J0289"
    assert claim_for()["resubmission"] is None
