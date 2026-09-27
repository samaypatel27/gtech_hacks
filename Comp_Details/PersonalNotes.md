# Personal Notes: Treat & Bill (my part)

Treat & Bill starts when the drug is **Ready to treat** and the doctor starts a patient. It ends when the claim is paid (or fixed and resubmitted). Everything here is per patient, per dose, and it all lives on one `treatments` row.

---

## The full flow

```
Ready to treat
   │
   ▼
0. Order + documentation check + sign  (doctor, AI-assisted)   ← comes FIRST, before the nurse
   │
   ▼
   Nurse prepares + gives the drug, saves the treatment record
   │
   ▼
1. Build claim ─► 2. Check & fix ─► 3. Review & export ─► 4. Insurer responds ─► 5. Paid / fix & resubmit
   (automatic)      (automatic +       (biller)              (simulated in demo)
                     loop back)
                                          ── meanwhile ── 6. Switch (Oct 1)   7. Pharma sees it all
```

### 0. Order + documentation check + sign (doctor, before the nurse)
- **Start patient:** the doctor picks a patient (e.g. Maria from the hold list) → **New order** → the **dose** is calculated from weight × label dose, and the **least-waste vial mix** is chosen (both from `billing_rules`). This **creates the `treatments` row** that every later step fills in.
- **Documentation check (AI):** reads `patients.visit_note` and compares it to the drug's **approved uses** (`drugs.approved_uses_and_conditions`) and the **insurer's requirements** (`drugs.payer_policies[].documentation_requirements`). Returns a checklist: ✓/✗ per item, with the **exact quote** from the note.
- **Draft addition (AI):** for each ✗, the AI writes the missing text → the doctor edits or approves → it's added to the note → the check re-runs.
- **Diagnosis code (AI suggests, doctor confirms):** the ICD-10 code for box 21.
- **Sign:** saves a copy of the note, the check results and the confirmed codes; status becomes **signed**. If the insurer requires prior auth (James/BCBS) → a **"Get prior auth"** task goes to the biller.
- **Saved to `treatments`:** `ordered_dose`, `dose_unit`, `vial_mix`, `documentation_check`, `signed_note`, `signed_at`, `diagnosis_codes` (column to add), `status = signed`. The approved text is also saved back to `patients.visit_note`.
- **Why it's first:** it prevents the most expensive denial ("not medically necessary"), and it's the doctor-facing AI centerpiece of the demo.
- **The claim builder never calls AI.** It only reads what this step saved.

### 1. Build the claim (automatic, the moment the nurse saves)
- **Code for that date and insurer:** J3590 before Oct 1, J0289 on or after.
- **Units:** 1 on a generic code, dose ÷ billing unit on a permanent code.
- **Drug line + JW waste line** (or JZ if nothing was wasted).
- **NDC** in 11-digit format, **Item 19** text (drug, dose, route, NDC, price) with the 80-character check.
- **Infusion code** from the start and stop times.
- **Diagnosis code:** read from `treatments.diagnosis_codes` (confirmed in step 0).
- **Attachments bundle:** invoice, FDA label, signed note.

**AI vs code:** all plain, tested code (`billing_rules.py`). **No AI in this step.**

### 2. Check and fix (automatic, with a loop back)
- The **8 checks** run:
  1. Item 19 drug details complete
  2. NDC is 11-digit and matches the invoice
  3. Units correct for the code type and insurer
  4. JW/JZ applied correctly
  5. Diagnosis matches an approved use (from step 0)
  6. Documentation complete (from step 0)
  7. Infusion code matches the start/stop times
  8. Attachments ready, and prior auth on file if required
- Anything red shows **who needs to fix it and links them there**. For example, a missing stop time sends "Add stop time for Maria's infusion" back to the nurse's column. When it's fixed, the claim rebuilds.
- This is the "catch it before it gets denied" moment.

### 3. Biller review and export
- The biller opens the **claim page**: CMS-1500 with the app's fields highlighted, "why this value" on hover, all checks green.
- **Export for clearinghouse:** download the CMS-1500 PDF and the attachments bundle. This is the "next" button the teammates were picturing.
- Status becomes **exported**.

### 4. The insurer responds (simulated in the demo)
- In real life, the response comes back through the clearinghouse days or weeks later: **paid**, **returned** (missing info) or **denied** (with a reason code).
- For the demo: a **"Simulate insurer response"** control on the claim page (Paid / Returned / Denied + reason). Be upfront about this in the pitch; connecting to real clearinghouses is future work.

### 5. Paid, or fix and resubmit
- **Paid:** the tracker shows Maria's dose as complete ✓.
- **Returned or denied:**
  - **AI explains the reason in plain English** and suggests the fix.
  - One click builds a **corrected claim**, marked on the CMS-1500 as a replacement of the original (resubmission code 7).
  - If they're stuck: **Get help** sends the issue, with patient details removed, to the drug maker's reimbursement specialist.

### 6. Switch (runs alongside, per drug)
- On Oct 1 the new code takes effect. Draft claims for doses given on or after that date get **flagged and rebuilt** automatically. The biller gets "N claims need recoding," and the doctor gets "Review hold list."

### 7. Pharma sees it all (runs alongside)
- Every step logs an event (`order_signed`, `administered`, `claim_ready`, `claim_exported`, `claim_returned`, `help_requested`). The drug maker's dashboard shows **where practices get stuck**.
- Not its own branch: the `log_event` helper is built once, and every step calls it.

---

## Demo patients (seeded by Sawan: `backend/scripts/seed_patients.py`)
Demo drug **Pasatru** (BLA761508): 10 mg/kg, 100 mg single-dose vials.
| Patient | Insurer | What it shows |
|---|---|---|
| **Maria Lopez** | Medicare (covered) | Complete note; 68 kg → 680 mg → 7 vials, **20 mg waste → JW line** |
| **James Carter** | BCBS (**prior auth required**) | Note **missing the ACVR1 genetic confirmation** → the documentation check finds a gap and drafts it |
| **Aisha** | Aetna (policy under review) | Complete note; 70 kg → 700 mg → **no waste → JZ** |

---

## What's real vs. simulated in the demo
| Phase | Demo |
|---|---|
| 0 Order + documentation check + sign | **Real** (AI) |
| 1–3 Build, check, export | **Real** |
| 4 Insurer response | **Simulated** (button) |
| 5 Fix and resubmit | Real logic, triggered by the simulated response |
| 6 Switch | Real logic, triggered by "simulate CMS update" |
| 7 Pharma dashboard | Real events plus seeded practices |

---

## Branches and build order

**Base:** `tb/base`, branched from `main` after the teammates merge. Sub-branches are named `tb/<part>`. (Git doesn't allow a branch named `tb` alongside `tb/...`, so the parent is `tb/base`.)

| # | Branch | Contains | Depends on |
|---|---|---|---|
| — | **`tb/base`** (do first, small) | Shared foundation: `log_event` helper, a `create_task` helper (with `waits_on`), commit the planning docs | — |
| 1 | **`tb/order-doc-check`** | Phase 0: create order (dose, vial mix) → documentation check → draft addition → diagnosis-code suggestion → sign → "Get prior auth" task | `tb/base` |
| 2 | **`tb/claim-engine`** | Phases 1–2 (+ phase 7 events): placeholder nurse endpoint → `load_claim_context` → `build_claim` → 8 checks → save → "Claim ready" / fix tasks | `tb/base` (tests use a hand-filled documentation check, so it doesn't wait on #1) |
| 3 | **`tb/claim-page`** | Phases 3–5: claim page, export, simulated insurer response, corrected claims | #2 (can start earlier against a sample claim JSON) |
| 4 | **`tb/switch`** | Phase 6: recoding on Oct 1, hold-list alert | #2 |

- **Commit after every phase inside a branch**, so each step is saved and easy to undo.
- Merge each finished branch into `tb/base`; `tb/base` → `main` when ready.
- **Time-box #1.** AI tuning can drag. If it does, #2 continues anyway using hand-filled documentation data.

### Steps for `tb/claim-engine` (worked out earlier)
0. Read `billing_rules.py` fully to confirm function signatures.
1. Config files: `claim_rules.json` (per-insurer rules) and `fee_schedule.json` (box 24F charges).
2. `load_claim_context(treatment_id)`: follows the links across 5 tables once, returns one object, checks the patient's practice = the workspace's practice, treats not-yet-added columns as empty.
3. `build_claim(context)`: pure function → claim JSON keyed by box number + line items, each field recording its source ("why this value").
4. `run_checks(context, claim)`: the 8 checks, each with passed/failed, message, and who fixes it and where.
5. Save: `treatments.claim`, `claim_checks`, `billing_code`; previous version → `claim_versions`; status `claim_ready` if all pass; create "Claim ready for review" or fix tasks; log `claim_ready`.
6. Endpoints: `POST /api/treatments/{id}/claim`, `GET /api/treatments/{id}/claim`, and the placeholder `PATCH /api/treatments/{id}/administration` (saves the nurse's fields, then builds).
7. pytest cases, no database: before vs. after Oct 1, waste vs. none, 45- vs. 95-minute infusion, cancer vs. not, two vial sizes, missing stop time.
8. Try it end to end with Maria via `/docs`.

**To verify, not assume:** how Medicare wants the JW waste line reported on a generic (J3590) code (units, and whether the wasted amount also goes in the description).

---

## Working in parallel (two sessions)

- **What can run at the same time:** #1 `tb/order-doc-check` and #2 `tb/claim-engine`. They only connect through saved fields in `DataContract.md`. #3 and #4 come after #2.
- **How:** Git **worktrees**, one folder per branch, each with its own Claude session:
  ```powershell
  git worktree add ../HackGT2026-doccheck -b tb/order-doc-check tb/base
  git worktree add ../HackGT2026-claim    -b tb/claim-engine   tb/base
  ```
  Open each folder in its own VS Code window and start Claude there. Remove a worktree when merged: `git worktree remove ../HackGT2026-claim`.
- **Before creating worktrees:**
  - commit the planning docs to `tb/base` (uncommitted files don't show up in new worktrees)
  - build the shared helpers on `tb/base` (`log_event`, `create_task`) so both branches don't write their own
  - make sure the database fixes from `DataContract.md` §8 are applied (`diagnosis_codes`, `prior_auth`, `payer_response`, practice address/tax ID, new task kinds and statuses)
- **In each worktree:**
  - copy `backend/.env` (and `frontend/.env` if needed); set up its own `venv`
  - run servers on different ports (e.g. 8001) if running both at once
  - each branch puts its code in **its own backend file** (`orders.py` / `doc_check.py` for #1, `claims.py` for #2) using FastAPI's `APIRouter`, and only adds one `include_router` line to `main.py`, to avoid merge conflicts
- **Shared database:** both sessions use the same Supabase. Don't change columns from one session without telling the other.
- **Tell each session at the start:** its branch, to read `PersonalNotes.md` and `DataContract.md`, which file it owns, and not to touch the other branch's files.
