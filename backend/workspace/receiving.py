"""Receiving (BuildPlan Phase 3): the front desk records the distributor's
invoice, the NDC is checked against the drug's packages, and stock is recorded.

Lines are entered by hand -- the plan's fallback for AI invoice reading -- so
`file_path` stays null until uploads exist.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.db import supabase
from core.lookups import fetch_drug
from core.task_rules import raise_if_waiting
from workspace.tasks import _recalculate_readiness

router = APIRouter()


class InvoiceLine(BaseModel):
    ndc_11: str
    lot: str
    quantity: int
    cost_per_vial: float


class InvoiceRecord(BaseModel):
    distributor: str
    lines: list[InvoiceLine]
    # The card it was entered on: Receiving (setup) or a patient's "Buy for
    # this patient". A buy card is done once its invoice is in; Receiving
    # still needs the front desk to mark the drug stored.
    task_id: Optional[int] = None


def _add_to_stock(stock: list, lines: list[dict]) -> list:
    """Stock after receiving `lines`; the same NDC + lot adds up."""
    stock = [dict(s) for s in stock if isinstance(s, dict)]
    for line in lines:
        match = next(
            (s for s in stock if s.get("ndc_11") == line["ndc_11"] and s.get("lot") == line["lot"]),
            None,
        )
        if match:
            match["quantity"] = (match.get("quantity") or 0) + line["quantity"]
        else:
            stock.append({"ndc_11": line["ndc_11"], "lot": line["lot"], "quantity": line["quantity"]})
    return stock


@router.post("/api/practice-drugs/{practice_drug_id}/invoices")
def record_invoice(practice_drug_id: int, payload: InvoiceRecord):
    pd_resp = supabase.table("practice_drugs").select("*").eq("id", practice_drug_id).limit(1).execute()
    if not pd_resp.data:
        raise HTTPException(status_code=404, detail=f"No practice_drugs row found for id {practice_drug_id}")
    practice_drug = pd_resp.data[0]
    drug = fetch_drug(practice_drug["application_id"])

    if not payload.distributor.strip():
        raise HTTPException(status_code=422, detail="Enter the distributor")
    if not payload.lines:
        raise HTTPException(status_code=422, detail="Enter at least one invoice line")
    packages = [n["ndc_11"] for n in drug.get("ndcs") or [] if n.get("ndc_11")]
    for line in payload.lines:
        if line.ndc_11 not in packages:
            raise HTTPException(
                status_code=422,
                detail=f"NDC {line.ndc_11} isn't a {drug.get('brand_name')} package "
                f"({', '.join(packages) or 'none on file'}): check the product received",
            )
        if not line.lot.strip():
            raise HTTPException(status_code=422, detail=f"Enter the lot number for NDC {line.ndc_11}")
        if line.quantity <= 0:
            raise HTTPException(status_code=422, detail="Vial quantity must be at least 1")
        if line.cost_per_vial <= 0:
            raise HTTPException(status_code=422, detail="Cost per vial must be more than $0")

    task = None
    if payload.task_id is not None:
        task_resp = (
            supabase.table("tasks")
            .select("*")
            .eq("id", payload.task_id)
            .eq("practice_drug_id", practice_drug_id)
            .limit(1)
            .execute()
        )
        if not task_resp.data or task_resp.data[0]["kind"] not in ("receiving", "buy_for_patient"):
            raise HTTPException(
                status_code=422, detail="Invoices are recorded on the Receiving or Buy for this patient card"
            )
        task = task_resp.data[0]
        raise_if_waiting(task)

    now = datetime.now(timezone.utc).isoformat()
    lines = [{**line.model_dump(), "lot": line.lot.strip()} for line in payload.lines]
    invoices = (practice_drug.get("invoices") or []) + [
        {"file_path": None, "distributor": payload.distributor.strip(), "uploaded_at": now, "lines": lines}
    ]
    stock = _add_to_stock(practice_drug.get("stock_on_hand") or [], lines)
    supabase.table("practice_drugs").update(
        {"invoices": invoices, "stock_on_hand": stock, "updated_at": now}
    ).eq("id", practice_drug_id).execute()

    if task:
        update = {"inputs": {**(task.get("inputs") or {}), "invoice_recorded_at": now}}
        if task["kind"] == "buy_for_patient":
            update.update({"status": "done", "completed_at": now})
        supabase.table("tasks").update(update).eq("id", task["id"]).execute()

    _recalculate_readiness(practice_drug_id)
    status = supabase.table("practice_drugs").select("status").eq("id", practice_drug_id).execute().data[0]
    return {"status": status["status"], "invoices": invoices, "stock_on_hand": stock}
