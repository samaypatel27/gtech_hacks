"""The notification inbox (the bell): list, mark read, mark all read.

Scoped to the signed-in practice via `current_practice`, like the other
per-practice endpoints. `role` picks whose messages to show; the doctor's
bell asks for role=doctor.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from core.auth import current_practice
from core.db import supabase
from switch.code_changes import notify_code_changes

router = APIRouter()

ROLES = ("doctor", "front_desk", "nurse", "biller")


def _check_role(role: str) -> None:
    if role not in ROLES:
        raise HTTPException(status_code=400, detail=f"Unknown role {role}")


@router.get("/api/notifications")
def list_notifications(role: str = "doctor", limit: int = 30, practice: dict = Depends(current_practice)):
    _check_role(role)
    notify_code_changes(practice["id"])
    rows = (
        supabase.table("notifications")
        .select("*")
        .eq("practice_id", practice["id"])
        .eq("role", role)
        .order("created_at", desc=True)
        .order("id", desc=True)
        .limit(max(1, min(limit, 100)))
        .execute()
        .data
        or []
    )
    unread = (
        supabase.table("notifications")
        .select("id", count="exact")
        .eq("practice_id", practice["id"])
        .eq("role", role)
        .is_("read_at", "null")
        .execute()
    )
    return {"notifications": rows, "unread_count": unread.count or 0}


@router.post("/api/notifications/{notification_id}/read")
def mark_read(notification_id: int, practice: dict = Depends(current_practice)):
    response = (
        supabase.table("notifications")
        .update({"read_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", notification_id)
        .eq("practice_id", practice["id"])  # another practice's id 404s like a missing one
        .is_("read_at", "null")
        .execute()
    )
    if not response.data:
        exists = (
            supabase.table("notifications")
            .select("id")
            .eq("id", notification_id)
            .eq("practice_id", practice["id"])
            .execute()
            .data
        )
        if not exists:
            raise HTTPException(status_code=404, detail=f"No notification {notification_id}")
    return {"ok": True}


@router.post("/api/notifications/read-all")
def mark_all_read(role: str = "doctor", practice: dict = Depends(current_practice)):
    _check_role(role)
    response = (
        supabase.table("notifications")
        .update({"read_at": datetime.now(timezone.utc).isoformat()})
        .eq("practice_id", practice["id"])
        .eq("role", role)
        .is_("read_at", "null")
        .execute()
    )
    return {"marked": len(response.data or [])}
