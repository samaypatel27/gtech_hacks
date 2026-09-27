"""Consider stage, no database: the coverage and payment-timing lights, the
drug maker's launch details, and reading vial strengths from openFDA."""

from datetime import date

import pytest

from billing_rules import is_single_dose_package, vial_strength_mg
from consider.lights import _coverage_light, _payment_timing_light
from drug_engine.drugs import LaunchDetails, launch_columns

PACKAGE = "1 VIAL, SINGLE-DOSE in 1 CARTON (61755-012-01) / 5 mL in 1 VIAL, SINGLE-DOSE (61755-012-00)"
CODES = [
    {"code": "J3590", "type": "generic", "from": "2026-02-01", "to": "2026-09-30"},
    {"code": "J0289", "type": "permanent", "unit": "1 MG", "from": "2026-10-01"},
]
POLICIES = [
    {"payer": "Medicare", "covered": True, "prior_auth": False, "notes": "Covered per LCD."},
    {"payer": "BCBS", "covered": True, "prior_auth": True},
    {"payer": "Aetna", "covered": None, "prior_auth": None},
    {"payer": "Cigna", "covered": False},
]
DRUG = {
    "typical_adult_dose": {"amount": 10, "unit": "mg/kg"},
    "codes": CODES,
    "payer_policies": POLICIES,
    "ndcs": [
        {"ndc_11": "61755-0012-01", "strength_mg": 100, "sample": False, "list_price": 1850},
        {"ndc_11": "61755-0012-99", "strength_mg": 100, "sample": True, "list_price": 1850},
    ],
}


@pytest.fixture
def before_the_switch(monkeypatch):
    monkeypatch.setenv("DEMO_TODAY", "2026-09-27")


@pytest.fixture
def after_the_switch(monkeypatch):
    monkeypatch.setenv("DEMO_TODAY", "2026-10-02")


# --- Reading vial strengths ------------------------------------------------


def test_vial_strength_from_concentration_and_volume():
    assert vial_strength_mg("300 mg/5mL", PACKAGE) == 300
    assert vial_strength_mg("20 mg/mL", PACKAGE) == 100
    assert vial_strength_mg("1 g/10 mL", "10 mL in 1 VIAL") == 1000
    assert vial_strength_mg("500 mcg/mL", PACKAGE) == 2.5


def test_vial_strength_per_vial_powder_and_unreadable():
    assert vial_strength_mg("150 mg/1", "1 VIAL in 1 CARTON") == 150
    assert vial_strength_mg("10 mg/mL", "1 CARTON") is None  # no vial volume
    assert vial_strength_mg("100 units/mL", PACKAGE) is None
    assert vial_strength_mg(None, PACKAGE) is None


def test_single_dose_from_the_package_description():
    assert is_single_dose_package(PACKAGE) is True
    assert is_single_dose_package("10 mL in 1 VIAL, MULTI-DOSE") is False
    assert is_single_dose_package("1 KIT") is None


# --- Coverage light --------------------------------------------------------


def test_coverage_takes_the_worst_insurer():
    light = _coverage_light(DRUG, {"payers": ["Medicare", "BCBS", "Aetna"]})
    assert light["color"] == "yellow"
    assert light["text"] == (
        "Medicare: covered, no prior authorization needed. BCBS: covered with prior authorization. "
        "Aetna: policy under review, so verify coverage before treating."
    )
    assert light["sources"] == ["Medicare policy: Covered per LCD."]
    assert _coverage_light(DRUG, {"payers": ["Medicare"]})["color"] == "green"
    assert _coverage_light(DRUG, {"payers": ["Medicare", "Cigna"]})["color"] == "red"


def test_coverage_never_assumes_an_unknown_insurer_covers_it():
    light = _coverage_light(DRUG, {"payers": ["Humana"]})
    assert light["color"] == "yellow" and "no policy on file" in light["text"]
    assert _coverage_light(DRUG, {"payers": []})["color"] == "gray"


# --- Payment timing light --------------------------------------------------


def test_payment_estimate_from_list_price(before_the_switch):
    light = _payment_timing_light(DRUG, {"planned_patients_per_month": 3})
    assert light["color"] == "yellow"
    # 10 mg/kg × 70 kg = 700 mg = 7 × 100 mg vials at $1,850; 3 a month × ~2 months.
    assert "about $12,950 per dose" in light["text"]
    assert "700 mg for a 70 kg adult: 7 × 100 mg vials at $1,850" in light["text"]
    assert "about $77,700 for the drug before the first payments" in light["text"]
    assert "speed up once J0289 takes effect Oct 1, 2026" in light["text"]
    assert light["sources"] == ["The drug maker's launch list price"]


def test_payment_estimate_asks_for_planned_patients(before_the_switch):
    light = _payment_timing_light(DRUG, {})
    assert "Enter how many patients" in light["text"]


def test_invoice_price_wins_and_own_code_pays_faster(after_the_switch):
    invoice = {"distributor": "ASD Healthcare", "lines": [{"ndc_11": "61755-0012-01", "cost_per_vial": 1700}]}
    light = _payment_timing_light(DRUG, {"invoices": [invoice], "planned_patients_per_month": 1})
    assert light["color"] == "green"
    assert "about $11,900 per dose" in light["text"] and "about a month" in light["text"]
    assert "about $11,900 for the drug" in light["text"]
    assert light["sources"] == ["Your invoice from ASD Healthcare"]


def test_payment_falls_back_to_cost_per_dose_then_gray(before_the_switch):
    no_prices = {**DRUG, "ndcs": [{"ndc_11": "x", "strength_mg": 100}], "cost_per_dose": 5000}
    assert "about $5,000 per dose" in _payment_timing_light(no_prices)["text"]
    assert _payment_timing_light({**no_prices, "cost_per_dose": None})["color"] == "gray"


# --- Launch details --------------------------------------------------------


def test_launch_builds_the_dated_code_list():
    launch = LaunchDetails(
        approval_date=date(2026, 2, 1),
        expected_code={"code": "j0289", "unit": "1 mg", "effective_from": "2026-10-01"},
    )
    assert launch_columns(launch, "J3590", None)["codes"] == CODES


def test_launch_rejects_a_code_before_approval():
    launch = LaunchDetails(
        approval_date=date(2026, 10, 1),
        expected_code={"code": "J0289", "unit": "1 MG", "effective_from": "2026-10-01"},
    )
    with pytest.raises(ValueError):
        launch_columns(launch, "J3590", None)


def test_launch_prices_vials_and_stores_distributors_and_coverage():
    launch = LaunchDetails(
        list_price_per_vial=1850,
        distributors=["ASD Healthcare", " "],
        coverage=[{"payer": "BCBS", "covered": True, "prior_auth": True}],
    )
    ndcs = [{"ndc_11": "a", "sample": False}, {"ndc_11": "b", "sample": True}]
    columns = launch_columns(launch, "J3590", ndcs)
    assert columns["ndcs"] == [{"ndc_11": "a", "sample": False, "list_price": 1850}, ndcs[1]]
    assert columns["distributors"] == [{"name": "ASD Healthcare"}]
    assert columns["payer_policies"] == [{"payer": "BCBS", "covered": True, "prior_auth": True}]
    assert "codes" not in columns
