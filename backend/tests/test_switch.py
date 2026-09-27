"""Switch notice wording (switch/code_changes.code_notice), no database."""

from billing_rules import code_timeline
from switch.code_changes import code_notice

CODES = [
    {"code": "J3590", "type": "generic", "from": "2026-02-01", "to": "2026-09-30"},
    {"code": "J0289", "type": "permanent", "unit": "1 MG", "from": "2026-10-01"},
]


def test_countdown_before_the_switch():
    notice = code_notice("Pasatru", code_timeline(CODES, "2026-09-27"))
    assert notice["state"] == "upcoming" and notice["days_until_next"] == 4
    assert notice["message"].startswith("Pasatru moves to its permanent code J0289 on Oct 1, 2026 (in 4 days)")
    assert "units = dose ÷ 1 mg" in notice["message"] and "keep J3590" in notice["message"]


def test_since_notice_after_the_switch():
    notice = code_notice("Pasatru", code_timeline(CODES, "2026-10-02"))
    assert notice["state"] == "switched" and notice["changed_on"] == "2026-10-01"
    assert notice["message"].startswith("Since Oct 1, 2026, Pasatru bills as its permanent code J0289 instead of J3590")


def test_no_notice_long_after_the_switch_or_with_no_change():
    assert code_notice("Pasatru", code_timeline(CODES, "2027-03-01"))["state"] == "none"
    # A code that just ends, with nothing after it, has nothing to count down to.
    assert code_notice("X", code_timeline(CODES[:1], "2026-05-01"))["state"] == "none"
    only_generic = [{"code": "J3590", "type": "generic", "from": "2026-02-01"}]
    assert code_notice("X", code_timeline(only_generic, "2026-05-01"))["state"] == "none"
