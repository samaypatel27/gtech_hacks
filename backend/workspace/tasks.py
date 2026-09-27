"""The team board: tasks, waiting rules, readiness, and workspace lists."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.db import supabase
from core.lookups import patient_name, patients_by_treatment
from core.task_rules import PAGE_COMPLETED_KINDS, raise_if_waiting, waiting_on_labels

router = APIRouter()


@router.get("/api/practice-drugs/{practice_drug_id}/tasks")
def get_practice_drug_tasks(practice_drug_id: int):
    """Return tasks plus the full practice_drug context and a drug summary,
    so the workspace page has everything it needs in one request."""
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

    drug_resp = (
        supabase.table("drugs")
        .select("brand_name,application_id,codes,approval_date,storage_requirements")
        .eq("application_id", practice_drug["application_id"])
        .limit(1)
        .execute()
    )
    drug_row = drug_resp.data[0] if drug_resp.data else {}

    tasks_resp = (
        supabase.table("tasks")
        .select("*")
        .eq("practice_drug_id", practice_drug_id)
        .order("id")
        .execute()
    )

    tasks = tasks_resp.data or []
    tasks_by_id = {t["id"]: t for t in tasks}
    # Per-patient cards also carry who they're for, so the board can link
    # "Order + sign" to that patient's chart.
    patients = patients_by_treatment([t["treatment_id"] for t in tasks if t.get("treatment_id")])
    for t in tasks:
        t["waiting_on"] = waiting_on_labels(t, tasks_by_id)
        patient = patients.get(t.get("treatment_id"))
        t["patient_id"] = patient["id"] if patient else None
        t["patient_name"] = patient_name(patient) if patient else None

    hold_list = practice_drug.get("hold_list") or []
    stock = practice_drug.get("stock_on_hand") or []

    return {
        # Kept for backward compat with the DrugSearchGrid workspaces list.
        "drug_name": drug_row.get("brand_name", ""),
        "drug": {
            "brand_name": drug_row.get("brand_name", ""),
            "application_id": drug_row.get("application_id", ""),
            "codes": drug_row.get("codes") or [],
            "approval_date": drug_row.get("approval_date"),
            "storage_requirements": drug_row.get("storage_requirements"),
        },
        "practice_drug": {
            "id": practice_drug["id"],
            "status": practice_drug["status"],
            "planned_patients_per_month": practice_drug.get("planned_patients_per_month"),
            "hold_list_count": len(hold_list),
            "stock_on_hand": stock,
            "ready_at": practice_drug.get("ready_at"),
        },
        "tasks": tasks,
    }


def _recalculate_readiness(practice_drug_id: int) -> None:
    """After any task update, check whether the workspace has reached 'active'.
    All setup (stage='prepare') tasks done AND stock_on_hand non-empty with total
    quantity > 0 → active. If a setup task is un-done and status was active →
    revert to adopting. Per-patient and Switch tasks don't count: an open
    "Give Maria's infusion" must not knock the drug out of Ready. Stock only
    gates reaching Ready: once active, running out (vials used on patients) is
    handled by "Buy for this patient" cards, not by un-readying the drug."""
    tasks_resp = (
        supabase.table("tasks")
        .select("status")
        .eq("practice_drug_id", practice_drug_id)
        .eq("stage", "prepare")
        .execute()
    )
    pd_resp = (
        supabase.table("practice_drugs")
        .select("status,stock_on_hand")
        .eq("id", practice_drug_id)
        .limit(1)
        .execute()
    )
    if not pd_resp.data:
        return

    practice_drug = pd_resp.data[0]
    tasks = tasks_resp.data or []

    all_done = tasks and all(t["status"] == "done" for t in tasks)
    stock = practice_drug.get("stock_on_hand") or []
    has_stock = bool(stock) and sum(
        (s.get("quantity") or 0) for s in stock if isinstance(s, dict)
    ) > 0

    if practice_drug["status"] != "active" and all_done and has_stock:
        supabase.table("practice_drugs").update(
            {
                "status": "active",
                "ready_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", practice_drug_id).execute()
    elif practice_drug["status"] == "active" and not all_done:
        # A setup task was un-done — revert.
        supabase.table("practice_drugs").update(
            {
                "status": "adopting",
                "ready_at": None,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", practice_drug_id).execute()


class TaskUpdate(BaseModel):
    status: Optional[str] = None   # 'todo' | 'done' (tasks_status_check allows only these)
    inputs: Optional[dict] = None  # merged non-destructively into existing inputs


@router.patch("/api/tasks/{task_id}")
def update_task(task_id: int, payload: TaskUpdate):
    """Update a task's status and/or inputs.  Inputs are merged (not replaced):
    existing keys not in the payload survive.  Recalculates workspace readiness."""
    if payload.status is not None and payload.status not in ("todo", "done"):
        raise HTTPException(status_code=422, detail="status must be 'todo' or 'done'")

    # Fetch the current task to get practice_drug_id and existing inputs.
    current_resp = supabase.table("tasks").select("*").eq("id", task_id).limit(1).execute()
    if not current_resp.data:
        raise HTTPException(status_code=404, detail=f"No task found for id {task_id}")
    current = current_resp.data[0]

    if (
        payload.status is not None
        and payload.status != current["status"]
        and current["kind"] in PAGE_COMPLETED_KINDS
    ):
        raise HTTPException(status_code=409, detail=PAGE_COMPLETED_KINDS[current["kind"]])
    if (
        payload.status == "done"
        and current["kind"] == "prior_auth"
        and not {**(current.get("inputs") or {}), **(payload.inputs or {})}.get("auth_number")
    ):
        raise HTTPException(status_code=422, detail="Enter the authorization number first")
    if payload.status == "done" and current["kind"] == "receiving":
        # "Receive & store" is done once the invoice is entered (stock > 0)
        # and the drug is marked stored -- completing the card is the latter.
        pd_row = (
            supabase.table("practice_drugs")
            .select("invoices,stock_on_hand")
            .eq("id", current["practice_drug_id"])
            .execute()
            .data[0]
        )
        in_stock = sum(s.get("quantity") or 0 for s in pd_row.get("stock_on_hand") or [] if isinstance(s, dict))
        if not pd_row.get("invoices") or in_stock <= 0:
            raise HTTPException(status_code=422, detail="Record the invoice before marking the drug stored")

    # A task can't be finished while anything it waits on is unfinished.
    if payload.status == "done":
        raise_if_waiting(current)

    update: dict = {}
    if payload.status is not None:
        update["status"] = payload.status
        if payload.status == "done":
            update["completed_at"] = datetime.now(timezone.utc).isoformat()
        else:
            update["completed_at"] = None

    if payload.inputs is not None:
        # Merge: start from existing inputs (may be {} if column missing or new)
        existing_inputs = current.get("inputs") or {}
        update["inputs"] = {**existing_inputs, **payload.inputs}

    if not update:
        return current

    resp = supabase.table("tasks").update(update).eq("id", task_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail=f"No task found for id {task_id}")

    _recalculate_readiness(current["practice_drug_id"])
    return resp.data[0]


# Backward-compat alias so the old endpoint keeps working during transition.
class TaskStatusUpdate(BaseModel):
    status: str  # 'todo' | 'done'


@router.patch("/api/tasks/{task_id}/status")
def update_task_status(task_id: int, payload: TaskStatusUpdate):
    """Legacy alias for PATCH /api/tasks/{task_id} — kept so existing callers
    don't break. Delegates to the unified endpoint logic."""
    return update_task(task_id, TaskUpdate(status=payload.status))


@router.get("/api/practices/{email}/workspaces")
def get_practice_workspaces(email: str):
    """List every practice_drugs row for this practice that has at least one task,
    with the drug's brand_name and a simple done/total task count.
    Used by the 'View Tasks' toggle on /doctor/drugs."""
    # Resolve the practice.
    practice_resp = (
        supabase.table("practices")
        .select("id")
        .eq("email", email)
        .limit(1)
        .execute()
    )
    if not practice_resp.data:
        raise HTTPException(
            status_code=404,
            detail=f"No practice found for email {email}",
        )
    practice_id = practice_resp.data[0]["id"]

    # All practice_drugs rows for this practice.
    pd_resp = (
        supabase.table("practice_drugs")
        .select("id,application_id,status")
        .eq("practice_id", practice_id)
        .execute()
    )
    if not pd_resp.data:
        return []

    # Fetch all tasks for these practice_drug ids in one query.
    pd_ids = [row["id"] for row in pd_resp.data]
    tasks_resp = (
        supabase.table("tasks")
        .select("practice_drug_id,status")
        .in_("practice_drug_id", pd_ids)
        .execute()
    )

    # Group task counts by practice_drug_id; skip rows with zero tasks.
    counts: dict[int, dict] = {}
    for t in (tasks_resp.data or []):
        pid = t["practice_drug_id"]
        if pid not in counts:
            counts[pid] = {"total": 0, "done": 0}
        counts[pid]["total"] += 1
        if t["status"] == "done":
            counts[pid]["done"] += 1

    # Collect application_ids that need brand names.
    app_ids = [row["application_id"] for row in pd_resp.data if row["id"] in counts]
    if not app_ids:
        return []

    drugs_resp = (
        supabase.table("drugs")
        .select("application_id,brand_name")
        .in_("application_id", app_ids)
        .execute()
    )
    brand_by_app = {d["application_id"]: d["brand_name"] for d in (drugs_resp.data or [])}

    result = []
    for row in pd_resp.data:
        if row["id"] not in counts:
            continue
        result.append(
            {
                "practice_drug_id": row["id"],
                "application_id": row["application_id"],
                "status": row["status"],
                "brand_name": brand_by_app.get(row["application_id"], ""),
                "tasks_done": counts[row["id"]]["done"],
                "tasks_total": counts[row["id"]]["total"],
            }
        )
    return result


@router.get("/api/workspaces/by-role/{role}")
def get_workspaces_by_role(role: str):
    """List every practice_drugs workspace, across ALL practices, that has at
    least one task for this role. Unlike /api/practices/{email}/workspaces,
    this is not scoped to a single practice -- it backs the unauthenticated
    Nurse/Biller tabs, which have no session to scope by. Task counts are
    limited to this role's own tasks, not the workspace's full task list."""
    if role not in ("front_desk", "nurse", "biller"):
        raise HTTPException(status_code=400, detail=f"Unknown role {role}")

    tasks_resp = (
        supabase.table("tasks")
        .select("practice_drug_id,status")
        .eq("role", role)
        .execute()
    )
    if not tasks_resp.data:
        return []

    counts: dict[int, dict] = {}
    for t in tasks_resp.data:
        pid = t["practice_drug_id"]
        if pid not in counts:
            counts[pid] = {"total": 0, "done": 0}
        counts[pid]["total"] += 1
        if t["status"] == "done":
            counts[pid]["done"] += 1

    pd_resp = (
        supabase.table("practice_drugs")
        .select("id,application_id,status,practice_id")
        .in_("id", list(counts.keys()))
        .execute()
    )
    pd_rows = pd_resp.data or []
    if not pd_rows:
        return []

    app_ids = [row["application_id"] for row in pd_rows]
    drugs_resp = (
        supabase.table("drugs")
        .select("application_id,brand_name")
        .in_("application_id", app_ids)
        .execute()
    )
    brand_by_app = {d["application_id"]: d["brand_name"] for d in (drugs_resp.data or [])}

    practice_ids = [row["practice_id"] for row in pd_rows]
    practices_resp = (
        supabase.table("practices")
        .select("id,name")
        .in_("id", practice_ids)
        .execute()
    )
    name_by_practice = {p["id"]: p["name"] for p in (practices_resp.data or [])}

    result = [
        {
            "practice_drug_id": row["id"],
            "application_id": row["application_id"],
            "status": row["status"],
            "brand_name": brand_by_app.get(row["application_id"], ""),
            "practice_name": name_by_practice.get(row["practice_id"], ""),
            "tasks_done": counts[row["id"]]["done"],
            "tasks_total": counts[row["id"]]["total"],
        }
        for row in pd_rows
    ]
    result.sort(key=lambda r: r["brand_name"] or "")
    return result
