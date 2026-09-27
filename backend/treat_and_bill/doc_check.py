"""Treat & Bill: the documentation check (AI reads, code decides what to check)."""

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Optional

import anthropic
from fastapi import APIRouter, Depends, HTTPException

from core.ai import claude
from core.auth import current_practice
from core.db import supabase
from core.lookups import fetch_drug, payer_policy
from treat_and_bill.shared import fetch_practice_patient, fetch_practice_treatment

router = APIRouter()


# ---------------------------------------------------------------------------
# Treat & Bill: documentation check (AI reads, code decides what to check)
# ---------------------------------------------------------------------------
# Code builds the requirement list from the label, the dosing and the patient's
# payer policy, so the same note always gets the same list and deleting one
# line flips exactly one item. Claude only judges the note against that list
# and quotes it; code then verifies every quote really is in the note.

DOC_CHECK_SCHEMA_BASE = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "passed": {"type": "boolean"},
                    "quote": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                },
                "required": ["id", "passed", "quote"],
                "additionalProperties": False,
            },
        },
        "draft_text": {"anyOf": [{"type": "string"}, {"type": "null"}]},
    },
    "required": ["results", "draft_text"],
    "additionalProperties": False,
}


DOC_CHECK_INSTRUCTIONS = """\
You are checking a physician's visit note before a drug order is signed, for a \
medical-billing app. For each requirement below, decide whether the note \
documents it.

- passed: true only if the note itself states it. Do not infer from the order \
or assume anything the note doesn't say.
- quote: when passed, the shortest exact span copied verbatim from the note \
(same characters, no ellipses or paraphrase) that shows it; null when not passed.
- draft_text: if any requirement failed, one or two sentences the doctor could \
add to the note to cover the missing items, using square-bracket placeholders \
such as [date] or [lab] for facts you don't know. Never invent patient facts \
or results. null if everything passed.

Return one result per requirement id."""


def _doc_requirements(drug: dict, patient: dict) -> list[dict]:
    """[{id, label, detail}] -- what this note must document for this drug and payer."""
    requirements = []
    uses = drug.get("approved_uses_and_conditions") or []
    if uses:
        all_uses = "; ".join(u["approved_diagnosis"] for u in uses)
        label = (
            f"Diagnosis: {uses[0]['approved_diagnosis'].split(' — ')[0]}"
            if len(uses) == 1
            else "Diagnosis matches an approved use"
        )
        requirements.append(
            {"id": "diagnosis", "label": label, "detail": f"A diagnosis matching the FDA-approved use: {all_uses}"}
        )
        if len(uses) == 1 and uses[0].get("prior_therapy"):
            requirements.append(
                {
                    "id": "prior_therapy",
                    "label": f"Prior therapy: {uses[0]['prior_therapy']}",
                    "detail": f"Required prior therapy: {uses[0]['prior_therapy']}",
                }
            )
        if len(uses) == 1 and uses[0].get("required_test_method"):
            requirements.append(
                {
                    "id": "required_test",
                    "label": f"Required test: {uses[0]['required_test_method']}",
                    "detail": f"Required test result: {uses[0]['required_test_method']}",
                }
            )

    dose_unit = ((drug.get("typical_adult_dose") or {}).get("unit") or "").lower()
    if dose_unit.endswith("/kg"):
        requirements.append(
            {
                "id": "weight",
                "label": "Current weight documented",
                "detail": f"The patient's current weight (the dose is calculated in {dose_unit})",
            }
        )
    elif dose_unit.endswith("/m2"):
        requirements.append(
            {
                "id": "body_surface_area",
                "label": "Height and weight documented",
                "detail": "Current height and weight or body surface area (the dose is per m²)",
            }
        )

    policy = payer_policy(drug, patient.get("payer")) or {}
    for index, requirement in enumerate(policy.get("documentation_requirements") or [], start=1):
        requirements.append(
            {
                "id": f"payer_{index}",
                "label": f"{requirement} ({policy['payer']} policy)",
                "detail": f"{policy['payer']} coverage policy requires: {requirement}",
            }
        )
    return requirements


def _doc_check_key(note: str, requirements: list[dict]) -> str:
    return hashlib.sha256(json.dumps([note, requirements], sort_keys=True).encode()).hexdigest()


def _doc_check_view(stored: dict) -> dict:
    """What the chart page reads: {checks: [{id, label, passed, quote}], draft_text}."""
    return {
        "checks": [
            {"id": i["id"], "label": i["requirement"], "passed": i["passed"], "quote": i.get("quote")}
            for i in stored.get("items") or []
        ],
        "draft_text": stored.get("draft_text"),
        "prior_auth_required": stored.get("prior_auth_required", False),
        "checked_at": stored.get("checked_at"),
    }


async def _run_doc_check(note: str, requirements: list[dict], brand: str) -> dict:
    """Claude's judgment of the note against the requirements, as {results, draft_text}."""
    schema = json.loads(json.dumps(DOC_CHECK_SCHEMA_BASE))
    schema["properties"]["results"]["items"]["properties"]["id"]["enum"] = [r["id"] for r in requirements]
    listed = "\n".join(f"- {r['id']}: {r['detail']}" for r in requirements)
    prompt = (
        f"{DOC_CHECK_INSTRUCTIONS}\n\nDrug being ordered: {brand}\n\n"
        f"<requirements>\n{listed}\n</requirements>\n\n<visit_note>\n{note}\n</visit_note>"
    )
    try:
        async with claude.beta.messages.stream(
            model="claude-opus-5",
            max_tokens=16000,
            # Low effort: this re-runs on every note save, so it has to feel instant.
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            message = await stream.get_final_message()
    except (anthropic.AuthenticationError, TypeError) as err:
        if isinstance(err, TypeError) and "authentication" not in str(err):
            raise
        raise HTTPException(
            status_code=503, detail="The documentation check needs a valid ANTHROPIC_API_KEY in backend/.env"
        )
    except anthropic.APIStatusError as err:
        raise HTTPException(status_code=502, detail=f"Claude API error: {err.message}")
    except anthropic.APIConnectionError:
        raise HTTPException(status_code=502, detail="Could not reach the Claude API")

    if message.stop_reason != "end_turn":
        raise HTTPException(
            status_code=502, detail=f"Documentation check stopped early ({message.stop_reason})"
        )
    return json.loads(next(b.text for b in message.content if b.type == "text"))


def _in_note(quote: Optional[str], note: str) -> bool:
    """Whether the quote is really in the note (ignoring whitespace differences)."""
    if not quote or not quote.strip():
        return False
    return " ".join(quote.split()).lower() in " ".join(note.split()).lower()


def _has_blank(quote: str, note: str) -> bool:
    """Whether the quote, or the note line it comes from, still has an unfilled
    [placeholder] -- Claude may quote just the part next to the blank."""
    wanted = " ".join(quote.split()).lower()
    lines = [line for line in note.splitlines() if wanted in " ".join(line.split()).lower()]
    return any(re.search(r"\[[^\]]+\]", text) for text in [quote, *lines])


@router.post("/api/treatments/{treatment_id}/doc-check")
async def documentation_check(treatment_id: int, practice: dict = Depends(current_practice)):
    treatment, practice_drug = fetch_practice_treatment(treatment_id, practice)
    stored = treatment.get("documentation_check")
    # After signing, the check is part of the signed order: show it, don't redo it.
    if treatment["status"] != "ordered":
        if not stored:
            raise HTTPException(status_code=409, detail="This order was signed without a documentation check")
        return _doc_check_view(stored)

    patient = fetch_practice_patient(treatment["patient_id"], practice)
    drug = fetch_drug(practice_drug["application_id"])
    note = patient.get("visit_note") or ""
    requirements = _doc_requirements(drug, patient)
    key = _doc_check_key(note, requirements)
    if stored and stored.get("key") == key:
        return _doc_check_view(stored)  # same note, same requirements: no new Claude call

    if not note.strip():
        results, draft = [], None
    else:
        judged = await _run_doc_check(note, requirements, drug.get("brand_name") or "the drug")
        results, draft = judged["results"], judged["draft_text"]
    by_id = {r["id"]: r for r in results}

    items = []
    unfilled = False
    for requirement in requirements:
        result = by_id.get(requirement["id"]) or {}
        # A pass only stands if its quote really is in the note, and isn't an
        # approved draft whose [placeholders] were never filled in.
        quote_ok = _in_note(result.get("quote"), note)
        has_blank = quote_ok and _has_blank(result["quote"], note)
        unfilled = unfilled or (bool(result.get("passed")) and has_blank)
        passed = bool(result.get("passed")) and quote_ok and not has_blank
        items.append(
            {
                "id": requirement["id"],
                "requirement": requirement["label"],
                "passed": passed,
                "quote": result.get("quote") if passed else None,
            }
        )
    policy = payer_policy(drug, patient.get("payer")) or {}
    if unfilled:
        draft = "Fill in the [bracketed] placeholders in the note, then the check will re-run."
    stored = {
        "items": items,
        "draft_text": None if all(i["passed"] for i in items) else draft,
        "prior_auth_required": bool(policy.get("prior_auth")),
        "payer": patient.get("payer"),
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "key": key,
        "note_sha256": hashlib.sha256(note.encode()).hexdigest(),
    }
    supabase.table("treatments").update({"documentation_check": stored}).eq("id", treatment_id).execute()
    return _doc_check_view(stored)
