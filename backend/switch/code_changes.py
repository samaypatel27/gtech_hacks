"""Switch (Stage 4): what happens when a drug's billing code changes.

The billing itself needs no reaction: every claim picks its code by the date
the drug was given (`billing_rules.code_for`), and drafts rebuild on every view.
This module handles everything around it, for any change in a drug's dated
`codes` list (generic -> permanent, generic -> a temporary Q-code, temporary ->
permanent, or a new billing unit):

  * a notice: a countdown before the change, a "since <date>" note after it
  * once per change, the first time a workspace is opened on or after it:
      - claims already exported with the old code for doses given on or after
        the change are flagged `needs_recoding` (the claim page then offers
        "Build corrected claim")
      - the biller gets a "code change" card explaining the new rules and
        listing any flagged claims
      - the doctor gets "Review hold list" if patients are waiting

There's no scheduler, so the check runs whenever a page asks for the notice
(`GET /api/practice-drugs/{id}/code-status`); the "code change" card doubles as
the marker that a change was already handled. "Today" comes from core.clock,
so DEMO_TODAY can show the state after a change before the real date.
"""

from datetime import date, datetime, timezone

from fastapi import APIRouter, HTTPException

from billing_rules import code_for, code_kind_label, code_timeline, is_generic
from core.clock import today
from core.db import supabase
from core.lookups import fetch_drug, patient_name
from core.notify import notify

router = APIRouter()

# How long after a change the "since <date>" notice keeps showing.
SWITCHED_NOTICE_DAYS = 60


def _day(d) -> str:
    d = d if isinstance(d, date) else date.fromisoformat(str(d)[:10])
    return f"{d:%b} {d.day}, {d.year}"


def _billing_rule(code: dict) -> str:
    if is_generic(code):
        return "1 unit per line, with the drug described in Item 19 and the invoice attached"
    return f"units = dose ÷ {code['unit'].lower()}, no Item 19 or invoice needed"


def code_notice(brand: str, timeline: dict) -> dict:
    """The banner for a workspace: {state: upcoming|switched|none, message, ...}."""
    current, previous, upcoming = timeline["current"], timeline["previous"], timeline["next"]
    base = {
        "current_code": current and {**current, "kind": code_kind_label(current)},
        "next_code": upcoming and {**upcoming, "kind": code_kind_label(upcoming)},
        "changes_on": timeline["changes_on"] and timeline["changes_on"].isoformat(),
        "days_until_next": timeline["days_until_next"],
        "changed_on": timeline["changed_on"] and timeline["changed_on"].isoformat(),
    }
    if upcoming:
        days = timeline["days_until_next"]
        return {
            **base,
            "state": "upcoming",
            "message": (
                f"{brand} moves to its {code_kind_label(upcoming)} code {upcoming['code']} on "
                f"{_day(timeline['changes_on'])} (in {days} day{'' if days == 1 else 's'}). Doses given from then on "
                f"bill automatically as {upcoming['code']}: {_billing_rule(upcoming)}. Doses given before "
                f"keep {current['code'] if current else 'their current code'}."
            ),
        }
    if previous and timeline["days_since_change"] <= SWITCHED_NOTICE_DAYS:
        return {
            **base,
            "state": "switched",
            "message": (
                f"Since {_day(timeline['changed_on'])}, {brand} bills as its {code_kind_label(current)} code "
                f"{current['code']} instead of {previous['code']}: {_billing_rule(current)}. Doses given before "
                f"{_day(timeline['changed_on'])} keep {previous['code']}."
            ),
        }
    return {**base, "state": "none", "message": None}


def _handle_change(practice_drug: dict, drug: dict, timeline: dict) -> dict:
    """Run the one-time reactions to the change that took effect on
    timeline['changed_on'], unless its "code change" card already exists."""
    current, previous = timeline["current"], timeline["previous"]
    changed_on = timeline["changed_on"].isoformat()
    brand = drug.get("brand_name") or "This drug"

    existing = (
        supabase.table("tasks")
        .select("id,inputs")
        .eq("practice_drug_id", practice_drug["id"])
        .eq("kind", "recode_claims")
        .execute()
        .data
        or []
    )
    if any((t.get("inputs") or {}).get("changed_on") == changed_on for t in existing):
        return {"handled_now": False}

    # Exported claims whose code is wrong for their date of service and payer.
    exported = (
        supabase.table("treatments")
        .select("id,patient_id,date_of_service,billing_code")
        .eq("practice_drug_id", practice_drug["id"])
        .eq("status", "exported")
        .gte("date_of_service", changed_on)
        .execute()
        .data
        or []
    )
    patients = {}
    if exported:
        rows = (
            supabase.table("patients")
            .select("id,first_name,last_name,payer")
            .in_("id", list({t["patient_id"] for t in exported}))
            .execute()
            .data
            or []
        )
        patients = {p["id"]: p for p in rows}
    affected = []
    for t in exported:
        patient = patients.get(t["patient_id"]) or {}
        right = code_for(drug.get("codes") or [], patient.get("payer"), t["date_of_service"])
        if right and right["code"] != t["billing_code"]:
            affected.append({**t, "name": patient_name(patient) if patient else f"treatment {t['id']}"})
    for t in affected:
        supabase.table("treatments").update(
            {"status": "needs_recoding", "updated_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", t["id"]).execute()

    names = ", ".join(f"{t['name']} ({_day(t['date_of_service'])})" for t in affected)
    fix = (
        f" {len(affected)} claim{'' if len(affected) == 1 else 's'} already exported with {previous['code']} for "
        f"doses given on or after {_day(changed_on)} need a corrected claim: {names}. Open each claim and choose "
        '"Build corrected claim".'
        if affected
        else " No exported claims need correcting."
    )
    supabase.table("tasks").insert(
        {
            "practice_drug_id": practice_drug["id"],
            "stage": "switch",
            "role": "biller",
            "kind": "recode_claims",
            "title": f"Code change: {brand} now bills as {current['code']}",
            "instruction": (
                f"From {_day(changed_on)}, {brand} bills under its {code_kind_label(current)} code "
                f"{current['code']} instead of {previous['code']}: {_billing_rule(current)}. Claims for doses given "
                f"before {_day(changed_on)} keep {previous['code']}; draft claims update automatically.{fix}"
            ),
            "status": "todo",
            "inputs": {
                "code": current["code"],
                "changed_on": changed_on,
                "affected_treatment_ids": [t["id"] for t in affected],
            },
        }
    ).execute()

    hold_list = practice_drug.get("hold_list") or []
    if hold_list:
        supabase.table("tasks").insert(
            {
                "practice_drug_id": practice_drug["id"],
                "stage": "switch",
                "role": "doctor",
                "kind": "review_hold_list",
                "title": f"Review hold list: {len(hold_list)} waiting for {brand}",
                "instruction": (
                    f"{brand} now bills under its own code {current['code']} (since {_day(changed_on)}), so claims "
                    "are priced automatically instead of by hand. Review the patients you held and start the ones "
                    "who are ready."
                ),
                "status": "todo",
                "inputs": {"code": current["code"], "changed_on": changed_on},
            }
        ).execute()

    return {"handled_now": True, "flagged_treatment_ids": [t["id"] for t in affected], "hold_list": len(hold_list)}


@router.get("/api/practice-drugs/{practice_drug_id}/code-status")
def get_code_status(practice_drug_id: int):
    """The code-change notice for a workspace, plus the once-per-change
    reactions (flag claims, code-change card, hold-list card). No login, like
    the rest of the board."""
    response = supabase.table("practice_drugs").select("*").eq("id", practice_drug_id).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail=f"No practice_drugs row found for id {practice_drug_id}")
    practice_drug = response.data[0]
    drug = fetch_drug(practice_drug["application_id"])
    day = today()

    try:
        timeline = code_timeline(drug.get("codes") or [], day)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=f"{drug.get('brand_name')}'s code list is inconsistent: {err}")

    handled = {"handled_now": False}
    if timeline["previous"]:
        handled = _handle_change(practice_drug, drug, timeline)
    return {"today": day.isoformat(), **code_notice(drug.get("brand_name") or "This drug", timeline), **handled}


# How far ahead the bell warns about a coming code change.
UPCOMING_NOTIFY_DAYS = 30


def notify_code_changes(practice_id: int) -> None:
    """Bell messages for this practice's drugs whose billing code changes
    within UPCOMING_NOTIFY_DAYS or changed recently. Covers every drug the
    practice has opened (a practice_drugs row), held or adopted or not. Runs
    whenever the bell loads, since there's no scheduler; the dedupe keys make
    repeats no-ops."""
    rows = (
        supabase.table("practice_drugs")
        .select("id,application_id,status,hold_list")
        .eq("practice_id", practice_id)
        .execute()
        .data
        or []
    )
    if not rows:
        return
    drugs = (
        supabase.table("drugs")
        .select("application_id,brand_name,codes")
        .in_("application_id", [r["application_id"] for r in rows])
        .execute()
        .data
        or []
    )
    by_id = {d["application_id"]: d for d in drugs}
    day = today()

    for practice_drug in rows:
        app_id = practice_drug["application_id"]
        drug = by_id.get(app_id) or {}
        try:
            timeline = code_timeline(drug.get("codes") or [], day)
        except ValueError:
            continue
        brand = drug.get("brand_name") or "A drug"
        notice = code_notice(brand, timeline)
        adopted = practice_drug["status"] in ("adopting", "active")
        link = f"/doctor/workspace/{practice_drug['id']}" if adopted else f"/drugs/{app_id}"

        if notice["state"] == "upcoming" and timeline["days_until_next"] <= UPCOMING_NOTIFY_DAYS:
            upcoming = timeline["next"]
            notify(
                practice_id,
                "code_change_upcoming",
                f"{brand} moves to {upcoming['code']} on {_day(timeline['changes_on'])}",
                dedupe_key=f"code_upcoming:{app_id}:{upcoming['code']}:{timeline['changes_on'].isoformat()}",
                body=notice["message"],
                link=link,
                application_id=app_id,
            )
        elif notice["state"] == "switched":
            held = len(practice_drug.get("hold_list") or [])
            waiting = (
                f" {held} patient{' is' if held == 1 else 's are'} on your hold list for it." if held else ""
            )
            notify(
                practice_id,
                "code_changed",
                f"{brand} now bills as {timeline['current']['code']}",
                dedupe_key=f"code_changed:{app_id}:{timeline['changed_on'].isoformat()}",
                body=notice["message"] + waiting,
                link=link,
                application_id=app_id,
            )
