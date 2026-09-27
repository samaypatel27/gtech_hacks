"""Rules for board tasks shared by the workspace and Treat & Bill: role labels,
"waiting on" dependencies, and which tasks only their own page may complete."""

from fastapi import HTTPException

from core.db import supabase


ROLE_LABELS = {"doctor": "Doctor", "front_desk": "Front Desk", "nurse": "Nurse", "biller": "Biller"}


def task_label(task: dict) -> str:
    return f"{task['title']} ({ROLE_LABELS.get(task['role'], task['role'])})"


def waiting_on_labels(task: dict, tasks_by_id: dict[int, dict]) -> list[str]:
    """Labels of the tasks in `waits_on` that aren't done yet -- the card's
    "Waiting on: ..." line. Empty means the task can be worked on now. A
    dependency that no longer exists doesn't block."""
    return [
        task_label(tasks_by_id[dep])
        for dep in (int(d) for d in task.get("waits_on") or [])
        if dep in tasks_by_id and tasks_by_id[dep]["status"] != "done"
    ]


def raise_if_waiting(task: dict) -> None:
    """409 "Waiting on: ..." while any task in `waits_on` is unfinished."""
    if not task.get("waits_on"):
        return
    deps_resp = (
        supabase.table("tasks")
        .select("id,title,role,status")
        .in_("id", [int(d) for d in task["waits_on"]])
        .execute()
    )
    waiting_on = waiting_on_labels(task, {t["id"]: t for t in deps_resp.data or []})
    if waiting_on:
        raise HTTPException(status_code=409, detail=f"Waiting on: {', '.join(waiting_on)}")


# Per-patient cards finished by their own page's endpoint (signing, the nurse
# record, exporting the claim) rather than by moving the card to Complete, so
# the card can never say done while the treatment row says otherwise.
PAGE_COMPLETED_KINDS = {
    "order_sign": "Sign the order on the patient chart",
    "prep_dose": "Save the preparation on the treatment record",
    "give_infusion": "Save the administration on the treatment record",
    "claim_review": "Export the claim from the claim page",
}
