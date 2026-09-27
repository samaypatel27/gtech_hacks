"""Creating in-app notifications (the `notifications` table).

A notification is a heads-up with a link ("New drug: Pasatru", "Pasatru now
bills as J0289"); the task board stays where the work happens. Every message
has a `dedupe_key` that's unique per practice, so calling `notify` again for
the same event never creates a duplicate.

Notifications are a side effect: if creating one fails, the action that
triggered it (saving a drug, signing an order...) still succeeds.
"""

import logging
from typing import Optional

from core.db import supabase

log = logging.getLogger(__name__)


def notify(
    practice_id: int,
    kind: str,
    title: str,
    *,
    dedupe_key: str,
    body: Optional[str] = None,
    link: Optional[str] = None,
    role: str = "doctor",
    application_id: Optional[str] = None,
    treatment_id: Optional[int] = None,
) -> None:
    row = {
        "practice_id": practice_id,
        "role": role,
        "kind": kind,
        "title": title,
        "body": body,
        "link": link,
        "application_id": application_id,
        "treatment_id": treatment_id,
        "dedupe_key": dedupe_key,
    }
    try:
        supabase.table("notifications").upsert(
            row, on_conflict="practice_id,dedupe_key", ignore_duplicates=True
        ).execute()
    except Exception:  # never let a notification break the action that caused it
        log.exception("Could not create notification %s for practice %s", dedupe_key, practice_id)


def notify_every_practice(kind: str, title: str, *, dedupe_key: str, **fields) -> int:
    """The same message to every practice (e.g. a drug launch). Returns how many."""
    practices = supabase.table("practices").select("id").execute().data or []
    for practice in practices:
        notify(practice["id"], kind, title, dedupe_key=dedupe_key, **fields)
    return len(practices)
