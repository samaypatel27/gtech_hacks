"""Billing rules: the pure logic behind codes, units, NDCs, waste and claim lines.

Everything here takes plain values and returns plain values (no database, HTTP
or Claude calls), so it's tested directly (tests/test_billing_rules.py) and
reused by the drug pipeline, the Considering lights, the claim builder and Switch.

Rules marked "verify" follow our reading of CMS / CPT guidance and should be
checked against the demo Medicare contractor's current pages.
"""

import math
import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

# What a drug bills under until it has its own permanent code (ProductSpec2 §2).
GENERIC_CANCER = "J9999"
GENERIC_BIOLOGIC = "J3590"
GENERIC_OTHER = "J3490"

ITEM19_MAX_LENGTH = 80


def _dec(value) -> Decimal:
    # Via str so 0.1 stays 0.1 instead of its binary float expansion.
    return Decimal(str(value))


def _num(value: Decimal):
    """Decimal → int when whole, else float, for JSON and display."""
    return int(value) if value == value.to_integral_value() else float(value)


def _as_date(value) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(value)


# ---------------------------------------------------------------------------
# Codes
# ---------------------------------------------------------------------------


def pick_generic_code(is_antineoplastic: bool, application_number: str) -> str:
    """Cancer drug → J9999; otherwise biologic (BLA) → J3590; otherwise J3490.

    Cancer is checked first, so a cancer biologic bills as J9999.
    """
    if is_antineoplastic:
        return GENERIC_CANCER
    if application_number.strip().upper().startswith("BLA"):
        return GENERIC_BIOLOGIC
    return GENERIC_OTHER


def code_for(codes: list[dict], payer: Optional[str], date_of_service) -> Optional[dict]:
    """The entry from a drug's `codes` list in effect for this payer on the date
    the drug was given (not the purchase or submission date).

    Each entry is {code, type: generic|permanent, unit, payer, from, to} and
    covers `from` through `to` inclusive; a null `to` means still in effect. An
    entry for this specific payer wins over a general one (`payer` null), so an
    insurer that adopts the permanent code later than Medicare just needs its
    own entry keeping the generic code until then. Returns None when nothing
    covers the date (e.g. before approval).
    """
    dos = _as_date(date_of_service)
    covering = [
        c
        for c in codes
        if _as_date(c["from"]) <= dos and (c.get("to") is None or dos <= _as_date(c["to"]))
    ]

    groups = []
    if payer:
        groups.append([c for c in covering if (c.get("payer") or "").lower() == payer.lower()])
    groups.append([c for c in covering if c.get("payer") is None])

    for group in groups:
        if len(group) > 1:
            found = ", ".join(c["code"] for c in group)
            raise ValueError(f"Overlapping code entries on {dos}: {found}")
        if group:
            return group[0]
    return None


def is_generic(code: dict) -> bool:
    """Generic ("not otherwise classified") codes bill 1 unit and need Item 19 and
    the invoice. Product-specific codes -- temporary (e.g. a Q-code) or permanent
    -- bill dose ÷ their billing unit and need neither."""
    return code["type"] == "generic"


def code_kind_label(code: dict) -> str:
    """How to describe a code on screen: generic / temporary / permanent."""
    return {"generic": "generic", "temporary": "temporary product-specific"}.get(code["type"], "permanent")


def _billing_key(entry: Optional[dict]):
    """What makes two code entries bill differently: the code, its kind, its unit."""
    return (entry["code"], entry["type"], entry.get("unit")) if entry else None


def code_timeline(codes: list[dict], day, payer: Optional[str] = None) -> dict:
    """Where a drug stands on its billing codes on `day`, for notices and lights:

    {"current": entry in effect on `day` (or None),
     "previous": what it billed as before the last change (or None if no change yet),
     "changed_on": date the last change took effect (or None),
     "next": what it will bill as after the next change (or None),
     "changes_on": date the next change takes effect (or None),
     "days_since_change", "days_until_next": whole days (or None)}

    Built on `code_for`, so it follows the same rules: the date decides, and a
    payer-specific entry wins (falling back to the general ones on dates it
    doesn't cover). A "change" is any new code, kind or billing unit -- generic
    to permanent, generic to a temporary Q-code, a temporary code to a
    permanent one, or the same code with a new unit.
    """
    day = _as_date(day)
    relevant = [
        c for c in codes if c.get("payer") is None or (payer and (c.get("payer") or "").lower() == payer.lower())
    ]
    # The only days the effective code can change: an entry starting or ending.
    boundaries = sorted(
        {_as_date(c["from"]) for c in relevant}
        | {_as_date(c["to"]) + timedelta(days=1) for c in relevant if c.get("to")}
    )

    def on(d):
        return code_for(codes, payer, d)

    current = on(day)
    changed_on = previous = None
    for boundary in reversed([b for b in boundaries if b <= day]):
        before = on(boundary - timedelta(days=1))
        if _billing_key(before) != _billing_key(on(boundary)):
            if before is not None:
                changed_on, previous = boundary, before
            break

    changes_on = upcoming = None
    for boundary in (b for b in boundaries if b > day):
        if _billing_key(on(boundary)) != _billing_key(current):
            changes_on, upcoming = boundary, on(boundary)
            break

    return {
        "current": current,
        "previous": previous,
        "changed_on": changed_on,
        "next": upcoming,
        "changes_on": changes_on,
        "days_since_change": (day - changed_on).days if changed_on else None,
        "days_until_next": (changes_on - day).days if changes_on else None,
    }


# ---------------------------------------------------------------------------
# NDCs
# ---------------------------------------------------------------------------

# 10-digit NDC layout → which segment gets the leading zero to become 5-4-2.
_NDC_PAD_SEGMENT = {(4, 4, 2): 0, (5, 3, 2): 1, (5, 4, 1): 2}


def ndc_10_to_11(ndc: str) -> str:
    """'12345-678-90' → '12345-0678-90', the 5-4-2 layout claims require.

    Needs the hyphens: a bare 10-digit NDC doesn't say which segment is short.
    NDCs already in 5-4-2 pass through unchanged.
    """
    segments = ndc.strip().split("-")
    if len(segments) != 3 or not all(s.isdigit() for s in segments):
        raise ValueError(f"Not a hyphenated NDC: {ndc!r}")

    layout = tuple(len(s) for s in segments)
    if layout == (5, 4, 2):
        return "-".join(segments)
    if layout not in _NDC_PAD_SEGMENT:
        raise ValueError(f"Unrecognized NDC layout {layout} for {ndc!r}")

    pad = _NDC_PAD_SEGMENT[layout]
    segments[pad] = "0" + segments[pad]
    return "-".join(segments)


_STRENGTH = re.compile(r"([\d.]+)\s*(mcg|ug|mg|g)\s*/\s*([\d.]*)\s*(ml)?", re.IGNORECASE)
_VIAL_VOLUME = re.compile(r"([\d.]+)\s*mL in 1 VIAL", re.IGNORECASE)


def vial_strength_mg(strength: Optional[str], package_description: Optional[str]) -> Optional[float]:
    """mg of drug in one vial, from openFDA's active-ingredient strength and
    the package description. '20 mg/mL' with '5 mL in 1 VIAL' → 100; '100
    mg/5mL' → 20 mg/mL, so 100 in a 5 mL vial; '150 mg/1' (a powder, per
    vial) → 150. None when it can't be read (fill it in by hand)."""
    match = _STRENGTH.fullmatch((strength or "").strip())
    if not match:
        return None
    amount = _dec(match.group(1)) * _MG_PER_UNIT[match.group(2).lower()]
    if not match.group(4):  # "150 mg/1": per vial (a powder), not per mL
        return _num(amount) if match.group(3) == "1" else None

    volumes = _VIAL_VOLUME.findall(package_description or "")
    if not volumes:
        return None
    per_ml = amount / _dec(match.group(3) or 1)
    return _num(per_ml * _dec(volumes[-1]))


def is_single_dose_package(package_description: Optional[str]) -> Optional[bool]:
    """True for 'VIAL, SINGLE-DOSE' / 'SINGLE-USE' packages, False for
    multi-dose ones, None when the description doesn't say."""
    text = (package_description or "").upper()
    if "SINGLE-DOSE" in text or "SINGLE-USE" in text:
        return True
    if "MULTI-DOSE" in text:
        return False
    return None


# ---------------------------------------------------------------------------
# Doses and units
# ---------------------------------------------------------------------------

# Mass units, in mg. Anything else (mL, international units) must match exactly.
_MG_PER_UNIT = {"mcg": Decimal("0.001"), "ug": Decimal("0.001"), "mg": Decimal(1), "g": Decimal(1000)}


def _convert(amount: Decimal, from_unit: str, to_unit: str) -> Decimal:
    from_unit, to_unit = from_unit.lower(), to_unit.lower()
    if from_unit == to_unit:
        return amount
    if from_unit in _MG_PER_UNIT and to_unit in _MG_PER_UNIT:
        return amount * _MG_PER_UNIT[from_unit] / _MG_PER_UNIT[to_unit]
    raise ValueError(f"Can't convert {from_unit} to {to_unit}")


def parse_billing_unit(billing_unit: str) -> Optional[tuple[Decimal, str]]:
    """'1 MG' → (1, 'mg'); 'per 0.1 mcg' → (0.1, 'mcg'). None for units with no
    quantity, such as 'Per Therapeutic Dose'."""
    match = re.fullmatch(r"(?:per\s+)?([\d.,]+)\s*([a-z]+)", billing_unit.strip(), re.IGNORECASE)
    if not match:
        return None
    return _dec(match.group(1).replace(",", "")), match.group(2).lower()


def dose_for(amount: float, unit: str, weight_kg: Optional[float] = None, bsa_m2: Optional[float] = None):
    """Label dose → an absolute dose, as (amount, unit).

    '5 mg/kg' is multiplied by weight and '400 mg/m2' by body surface area;
    fixed doses like '200 mg' pass through.
    """
    match = re.fullmatch(r"([a-z]+)\s*/\s*(kg|m2|m²)", unit.strip(), re.IGNORECASE)
    if not match:
        return _num(_dec(amount)), unit

    base, per = match.group(1), match.group(2).lower()
    factor = weight_kg if per == "kg" else bsa_m2
    if factor is None:
        needed = "weight_kg" if per == "kg" else "bsa_m2"
        raise ValueError(f"A {unit} dose needs {needed}")
    return _num(_dec(amount) * _dec(factor)), base


def units(dose: float, dose_unit: str, code: dict) -> int:
    """Billing units for one claim line (the drug line, or its JW waste line).

    Generic code → 1: Medicare prices these by hand from Item 19 and the invoice.
    Permanent code → dose ÷ the code's billing unit (500 mg at "1 MG" = 500),
    rounded up when the dose falls between units (verify). A per-dose code → 1.
    """
    if dose <= 0:
        raise ValueError(f"Dose must be positive, got {dose}")
    if code["type"] == "generic":
        return 1

    parsed = parse_billing_unit(code["unit"])
    if parsed is None:
        if re.search(r"\bdose\b", code["unit"], re.IGNORECASE):
            return 1
        raise ValueError(f"Can't read billing unit {code['unit']!r} for {code['code']}")

    quantity, unit = parsed
    return math.ceil(_convert(_dec(dose), dose_unit, unit) / quantity)


# ---------------------------------------------------------------------------
# Vials and waste
# ---------------------------------------------------------------------------


def vial_mix(dose: float, vial_sizes: list[float]) -> dict:
    """Least-waste vial combination for one dose; ties go to fewer vials.

    Sizes and dose share a unit (e.g. mg). Returns
    {"vials": {size: count}, "total": ..., "waste": ...}, largest vial first.
    """
    if dose <= 0:
        raise ValueError(f"Dose must be positive, got {dose}")
    sizes = sorted({_dec(s).normalize() for s in vial_sizes}, reverse=True)
    if not sizes or sizes[-1] <= 0:
        raise ValueError(f"Need at least one positive vial size, got {vial_sizes}")

    # Search in whole numbers so the totals are exact: scale by the most
    # decimal places in any size or the dose.
    dose_dec = _dec(dose).normalize()
    places = max(max(-d.as_tuple().exponent, 0) for d in [*sizes, dose_dec])
    scale = 10**places
    target = int(dose_dec * scale)
    int_sizes = [int(s * scale) for s in sizes]

    # A least-waste mix never overshoots by a whole vial, so this is far enough.
    limit = target + int_sizes[0]
    fewest = [None] * (limit + 1)  # fewest vials that make exactly this total
    last_vial = [None] * (limit + 1)
    fewest[0] = 0
    for total in range(1, limit + 1):
        for i, size in enumerate(int_sizes):
            if size <= total and fewest[total - size] is not None:
                count = fewest[total - size] + 1
                if fewest[total] is None or count < fewest[total]:
                    fewest[total], last_vial[total] = count, i

    best = next(t for t in range(target, limit + 1) if fewest[t] is not None)
    counts = [0] * len(sizes)
    t = best
    while t:
        counts[last_vial[t]] += 1
        t -= int_sizes[last_vial[t]]

    total = _dec(best) / scale
    return {
        "vials": {_num(s): n for s, n in zip(sizes, counts) if n},
        "total": _num(total),
        "waste": _num(total - dose_dec),
    }


def waste_modifier(is_single_dose_vial: Optional[bool], waste: float) -> Optional[str]:
    """JW on the line billing discarded drug from a single-dose vial; JZ when a
    single-dose vial had nothing discarded. Multi-dose vials, and drugs not
    supplied in vials (label extraction returns null), take neither."""
    if waste < 0:
        raise ValueError(f"Waste can't be negative, got {waste}")
    if not is_single_dose_vial:
        return None
    return "JW" if waste > 0 else "JZ"


# ---------------------------------------------------------------------------
# Administration
# ---------------------------------------------------------------------------

# (push, first infusion hour, each additional hour)
_ADMIN_CODES = {True: ("96409", "96413", "96415"), False: ("96374", "96365", "96366")}


def admin_codes(start: datetime, stop: datetime, is_chemo: bool) -> list[tuple[str, int]]:
    """Administration lines as (CPT code, units) from the infusion times.

    15 minutes or less counts as a push. Longer is an infusion: the initial
    code covers the first hour, and each additional hour is billed once more
    than 30 minutes of it has passed (verify against current CPT guidance).
    """
    duration = stop - start
    if duration <= timedelta(0):
        raise ValueError("Stop time must be after start time")

    push, first_hour, additional_hour = _ADMIN_CODES[is_chemo]
    if duration <= timedelta(minutes=15):
        return [(push, 1)]

    extra_hours = 0
    remaining = duration - timedelta(hours=1)
    while remaining > timedelta(minutes=30):
        extra_hours += 1
        remaining -= timedelta(hours=1)

    lines = [(first_hour, 1)]
    if extra_hours:
        lines.append((additional_hour, extra_hours))
    return lines


# ---------------------------------------------------------------------------
# Claim text
# ---------------------------------------------------------------------------

_ROUTE_ABBREVIATIONS = {
    "INTRAVENOUS": "IV",
    "SUBCUTANEOUS": "SC",
    "INTRAMUSCULAR": "IM",
    "INTRAVITREAL": "IVT",
}


def item19(
    brand: str, dose: float, dose_unit: str, route: str, ndc_11: str, cost: Optional[float] = None
) -> tuple[str, bool]:
    """Item 19 drug description for a generic-code claim, and whether it fits
    the 80-character limit, e.g. ('DrugX 500mg IV NDC 12345067890 $4500.00', True)."""
    ndc_digits = ndc_11.replace("-", "")
    if len(ndc_digits) != 11 or not ndc_digits.isdigit():
        raise ValueError(f"Item 19 needs an 11-digit NDC, got {ndc_11!r}")

    parts = [
        brand,
        f"{_num(_dec(dose))}{dose_unit.lower()}",
        _ROUTE_ABBREVIATIONS.get(route.strip().upper(), route.strip()),
        f"NDC {ndc_digits}",
    ]
    if cost is not None:
        parts.append(f"${_dec(cost):.2f}")
    text = " ".join(parts)
    return text, len(text) <= ITEM19_MAX_LENGTH
