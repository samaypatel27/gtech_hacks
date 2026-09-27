# LaunchReady: Status and Next Steps

**Sources:** BuildPlan.md is the target. ProductSpec2.md holds the product details and the demo story. MentorNotes.txt and SponsorPrompt.txt say how you'll be judged. These were compared against the code and the live Supabase data.

> ⚠️ **WhatIsMade.md is out of date.** It says there's no sign-up, no practices table and no tests, and all three now exist. Don't use it to plan. Parts of CLAUDE.md are also stale: it says 20 drugs are seeded, but the database has 5.

---

## Where you are

| Phase (BuildPlan §3) | Done | How good it is |
|---|---|---|
| **1. Drug engine** | ~80% | Strong. Live openFDA, CMS and Claude calls with citations. All 8 `billing_rules.py` functions exist and the 66 tests pass. **Gaps:** the pipeline never writes codes, `payer_policies` or distributors (only Pasatru has them, entered by hand), and CMS lookups match on brand name instead of NDC. |
| **2. Consider** | ~65% | Good foundation. NPI lookup, Google sign-in, the practice profile, pins, and 3 of the 4 lights are real. **Gaps:** the coverage light is always gray, even for Pasatru, which has `payer_policies`. The "Add patients to hold list" button does nothing (`DrugProfileDashboard.jsx:236`). "Notify me" and "talk to specialist" don't exist. No events are logged. |
| **3. Prepare** | ~60% | Works, and it's the templated fallback the plan allows. "Get my team ready" creates 4 tasks. Each role has its own board, and the boards refresh every 3s. **Gaps:** nothing ever writes `stock_on_hand` (0 rows have it), so no workspace can ever become "Ready to treat." There's also no purchasing card, invoice or hold list. |
| **4. Treat & Bill** | ~15% | **The heart of the demo, and not started.** The math in `billing_rules` is done and the `patients` and `treatments` tables exist, but both are empty and there are no endpoints or pages. |
| **5. Switch** | ~20% | `code_for()` (picks the billing code by date of service) is written and tested, and Pasatru already has J3590 → J0289 effective 2026-10-01. No UI or recoding yet. |
| **6. Pharma side** | ~25% | The drug maker's launch page works and the `pharma_summary` privacy view exists. But `events` has 0 rows because nothing writes to it, and there's no dashboard or help queue. |
| **7. Hardening + pitch** | ~5% | No demo reset script, no slides, no video, no Devpost write-up. |

### Other issues
- `TaskUpdate` still accepts `'in_progress'`, which the database constraint rejects, so that request fails with a 500.
- The task, workspace and `POST /api/drugs` endpoints have no login check. That's fine for a demo, but the Data Analytics SVP judging may ask about it.
- The pharma view that hides counts under 5 is your best compliance answer, so show it.

**Bottom line:** the plumbing and first-mile work is well done. What's missing is the payoff judges score: "Will we get paid?" (Treat & Bill), then Switch, then the pharma view.

---

## Demo drug

Use **Pasatru (BLA761508)** as the only demo drug. It's already fully set up: generic code J3590, permanent code J0289 from Oct 1, distributors, payer policies, and 100 mg single-dose vials.

Today is Sept 27, so the permanent code goes live in 4 days. That's a real Switch Day hook.

For the demo patient, pick about **68 kg**:
- Dose: 10 mg/kg → **680 mg**
- Vials: 7 × 100 mg, so **20 mg is wasted** and the claim gets the **JW modifier**. That shows the waste math live.

---

## Immediate next steps (4 people, per BuildPlan §8)

### 0:00–0:15 (everyone)
Freeze Prepare. Write the demo script: Consider → Prepare → Treat & Bill → Switch → pharma view.

### 0:15–2:45, three tracks at once

**A, backend (Treat & Bill), in `main.py`:**
1. A seed script for 1 practice and 3 patients, each with a visit note and weight.
2. `POST /api/treatments` (the order): calculate the dose with `dose_for` and the vials with `vial_mix`.
3. `POST /api/treatments/{id}/administer` (the nurse's record): `waste_modifier` and `admin_codes`.
4. `GET /api/treatments/{id}/claim`: builds the CMS-1500 fields with `code_for`, `units`, `item19` and the NDC, and runs the 8 checks from ProductSpec2 §7 step 11.

**B, AI + frontend (documentation check):**
- `POST /api/treatments/{id}/doc-check` using Claude with JSON output. It marks each requirement ✓/✗ with an exact quote from the note, and can draft missing text.
- A patient page with an editable note and the check sidebar. Deleting a line from the note should flip a check to ✗. ProductSpec2 calls this the most convincing moment you can show.

**C, frontend (nurse and claim screens):**
- The nurse form, prefilled from the order.
- A CMS-1500-style claim page with generated fields highlighted, the checks, and Export using the browser's print.

**D (quick wins, then pharma, then pitch):**
- ~20 min: Make the coverage light read `drugs.payer_policies` filtered to the practice's payers.
- ~15 min: Wire the hold list button or remove it.
- ~20 min: Add a `_log_event()` helper and call it from considering, team-ready, sign and export.
- ~45 min: Seed events for about 40 fake practices, plus a minimal dashboard that reads `pharma_summary`: a funnel, hesitation reasons, and a small help queue.
- From 2:30: Start the slides, following the BuildPlan §7 pitch outline.

### 2:45–3:30, Switch
- A date-of-service picker on the claim. Before Oct 1 it gives J3590 with units = 1; from Oct 1 it gives J0289 with units = dose ÷ billing unit.
- A "Simulate CMS update" button that marks treatments dated Oct 1 or later as `needs_recoding` and adds a banner plus a "Review hold list" board task.

### 3:30–4:00
Write the one-command demo reset script, do a full run-through, and fix what breaks. Nothing gets edited in the database by hand during the demo.

### 4:00–5:00
Record a backup video, finish the Devpost write-up, and rehearse answers on compliance and how Impiricus makes money (ProductSpec2 §4 and §10).

---

## Cut now (BuildPlan §7)

- AI invoice reading and merging the attachment PDFs
- AI-drafted tasks (keep the templates)
- Corrected claims (Item 22) and per-insurer switch dates
- Region map, "notify me," and the purchasing card details
- Re-seeding the other drugs

---

**Next:** start on Track A (the treatments endpoints and patient seed). It's the critical path and everything else depends on it.


