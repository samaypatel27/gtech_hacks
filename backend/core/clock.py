"""What "today" is, for anything date-dependent (billing-code switches).

Set DEMO_TODAY=YYYY-MM-DD in backend/.env to make the app behave as if it's
another day -- e.g. DEMO_TODAY=2026-10-02 to demo the state after a drug's
permanent code takes effect, without waiting for the real date.
"""

import os
from datetime import date

from dotenv import load_dotenv

load_dotenv()


def today() -> date:
    override = os.getenv("DEMO_TODAY", "").strip()
    return date.fromisoformat(override) if override else date.today()
