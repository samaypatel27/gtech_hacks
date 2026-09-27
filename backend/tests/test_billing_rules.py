from datetime import date, datetime, timedelta

import pytest

from billing_rules import (
    admin_codes,
    code_for,
    code_kind_label,
    code_timeline,
    dose_for,
    is_generic,
    item19,
    ndc_10_to_11,
    parse_billing_unit,
    pick_generic_code,
    units,
    vial_mix,
    waste_modifier,
)

GENERIC = {"code": "J3490", "type": "generic", "unit": None, "payer": None, "from": "2026-02-03", "to": "2026-09-30"}
PERMANENT = {"code": "J0644", "type": "permanent", "unit": "1 MG", "payer": None, "from": "2026-10-01", "to": None}
# Aetna keeps the generic code for a quarter after Medicare switches.
AETNA_LAG = {"code": "J3490", "type": "generic", "unit": None, "payer": "Aetna", "from": "2026-10-01", "to": "2026-12-31"}
CODES = [GENERIC, PERMANENT, AETNA_LAG]


# --- pick_generic_code ------------------------------------------------------


@pytest.mark.parametrize(
    "is_cancer, application, expected",
    [
        (True, "NDA220837", "J9999"),
        (True, "BLA761258", "J9999"),  # cancer biologic: cancer wins
        (False, "BLA761508", "J3590"),
        (False, "bla761508", "J3590"),
        (False, "NDA217417", "J3490"),
    ],
)
def test_pick_generic_code(is_cancer, application, expected):
    assert pick_generic_code(is_cancer, application) == expected


# --- ndc_10_to_11 -----------------------------------------------------------


@pytest.mark.parametrize(
    "ndc, expected",
    [
        ("1234-5678-90", "01234-5678-90"),  # 4-4-2
        ("12345-678-90", "12345-0678-90"),  # 5-3-2
        ("12345-6789-0", "12345-6789-00"),  # 5-4-1
        ("70842-0240-01", "70842-0240-01"),  # already 5-4-2
    ],
)
def test_ndc_10_to_11(ndc, expected):
    assert ndc_10_to_11(ndc) == expected


@pytest.mark.parametrize("ndc", ["1234567890", "123-4567-890", "12345-67a9-0", "12345-6789"])
def test_ndc_10_to_11_rejects_bad_input(ndc):
    with pytest.raises(ValueError):
        ndc_10_to_11(ndc)


# --- code_for ---------------------------------------------------------------


@pytest.mark.parametrize(
    "dos, expected",
    [
        ("2026-09-30", "J3490"),  # day before the switch
        ("2026-10-01", "J0644"),  # switch day
        ("2026-10-02", "J0644"),
        ("2030-01-01", "J0644"),  # open-ended
    ],
)
def test_code_for_switches_on_date_of_service(dos, expected):
    assert code_for(CODES, "Medicare", dos)["code"] == expected


def test_code_for_payer_specific_entry_wins():
    assert code_for(CODES, "Aetna", "2026-11-15")["code"] == "J3490"
    assert code_for(CODES, "aetna", "2026-11-15")["code"] == "J3490"
    assert code_for(CODES, "Aetna", "2027-01-01")["code"] == "J0644"


def test_code_for_accepts_date_objects():
    assert code_for(CODES, None, date(2026, 10, 1))["code"] == "J0644"
    assert code_for(CODES, None, datetime(2026, 9, 30, 14, 0))["code"] == "J3490"


def test_code_for_before_approval_is_none():
    assert code_for(CODES, "Medicare", "2026-01-01") is None


def test_code_for_billing_unit_change_is_a_new_entry():
    codes = [
        {**PERMANENT, "to": "2027-03-31"},
        {**PERMANENT, "unit": "5 MG", "from": "2027-04-01"},
    ]
    assert code_for(codes, None, "2027-03-31")["unit"] == "1 MG"
    assert code_for(codes, None, "2027-04-01")["unit"] == "5 MG"


def test_code_for_rejects_overlapping_entries():
    with pytest.raises(ValueError):
        code_for([GENERIC, {**PERMANENT, "from": "2026-09-01"}], None, "2026-09-15")


# --- parse_billing_unit / units ---------------------------------------------


@pytest.mark.parametrize(
    "text, expected",
    [
        ("1 MG", (1, "mg")),
        ("per 0.1 mcg", (0.1, "mcg")),
        ("1,000 UNITS", (1000, "units")),
        ("Per Therapeutic Dose", None),
    ],
)
def test_parse_billing_unit(text, expected):
    parsed = parse_billing_unit(text)
    assert (parsed if parsed is None else (float(parsed[0]), parsed[1])) == expected


def test_units_generic_code_is_always_one():
    assert units(500, "mg", GENERIC) == 1


def test_units_permanent_code_divides_by_billing_unit():
    assert units(500, "mg", PERMANENT) == 500
    assert units(500, "mg", {**PERMANENT, "unit": "10 MG"}) == 50


def test_units_round_up_between_units():
    assert units(502, "mg", {**PERMANENT, "unit": "5 MG"}) == 101


def test_units_no_float_error_on_exact_multiples():
    # 0.3 / 0.1 is 2.9999999999999996 in floats
    assert units(0.3, "mg", {**PERMANENT, "unit": "0.1 MG"}) == 3


def test_units_converts_mass_units():
    assert units(1, "mg", {**PERMANENT, "unit": "10 MCG"}) == 100


def test_units_per_dose_code():
    assert units(500, "mg", {**PERMANENT, "unit": "Per Therapeutic Dose"}) == 1


def test_units_rejects_incompatible_units():
    with pytest.raises(ValueError):
        units(5, "mL", PERMANENT)


def test_units_rejects_non_positive_dose():
    with pytest.raises(ValueError):
        units(0, "mg", PERMANENT)


# --- dose_for ---------------------------------------------------------------


def test_dose_for_fixed_dose_passes_through():
    assert dose_for(200, "mg") == (200, "mg")


def test_dose_for_weight_based():
    assert dose_for(5, "mg/kg", weight_kg=70) == (350, "mg")


def test_dose_for_bsa_based():
    assert dose_for(400, "mg/m2", bsa_m2=1.7) == (680, "mg")
    assert dose_for(400, "mg/m²", bsa_m2=1.7) == (680, "mg")


def test_dose_for_needs_the_right_measurement():
    with pytest.raises(ValueError):
        dose_for(5, "mg/kg", bsa_m2=1.7)


# --- vial_mix ---------------------------------------------------------------


def test_vial_mix_spec_example():
    # ProductSpec2 purchasing card: 500 mg → 1 × 300 mg + 2 × 100 mg, no waste
    assert vial_mix(500, [100, 300]) == {"vials": {300: 1, 100: 2}, "total": 500, "waste": 0}


def test_vial_mix_least_waste_beats_fewest_vials():
    # 1 × 400 is one vial but wastes 100; 3 × 100 wastes none
    assert vial_mix(300, [400, 100])["vials"] == {100: 3}


def test_vial_mix_tie_goes_to_fewer_vials():
    assert vial_mix(400, [100, 200, 400])["vials"] == {400: 1}


def test_vial_mix_unavoidable_waste():
    assert vial_mix(250, [100]) == {"vials": {100: 3}, "total": 300, "waste": 50}


def test_vial_mix_decimal_sizes():
    assert vial_mix(1.2, [0.5, 1]) == {"vials": {1: 1, 0.5: 1}, "total": 1.5, "waste": 0.3}


@pytest.mark.parametrize("dose, sizes", [(0, [100]), (500, []), (500, [0, 100])])
def test_vial_mix_rejects_bad_input(dose, sizes):
    with pytest.raises(ValueError):
        vial_mix(dose, sizes)


# --- waste_modifier ---------------------------------------------------------


@pytest.mark.parametrize(
    "single_dose, waste, expected",
    [(True, 100, "JW"), (True, 0, "JZ"), (False, 100, None), (None, 0, None)],
)
def test_waste_modifier(single_dose, waste, expected):
    assert waste_modifier(single_dose, waste) == expected


def test_waste_modifier_rejects_negative_waste():
    with pytest.raises(ValueError):
        waste_modifier(True, -1)


# --- admin_codes ------------------------------------------------------------

START = datetime(2026, 10, 1, 9, 0)


@pytest.mark.parametrize(
    "minutes, is_chemo, expected",
    [
        (15, True, [("96409", 1)]),  # exactly 15 min is still a push
        (16, True, [("96413", 1)]),
        (60, True, [("96413", 1)]),
        (90, True, [("96413", 1)]),  # 30 min into hour 2: not yet billable
        (91, True, [("96413", 1), ("96415", 1)]),
        (150, True, [("96413", 1), ("96415", 1)]),
        (151, True, [("96413", 1), ("96415", 2)]),
        (10, False, [("96374", 1)]),
        (60, False, [("96365", 1)]),
        (120, False, [("96365", 1), ("96366", 1)]),
    ],
)
def test_admin_codes(minutes, is_chemo, expected):
    assert admin_codes(START, START + timedelta(minutes=minutes), is_chemo) == expected


def test_admin_codes_rejects_stop_before_start():
    with pytest.raises(ValueError):
        admin_codes(START, START - timedelta(minutes=5), True)


# --- item19 -----------------------------------------------------------------


def test_item19_spec_example():
    text, fits = item19("DrugX", 500, "MG", "INTRAVENOUS", "12345-0678-90", 4500)
    assert text == "DrugX 500mg IV NDC 12345067890 $4500.00"
    assert fits


def test_item19_without_cost():
    assert item19("DrugX", 1.5, "mg", "Subcutaneous", "12345067890")[0] == "DrugX 1.5mg SC NDC 12345067890"


def test_item19_length_limit_boundary():
    # Everything but the brand is " 500mg IV NDC 12345067890" (25 chars)
    at_limit, fits = item19("X" * 55, 500, "mg", "IV", "12345-0678-90")
    assert len(at_limit) == 80 and fits
    over, fits = item19("X" * 56, 500, "mg", "IV", "12345-0678-90")
    assert len(over) == 81 and not fits


def test_item19_rejects_10_digit_ndc():
    with pytest.raises(ValueError):
        item19("DrugX", 500, "mg", "IV", "12345-678-90")


# --- code_timeline / is_generic (Switch) ------------------------------------


def test_timeline_counts_down_to_the_permanent_code():
    t = code_timeline(CODES, "2026-09-27")
    assert t["current"]["code"] == "J3490" and t["previous"] is None
    assert t["next"]["code"] == "J0644" and t["changes_on"] == date(2026, 10, 1)
    assert t["days_until_next"] == 4


def test_timeline_after_the_switch_remembers_what_it_replaced():
    t = code_timeline(CODES, "2026-10-02")
    assert t["current"]["code"] == "J0644"
    assert t["previous"]["code"] == "J3490" and t["changed_on"] == date(2026, 10, 1)
    assert t["days_since_change"] == 1 and t["next"] is None


def test_timeline_for_a_payer_that_adopts_the_code_a_quarter_later():
    t = code_timeline(CODES, "2026-10-02", payer="Aetna")
    assert t["current"]["code"] == "J3490" and t["previous"] is None  # still generic for Aetna
    assert t["next"]["code"] == "J0644" and t["changes_on"] == date(2027, 1, 1)


def test_timeline_before_approval_has_no_current_code():
    t = code_timeline(CODES, "2026-01-15")
    assert t["current"] is None and t["previous"] is None
    assert t["next"]["code"] == "J3490" and t["changes_on"] == date(2026, 2, 3)


TEMP_TO_TEMP = [
    {"code": "J3590", "type": "generic", "unit": None, "from": "2026-02-01", "to": "2026-06-30"},
    {"code": "Q5999", "type": "temporary", "unit": "10 MG", "from": "2026-07-01", "to": "2026-09-30"},
    {"code": "J0289", "type": "permanent", "unit": "1 MG", "from": "2026-10-01"},
]


def test_timeline_generic_to_temporary_to_permanent():
    t = code_timeline(TEMP_TO_TEMP, "2026-08-15")
    assert t["previous"]["code"] == "J3590" and t["current"]["code"] == "Q5999"
    assert t["next"]["code"] == "J0289" and t["changes_on"] == date(2026, 10, 1)
    assert not is_generic(t["current"]) and code_kind_label(t["current"]) == "temporary product-specific"
    assert units(680, "mg", t["current"]) == 68  # a temporary code still bills by its unit


def test_same_code_with_a_new_billing_unit_counts_as_a_change():
    codes = [
        {"code": "J0289", "type": "permanent", "unit": "1 MG", "from": "2026-10-01", "to": "2026-12-31"},
        {"code": "J0289", "type": "permanent", "unit": "10 MG", "from": "2027-01-01"},
    ]
    t = code_timeline(codes, "2026-11-01")
    assert t["next"]["unit"] == "10 MG" and t["changes_on"] == date(2027, 1, 1)


def test_code_kinds():
    assert is_generic(GENERIC) and not is_generic(PERMANENT)
    assert code_kind_label(GENERIC) == "generic" and code_kind_label(PERMANENT) == "permanent"
