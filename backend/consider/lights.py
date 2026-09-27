"""The "Can my practice use this?" lights shown on a drug's page."""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from billing_rules import code_kind_label, code_timeline, dose_for, is_generic, vial_mix
from core.clock import today
from core.db import supabase
from core.lookups import payer_policy

router = APIRouter()


class ConsideringRequest(BaseModel):
    email: str
    application_id: str


# One field: the citation strings from `drugs.citations` (Claude's
# label-extraction citations) that back a given light, so the light can
# show its own sources instead of a raw field list.
def _citations_for(drug, fields):
    citations = drug.get("citations") or []
    return [c["citation"] for c in citations if c.get("field") in fields]


def _day(d) -> str:
    return f"{d:%b} {d.day}, {d.year}"


def _billing_path_light(drug):
    """Reads the drug's dated `codes` list for today (core.clock.today, which
    DEMO_TODAY can override), so the light counts down to a code change and
    turns green once a product-specific code is in effect. Drugs without a
    `codes` list fall back to the pipeline's has_permanent_code fields."""
    codes = drug.get("codes") or []
    if codes:
        try:
            t = code_timeline(codes, today())
        except ValueError:
            t = None
        if t:
            return _billing_path_from_timeline(t, drug)
    return _billing_path_from_fields(drug)


def _billing_path_from_timeline(t, drug):
    current, upcoming = t["current"], t["next"]
    sources = _citations_for(drug, ["generic_billing_code", "has_permanent_code", "permanent_hcpcs_code"])
    if current is None:
        when = f" until {upcoming['code']} takes effect {_day(t['changes_on'])}" if upcoming else ""
        return {"color": "gray", "text": f"No billing code in effect yet{when}.", "sources": sources}
    if is_generic(current):
        after = (
            f" until {upcoming['code']} takes effect {_day(t['changes_on'])} (in {t['days_until_next']} days)"
            if upcoming
            else " until a permanent code is assigned"
        )
        return {
            "color": "yellow",
            "text": (
                f"Billed under generic code {current['code']}{after}. Claims need a drug description, "
                "the 11-digit NDC and the invoice: we can draft and check these for you, and switch "
                "codes automatically by the date each dose is given."
            ),
            "sources": sources,
        }
    since = f" since {_day(t['changed_on'])}" if t["changed_on"] else ""
    unit = f", billed per {current['unit'].lower()}" if current.get("unit") else ""
    return {
        "color": "green",
        "text": f"Bills under its {code_kind_label(current)} code {current['code']}{since}{unit}.",
        "sources": sources,
    }


def _billing_path_from_fields(drug):
    if drug.get("has_permanent_code"):
        code = drug.get("permanent_hcpcs_code") or "—"
        return {
            "color": "green",
            "text": f"Permanent code {code}.",
            "sources": _citations_for(drug, ["has_permanent_code", "permanent_hcpcs_code"]),
        }
    code = drug.get("generic_billing_code")
    if not code:
        return {"color": "gray", "text": "Billing code not yet available.", "sources": []}
    return {
        "color": "yellow",
        "text": f"Billed under generic code {code} until a permanent code is assigned.",
        "sources": _citations_for(drug, ["generic_billing_code"]),
    }


# Payment timing is a labeled estimate: what one typical dose costs to buy up
# front, and roughly how long the practice waits to be paid back. It's about
# timing only (buy-and-bill means paying for the drug before the claim pays),
# not about profit. The waits are typical, not payer data: a generic-code
# claim is priced by hand from Item 19 and the invoice, a product-specific
# code prices automatically.
REFERENCE_WEIGHT_KG = 70
REFERENCE_BSA_M2 = 1.8
PAYMENT_WAIT_MONTHS = {"generic": 2, "specific": 1}


def _money(amount) -> str:
    return f"${amount:,.0f}"


def _vial_prices(drug, practice_drug):
    """Vial strength in mg → (price per vial, where that price came from).
    The practice's own invoice wins over the drug maker's launch list price."""
    invoiced = {}
    for invoice in (practice_drug or {}).get("invoices") or []:
        for line in invoice.get("lines") or []:
            if line.get("ndc_11") and line.get("cost_per_vial") is not None:
                source = f"Your invoice from {invoice.get('distributor') or 'the distributor'}"
                invoiced[line["ndc_11"]] = (float(line["cost_per_vial"]), source)
    prices = {}
    for ndc in drug.get("ndcs") or []:
        if not ndc.get("strength_mg") or ndc.get("sample"):
            continue
        price = invoiced.get(ndc.get("ndc_11"))
        if price is None and ndc.get("list_price") is not None:
            price = (float(ndc["list_price"]), "The drug maker's launch list price")
        if price is not None:
            prices.setdefault(float(ndc["strength_mg"]), price)
    return prices


def _typical_dose_cost(drug, practice_drug):
    """(cost, how it was worked out, sources) for one typical adult dose, or
    None when there's no price to work from."""
    typical = drug.get("typical_adult_dose") or {}
    prices = _vial_prices(drug, practice_drug)
    if typical.get("amount") and typical.get("unit") and prices:
        try:
            dose, unit = dose_for(
                typical["amount"], typical["unit"], weight_kg=REFERENCE_WEIGHT_KG, bsa_m2=REFERENCE_BSA_M2
            )
        except ValueError:
            dose, unit = None, None
        if dose and unit.lower() == "mg":
            mix = vial_mix(dose, list(prices))
            used = [(float(size), count) for size, count in mix["vials"].items()]
            cost = sum(prices[size][0] * count for size, count in used)
            vials = " + ".join(
                f"{count} × {size:g} mg vial{'' if count == 1 else 's'} at {_money(prices[size][0])}"
                for size, count in used
            )
            per = typical["unit"].lower()
            if per.endswith("/kg"):
                who = f" for a {REFERENCE_WEIGHT_KG} kg adult"
            elif "/m" in per:
                who = f" for an adult with {REFERENCE_BSA_M2} m² body surface area"
            else:
                who = ""
            sources = sorted({prices[size][1] for size, _ in used})
            return cost, f"{dose:g} mg{who}: {vials}", sources
    if drug.get("cost_per_dose") is not None:
        return float(drug["cost_per_dose"]), "estimated cost per dose", _citations_for(drug, ["cost_per_dose"])
    return None


def _code_state(drug):
    """('generic' | 'specific' | None, the product-specific code coming next
    or None, the day it takes effect or None), for today."""
    codes = drug.get("codes") or []
    if codes:
        try:
            t = code_timeline(codes, today())
        except ValueError:
            t = None
        if t and t["current"]:
            if not is_generic(t["current"]):
                return "specific", None, None
            upcoming = t["next"] if t["next"] and not is_generic(t["next"]) else None
            return "generic", upcoming, upcoming and t["changes_on"]
    if drug.get("has_permanent_code"):
        return "specific", None, None
    if drug.get("generic_billing_code"):
        return "generic", None, None
    return None, None, None


def _payment_timing_light(drug, practice_drug=None):
    practice_drug = practice_drug or {}
    estimate = _typical_dose_cost(drug, practice_drug)
    if estimate is None:
        return {"color": "gray", "text": "No price on file yet to estimate what a dose costs up front.", "sources": []}
    cost, how, sources = estimate
    kind, upcoming, changes_on = _code_state(drug)
    months = PAYMENT_WAIT_MONTHS["specific" if kind == "specific" else "generic"]

    if kind == "specific":
        wait = "Claims under its own code are priced automatically, so payment usually takes about a month."
    else:
        wait = "Claims under a generic code are priced by hand from the invoice, so payment usually takes about 2 months."
    text = f"Estimate: about {_money(cost)} per dose to buy up front ({how}). {wait}"

    planned = practice_drug.get("planned_patients_per_month")
    if planned:
        text += (
            f" Treating {planned} patient{'' if planned == 1 else 's'} a month, one dose each, you'd pay about "
            f"{_money(cost * planned * months)} for the drug before the first payments come in."
        )
    else:
        text += " Enter how many patients you plan to treat each month to see how much you'd pay before payments start."
    if upcoming:
        text += f" Payment should speed up once {upcoming['code']} takes effect {_day(changes_on)}."

    return {"color": "green" if kind == "specific" else "yellow", "text": text, "sources": sources}


# Storage/route are free text from the label, not structured flags, so this
# is a keyword heuristic against the practice's capabilities checklist --
# good enough to demo, not a real requirements parser.
def _workflow_light(drug, practice):
    storage = (drug.get("storage_requirements") or "").lower()
    route = (drug.get("route_of_administration") or "").lower()
    if not storage and not route:
        return {"color": "gray", "text": "Workflow requirements not yet available.", "sources": []}

    capabilities = (practice or {}).get("capabilities") or {}
    missing = []
    if "refrigerat" in storage and not capabilities.get("refrigeration"):
        missing.append("refrigeration")
    # "intravenous" (openFDA's spelled-out form) doesn't contain "iv" as a
    # substring, so that needs its own check alongside the abbreviation.
    if (
        "intravenous" in route or "infusion" in route or "iv" in route.split("/")
    ) and not capabilities.get("infusion_chairs"):
        missing.append("infusion chairs")

    sources = _citations_for(drug, ["storage_requirements", "route_of_administration"])
    if missing:
        return {
            "color": "yellow",
            "text": f"Your practice profile doesn't list: {', '.join(missing)}.",
            "sources": sources,
        }
    return {
        "color": "green",
        "text": "Your practice has what this drug's label requires.",
        "sources": sources,
    }


# Coverage comes from the insurer policies on the drug (`drugs.payer_policies`,
# entered by the drug maker at launch), checked for each insurer on the
# practice's profile. The light takes the worst color among them. An insurer
# with no policy on file is yellow ("verify"), never assumed covered.
_COLOR_RANK = {"green": 1, "yellow": 2, "red": 3}


def _policy_status(policy):
    """(color, what to say) for one insurer's policy on this drug."""
    if policy is None:
        return "yellow", "no policy on file, so verify coverage before treating"
    if policy.get("covered") is False:
        return "red", "not covered"
    if policy.get("covered") is None:
        return "yellow", "policy under review, so verify coverage before treating"
    if policy.get("prior_auth"):
        return "yellow", "covered with prior authorization"
    return "green", "covered, no prior authorization needed"


def _coverage_light(drug, practice):
    payers = [p for p in (practice or {}).get("payers") or [] if p]
    if not payers:
        return {
            "color": "gray",
            "text": "Add the insurers your patients use to your practice profile to see coverage.",
            "sources": [],
        }
    colors, lines, sources = [], [], []
    for payer in payers:
        policy = payer_policy(drug, payer)
        color, words = _policy_status(policy)
        colors.append(color)
        lines.append(f"{payer}: {words}.")
        if policy and policy.get("notes"):
            sources.append(f"{policy['payer']} policy: {policy['notes']}")
    return {"color": max(colors, key=_COLOR_RANK.get), "text": " ".join(lines), "sources": sources}


def compute_lights(drug, practice, practice_drug=None):
    return {
        "coverage": _coverage_light(drug, practice),
        "billing_path": _billing_path_light(drug),
        "payment_timing": _payment_timing_light(drug, practice_drug),
        "workflow": _workflow_light(drug, practice),
    }


@router.post("/api/practice-drugs/considering")
def get_or_create_considering(payload: ConsideringRequest):
    practice_resp = (
        supabase.table("practices").select("*").eq("email", payload.email).limit(1).execute()
    )
    if not practice_resp.data:
        raise HTTPException(status_code=404, detail=f"No practice found for email {payload.email}")
    practice = practice_resp.data[0]

    drug_resp = (
        supabase.table("drugs")
        .select("*")
        .eq("application_id", payload.application_id)
        .limit(1)
        .execute()
    )
    if not drug_resp.data:
        raise HTTPException(status_code=404, detail=f"No drug found for {payload.application_id}")
    drug = drug_resp.data[0]

    # The existing row (if any) feeds the payment estimate: planned patients
    # per month and any invoice already recorded.
    existing = (
        supabase.table("practice_drugs")
        .select("*")
        .eq("practice_id", practice["id"])
        .eq("application_id", payload.application_id)
        .limit(1)
        .execute()
        .data
    )

    # Only `lights` (+ the conflict key) is in this payload, so an existing
    # row's status/hold_list/etc. from a later decision are left untouched
    # -- this only ever refreshes the computed lights on each page visit.
    row = {
        "practice_id": practice["id"],
        "application_id": payload.application_id,
        "lights": compute_lights(drug, practice, existing[0] if existing else None),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    response = (
        supabase.table("practice_drugs")
        .upsert(row, on_conflict="practice_id,application_id")
        .execute()
    )
    return response.data[0]
