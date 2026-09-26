# LaunchReady — Build Plan

This is the plan for building LaunchReady from scratch, in the same order a practice experiences it. See `ProductSpec2.md` for the full product details.

---

## 1. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **React + Vite + Tailwind + React Router** | Team knows it; fast to build |
| Backend | **Python (FastAPI)** | Team knows it; good for parsing CMS files, merging PDFs, date logic for code switches, and pytest for billing rules; first-class Claude SDK. API keys, billing rules and the patient-data boundary must live on a server anyway. |
| Database and files | **Supabase** (Postgres + Storage) | Tables plus file storage for invoices and attachments |
| AI | **Claude** with strict JSON output everywhere | Opus-class model for one-time extraction (drug labels, PDFs); a fast model for the interactive documentation check |
| Live updates | **Polling every 2–3 seconds** | Simpler and more reliable than realtime subscriptions for a demo |
| CMS-1500 | **On-screen HTML replica**, "Download PDF" via the browser's print; **pypdf** on the backend merges the attachment packet | Looks good, avoids heavy PDF libraries |
| Tests | **pytest** for `billing_rules.py` | The billing math must be correct |

---

## 2. The four stages of the product

From the practice's point of view, a new drug goes through four stages, each answering one question:

| # | Stage | The practice's question | What happens | Who |
|---|---|---|---|---|
| 1 | **Consider** | "Can we use this?" | NPI sign-up, four lights, adopt or hold | Doctor |
| 2 | **Prepare** | "Are we ready?" | Team board, purchasing, receiving and invoice | Whole team |
| 3 | **Treat & Bill** | "Will we get paid?" | Patient order and documentation check → nurse gives the drug → claim built and exported | Doctor, nurse, biller |
| 4 | **Switch** | "What now that the code is here?" | Permanent code goes live, claims switch, hold list comes back | Automatic, then doctor |

**Throughout:** the drug maker sees where practices are in these stages (the pharma dashboard).

**Pitch line:** "LaunchReady guides a practice through a new drug's first months, answering four questions: Can we use it? Are we ready? Will we get paid? And what happens when the permanent code arrives?"

### The team board is the practice's home screen
The board is created in Prepare, but it shows tasks from **every** stage, so the whole practice sees the automation happening:
- **Prepare:** "Buy DrugX", "Store at 2–8°C", "Review billing setup"
- **Treat & Bill:** "Buy DrugX for Maria's treatment", "Record Maria's infusion", "Claim ready for review"
- **Switch:** "2 claims need recoding", "Review hold list (3)"

**The team board *tells* people what to do. The claim builder (Treat & Bill) *does* the billing work.** Both matter; the board is where you see it happen.

---

## 3. Build phases, in journey order

| Build phase | Product stage | What it delivers |
|---|---|---|
| **0. Foundations** | — | App shell, role switcher, schema, seed data, API contracts, team split |
| **1. Drug engine** | Underneath all stages | Drug profiles and billing rules. Every stage reads from this. |
| **2. Consider** | Stage 1 | NPI sign-up, practice profile, four lights, decision actions |
| **3. Prepare** | Stage 2 | Team board (home screen), purchasing card, invoice upload, hold list |
| **4. Treat & Bill** | Stage 3 | Patient order, documentation check, nurse form, claim builder, export |
| **5. Switch** | Stage 4 | Effective-dated code switch, recoding, hold-list alert |
| **6. Pharma side** | Throughout | Events → aggregated dashboard, help requests |
| **7. Hardening + pitch** | — | Compliance touches, edge cases, demo reset, slides, video |

**Guiding rules**
- Each phase ends with a **working** result before moving on. Ugly but working beats polished but disconnected.
- **Time-box Prepare (Phase 3).** Treat & Bill holds the core billing automation and is where judges will focus. If Prepare runs over its time box, ship the simplest version (a checklist board and manual invoice entry) and come back later.
- In the demo, walk through the stages in journey order: Consider → Prepare → Treat & Bill → Switch → pharma view.

---

## 4. Phase details

### Phase 0: Foundations (~5% of time)
**Goal:** everyone can build in parallel without blocking each other.

**Decisions to lock**
- The stack above.
- **Demo drug:** a real drug currently on a generic code, plus one with a permanent code (for the "standard billing applies" edge case).
- **Demo scope:** Medicare (one contractor) plus one commercial insurer; one practice ("Patel Oncology").

**Build**
- Repo layout:
  - `frontend/` with a sidebar app shell and the **"Viewing as"** role switcher (Doctor / Nurse / Biller / Front desk / Pharma)
  - `backend/` split into files by area (`fda`, `cms`, `drugs`, `practices`, `patients`, `claims`, `pharma`) plus a pure-logic `billing_rules.py`
- **Database schema v1:** all tables created up front (see section 5).
- **API contracts:** a short list of endpoints with sample JSON, so frontend work can start against mock data.
- **Seed script:** one practice, a user per role, 3–5 hand-written patients, payers. It resets the database to a clean demo state in one command.

**Done when:** the shell loads, the role switcher works, and one test endpoint reads from Supabase.

---

### Phase 1: Drug engine (~15%)
**Goal:** turn an FDA application number into a complete, cited drug profile with correct billing rules.

**Backend: `POST /drugs/launch`** (all logic runs on the server):
1. Fetch the openFDA label, NDC and approval data, plus the DailyMed label document.
2. Claude extracts: dosing, infusion time, preparation, storage, single-dose flag, approved uses and required tests, with citations to label sections.
3. Parse packages: NDC 10 → 11 digits, strength in mg, vial size.
4. Codes: look up the CMS crosswalk **by NDC**, with **effective dates** from the HCPCS quarterly file. For drugs whose code is still pending, Claude reads the CMS HCPCS application summary PDF.
5. Save one `drugs` row, including the **packages** list and the **codes** list (each code with its start and end dates).

**`billing_rules.py`**: pure functions, each with pytest tests:
| Function | Does |
|---|---|
| `pick_generic_code(drug)` | J9999 (cancer) / J3590 (biologic) / J3490 |
| `ndc_10_to_11(ndc)` | 4-4-2 / 5-3-2 / 5-4-1 → 5-4-2 |
| `code_for(drug, payer, date_of_service)` | The right code on that date for that payer (**the Switch Day core**) |
| `units(dose, code)` | 1 for a generic code; dose ÷ billing unit for a permanent code |
| `waste_modifier(single_dose, waste)` | JW / JZ |
| `admin_codes(start, stop, is_chemo)` | 96413 / 96415 / 96409 / 96365 / 96374 |
| `vial_mix(dose, packages)` | Least-waste vial combination |
| `item19(drug, dose, route, ndc, cost)` | Item 19 text with an 80-character check |

**Frontend:** a minimal pharma "Launch drug" page showing the resulting profile and its sources.

**Done when:** launching the real demo drug produces a full cited profile, and all rule tests pass.

**Risk:** openFDA can lag on brand-new drugs, so save a snapshot of the demo drug's data as a fallback.

---

### Phase 2: Consider (~15%)
**Goal:** a doctor signs up and gets a clear, sourced "can my practice use this?" answer.

**Backend**
- **NPI sign-up:** NPPES API → name, specialty, state (→ Medicare contractor) → create practice.
- **Practice profile:** payers and capabilities (infusion chairs, refrigeration).
- **Insurer policies:** for the demo drug, Claude extracts coverage status, prior auth and documentation requirements from 1–2 insurer documents into the drug's `payer_policies`. (Fallback: enter by hand, labeled.)
- **`GET /practices/{id}/drugs/{id}/considering`** computes the **four lights** on the server:
  - **Coverage:** from insurer policies, filtered to the practice's payers.
  - **Billing path:** current code, what claims need, expected permanent date, and "we can draft these for you."
  - **Payment timing:** cost per dose × planned patients × typical delay, labeled as an estimate. Timing only, never profit.
  - **Workflow:** label requirements vs. practice capabilities.
- **Decision actions:** adopt, hold, notify me, talk to specialist. Each updates the practice's `practice_drugs` row and writes an **event**.

**Frontend**
- NPI sign-up screen.
- Home: launch-message inbox and drug search.
- **Considering page:** a one-line answer, four expandable lights with sources, action buttons.

**Done when:** a doctor signs up with a real NPI, opens the demo drug and sees correct lights with sources.

---

### Phase 3: Prepare (~10–15%, time-boxed)
**Goal:** the practice gets ready to handle the drug, and the team board becomes the practice's home screen.

**Build**
- **Team board (home screen):**
  - "Get my team ready" → the AI drafts tasks for each role from the drug profile:
    - **Front desk, purchasing:** distributors, vial sizes, least-waste mix, quantity for planned patients.
    - **Front desk, receiving:** storage, receiving checklist.
    - **Nurse:** preparation and administration steps; what to record.
    - **Biller:** "DrugX bills as J9999, units = 1," Item 19 template, NDC format, JW/JZ rule, invoice requirement, permanent-code date, payer notes.
  - Tasks can be checked off; the board polls for updates.
  - **Built so later phases can add tasks to it** (Treat & Bill and Switch add their own).
- **Purchasing card:** distributors (from the drug maker), NDCs, least-waste mix, order quantity.
- **Receiving and invoice:**
  - The invoice is uploaded to Supabase Storage.
  - Claude reads the lines (NDC, lot, quantity, cost); the user confirms.
  - Stock is recorded, and the NDC is checked against the drug's packages.
- **Hold list:** add patients from Considering; only a count is ever shared.

**Simplest acceptable version if the time box runs out:** a templated checklist board (no AI drafting) and manual invoice entry.

**Done when:** "Get my team ready" creates a board, the invoice is recorded as stock, and the hold list works.

---

### Phase 4: Treat & Bill (~25%)
**Goal:** the full Maria path, from patient to exported claim. **This is the core billing automation and the heart of the demo.**

**Backend**
- **Patients and notes:** create or pick a patient; paste or upload the visit note (text extracted from PDFs).
- **Order:** dose from weight × label; vial mix from `billing_rules`.
  - **No stock recorded?** Signing creates a "buy DrugX for this patient" task on the board.
- **Documentation check (AI, fast model):**
  - Compares the note against the approved-use requirements and the insurer's requirements.
  - Returns each item as ✓ / ✗ with the **exact quote**, plus a prior-auth flag.
  - **"Draft addition":** the AI writes the missing text → the doctor approves → the note is saved as a new version → the check re-runs.
  - Signing saves the order with its check results.
- **Administration:** date of service, dose given, vials (NDC, lot), start/stop times. Waste and administration codes come from the rules. Adds "record infusion" to the board, then marks it done.
- **Claim builder:**
  - Combines drug, code (by date of service and payer), order, administration, patient and practice into the full claim JSON.
  - Runs the **8 checks**.
  - Builds the attachment packet (invoice + label + signed note, merged with pypdf).
  - Status: `draft → ready → exported`. Adds "Claim ready for review" to the board.

**Frontend**
- **Patient chart** with the note box and **New Order**.
- **Documentation sidebar:** ✓ / ✗ with quotes, Draft addition, Sign. The live-edit moment must feel instant.
- **Nurse form:** prefilled; enter times; submit.
- **Claims page:** CMS-1500 replica with generated fields highlighted, "why this value" on hover, the 8 checks with Fix links, Export (print-to-PDF + packet).
- Polling so the claim updates after the nurse submits.

**Done when:** the full Maria story runs with no manual database edits.

---

### Phase 5: Switch (~10%)
**Goal:** handle the permanent code arriving, the way the mentor asked.

**Build**
- **"Simulate CMS update"** admin button: adds a new entry to the drug's `codes` list with its effective date (and closes the generic code's end date).
- **Date-of-service rule:** the claim builder picks the code by the date the drug was given, not the purchase or submission date.
  - Given before the switch → generic code, units = 1.
  - Given on or after → permanent code, units = dose ÷ billing unit (JW units recalculated the same way).
- **Recoding:**
  - Draft claims with dates on or after the switch → flagged **needs recoding**, then rebuilt.
  - Already-exported claims that used the wrong code → a **corrected claim** (Item 22 resubmission code 7).
- **Per-insurer effective dates:** commercial insurers can lag, so each can have its own date.
- **Codes that change more than once or change their billing unit:** handled as new effective-dated rows.
- **Alerts:** banner "DrugX now has J9xxx, effective Oct 1"; board tasks "N claims need recoding" and "Review hold list (3)."

**Done when:** simulating an update recodes claims correctly by date of service, and the hold-list alert appears.

---

### Phase 6: Pharma side (~10%)
**Goal:** show value to the drug maker and the new data asset for Impiricus.

**Build**
- The **`events` table**, filled during Phases 2–5, plus a **seed of ~40 fake practices** across regions.
- **Database view `pharma_summary`:** opted-in practices only, grouped by region and specialty, **counts under 5 hidden**.
- **Dashboard:**
  - funnel (viewed → adopted → started → stuck)
  - region map or list
  - hesitation reasons (which light was yellow)
  - top snags with "send guidance"
  - help-request queue with "assign specialist"
- **Get help** (clinic side): a preview with patient details removed → send → appears in the queue.
- The Phase 1 launch-drug page moves into the pharma section.

**Done when:** the dashboard reads only the aggregated view, and a help request from the clinic shows up in the queue.

---

### Phase 7: Hardening and pitch (~10–15%)
**Hardening**
- **Compliance touches:** `events` entries for view, sign and export (the audit trail); backend checks that every request only touches its own practice; a data-sharing toggle in practice settings.
- **Edge cases:** a drug that already has a permanent code ("standard billing applies"); openFDA down (use the snapshot); AI call failure (clear error + retry).
- **Labels on everything mocked:** launch message, distributors, dashboard numbers.
- **One-command demo reset.**
- Loading and empty states; consistent design.

**Pitch** (start before the build is finished)
- Slides: the problem → the four questions → live demo → data flow and compliance → why it makes Impiricus money.
- Backup demo video, Devpost write-up, rehearsal with likely questions.

---

## 5. Database

**8 tables, 1 view and 2 config files**, grouped into the three data tiers.

```
PUBLIC                PRACTICE WORKSPACE (patient data)              PHARMA SIGNALS
┌──────────┐     ┌────────────┐   ┌────────────────┐           ┌──────────┐
│  drugs   │◄────│ practices  │──►│ practice_drugs │──► tasks  │  events  │──► view: pharma_summary
└──────────┘     └────────────┘   └────────────────┘     ▲     └──────────┘   (aggregated, opt-in,
      ▲               │                                   │     ┌───────────────┐  counts under 5 hidden)
      │               └──► patients ──► treatments ───────┘     │ help_requests │
      └──────────────────────────────────┘                      └───────────────┘
config/: payers.json + claim_rules.json
```

### Two kinds of "order" (don't mix them up)
| | "Get my team ready" | A patient order |
|---|---|---|
| **Meaning** | "Our practice is adopting DrugX" | "Give Maria 500 mg of DrugX" |
| **How often** | **Once** per practice per drug | **Many times**, once per patient per dose |
| **Stage** | Prepare | Treat & Bill |
| **Stored in** | `practice_drugs` (status becomes adopting) + setup rows in `tasks` | `treatments` |

(The purchase from the distributor is a third kind of "order"; it's stored as invoices and stock on `practice_drugs`.)

### Where information lives
Each fact lives where it belongs, and task cards store instruction text written from those facts:
- **Facts about the drug** (storage, preparation, billing code, units rule) → `drugs`, the single source of truth, with citations.
- **Facts about this practice's use of the drug** (planned patients, vial quantities, invoices, stock) → `practice_drugs`.
- **Facts about one patient's treatment** (Maria's dose, vials, infusion times) → `treatments`.
- **Task cards** → `tasks` stores the **instruction text** (AI-written from those facts, e.g. "Refrigerate at 2–8°C on arrival") plus a link back to the source, so cards show instantly without recalculating.

### Tier 1: Public reference data (no restrictions)

- **`drugs`: everything public about a drug**
  - *Used in:* every stage. It's the reference everything else reads from.
  - *What it does:* holds the FDA label facts (dosing, typical dose, infusion time, storage, preparation, single-dose flag, approved uses with required tests), whether it's a cancer drug, **vial sizes and NDCs** (JSON), **billing codes with their start and end dates** (JSON; this drives Switch), **insurer coverage per payer** (JSON), distributors (JSON), cost per dose, and a citation for every fact.
  - *Written by:* the drug maker's "Launch drug" step; the app fetches and extracts everything automatically. Switch adds a new entry to the codes list.
  - *Example `codes` value:* `[{code:"J3490", type:"generic", from:"2026-02-03", to:"2026-09-30"}, {code:"J0644", type:"permanent", unit:"1 mg", from:"2026-10-01"}]`

### Tier 2: Practice workspace (patient data; only that practice can see it)

- **`practices`: one row per clinic**
  - *Used in:* sign-up, and anywhere the app personalizes an answer.
  - *What it does:* holds the NPI, doctor's name, specialty, state (sets the Medicare contractor), the practice's insurers, capabilities (infusion chairs, refrigeration), and whether it agreed to share signals with pharma.

- **`practice_drugs`: one row per practice per drug**
  - *Used in:* **Consider** and **Prepare**.
  - *What it does:*
    - tracks the practice's status with the drug (considering → holding or adopting → active)
    - saves the four lights shown when they decided
    - stores planned patients per month
    - holds the **hold list** (waiting patients), **invoices** (file path, distributor, lines of NDC / lot / quantity / cost) and **stock on hand**
  - *Written when:* the doctor opens the drug (created), clicks "Get my team ready" (status becomes adopting), holds patients, or staff upload an invoice.

- **`tasks`: the team board (the practice's home screen)**
  - *Used in:* **Prepare**, **Treat & Bill** and **Switch**.
  - *What it does:* one row per to-do card: the role it's for, the stage, the **instruction text**, and its status.
  - *Linked to:* always a `practice_drugs` row; sometimes a specific `treatments` row (e.g. "Record Maria's infusion").
  - *Written when:*
    - "Get my team ready" creates the setup tasks
    - a signed order creates "buy for this patient" (if no stock) and "record infusion"
    - a finished claim creates "claim ready for review"
    - Switch creates "claims need recoding" and "review hold list"

- **`patients`: the practice's patients**
  - *Used in:* **Treat & Bill** (and the hold list).
  - *What it does:* holds demographics, weight (for the dose), insurance and member ID (for coverage and the claim), diagnosis, and the **current visit note** the documentation check reads.

- **`treatments`: one row per dose given, from order to claim**
  - *Used in:* **Treat & Bill** and **Switch**.
  - *What it does:* one row moves through the whole flow:
    - **Doctor's order:** dose, vial mix, documentation check results with quotes, a copy of the note at signing, signed time.
    - **Nurse's record:** date of service, dose given, vials used (NDC, lot), waste, start and stop times.
    - **Claim:** every CMS-1500 field, the 8 check results, which code was used, and earlier versions if it was corrected.
    - **Status:** ordered → signed → administered → claim ready → exported → needs recoding.
  - *Why one table:* it's always one patient, one dose, one claim.
  - *Switch uses it:* "treatments for this drug with a date of service on or after the switch date" → rebuild their claims.

### Tier 3: Signals to pharma

- **`events`: the activity log**
  - *Used in:* every stage; feeds the **pharma dashboard** and the **audit trail**.
  - *What it does:* records every meaningful action (viewed drug, lights shown, adopted, held, signed, exported, claim returned) with the practice's region and specialty.
  - **Pharma never reads this table directly.**

- **View `pharma_summary`**
  - *Used in:* the pharma dashboard, and nothing else.
  - *What it does:* includes only opted-in practices, groups by drug, region and specialty, and hides counts under 5. **This view is the privacy boundary.**

- **`help_requests`: the "Get help" queue**
  - *Used in:* any stage, when a practice asks the drug maker for help.
  - *What it does:* holds the issue with patient details removed, and the practice's name (shared because they chose to send it). The drug maker marks it assigned or resolved, so it needs its own status.

### Config files (not tables)
- **`payers.json`:** Medicare (plus contractor) and one commercial insurer.
- **`claim_rules.json`:** units rule, what goes in Item 19, invoice requirement, JW/JZ rules, each with a citation.

### Which table is written at each step (Maria's story)
| Step | What happens | Table written |
|---|---|---|
| Drug maker launches DrugX | Profile, codes and coverage built | `drugs` |
| Dr. Patel signs up with her NPI | Practice created | `practices` |
| She opens DrugX | Four lights shown | `practice_drugs` (created), `events` |
| She holds 3 patients, then clicks "Get my team ready" | Status becomes adopting; setup tasks created | `practice_drugs`, `tasks`, `events` |
| Front desk uploads the invoice | Stock recorded; purchasing task done | `practice_drugs`, `tasks` |
| She orders DrugX for Maria; note checked; signed | Order with check results; board tasks created | `treatments`, `tasks`, `events` |
| Nurse records the infusion | Waste and codes calculated | `treatments`, `tasks` |
| Claim built and exported | Claim and checks saved | `treatments`, `tasks`, `events` |
| Permanent code arrives | New code added; claims flagged for recoding | `drugs`, `treatments`, `tasks` |
| Clinic clicks Get help | Queue entry | `help_requests` |
| Drug maker opens the dashboard | Reads the summary view only | `pharma_summary` (over `events`) |

**Tradeoff:** JSON columns aren't validated by the database. That's fine because they're always read with their parent row and the rules run in Python. Data queried across many rows (`events`, `treatments`) stays in real tables.

**Compliance note:** documentation checks send patient notes to the AI provider. In production, that provider must also be under a BAA.

---

## 6. External data sources

| Source | How it works | Used for |
|---|---|---|
| **openFDA** (`api.fda.gov`) | Free JSON API: `/drug/label.json`, `/drug/ndc.json`, `/drug/drugsfda.json`. No key needed at low volume; get the free key for a higher daily limit. Very new drugs can lag. | Label facts, NDCs, approval data |
| **DailyMed** (NLM) | Free API for official label documents and images | Label document for the attachment packet; images |
| **NPPES NPI Registry** | Free, no key: `npiregistry.cms.hhs.gov/api/?version=2.1&number=…` | Doctor verification, specialty, state |
| **CMS ASP NDC–HCPCS crosswalk** | Quarterly download | NDC → permanent code, billing units (match by NDC) |
| **CMS HCPCS quarterly update file** | Quarterly download with added / effective dates | When permanent codes take effect (Switch Day) |
| **CMS HCPCS application summaries** | Quarterly PDFs | Pending codes and expected dates (Claude reads them) |
| **Insurer policies** | Web pages or PDFs, no API | Coverage light, prior-auth flags (Claude extracts 1–2) |
| Demo patients | Hand-written seed data (3–5 patients) | Easier to control than Synthea |

---

## 7. What to cut if time runs short

| Must have | Nice to have (cut in this order) |
|---|---|
| Phase 1 engine + rule tests | Pharma launch-page polish |
| Considering with four lights | AI extraction of insurer policies (enter by hand) |
| Team board (templated is fine) | AI-drafted board tasks (use templates) |
| Documentation check + draft | AI invoice reading (enter lines by hand) |
| Nurse form + claim builder + checks | Purchasing card details |
| Switch (simulated) | Audit-trail events, region map |
| Minimal pharma dashboard | |

---

## 8. Team split (4 people)

| Person | Track |
|---|---|
| **A: Backend data and rules** | Phase 0 schema and seed, Phase 1 engine, `billing_rules` + tests, claim builder, Switch logic |
| **B: AI** | Label extraction, insurer policies, board-task drafting, invoice reading, documentation check and drafting (prompts and output formats) |
| **C: Frontend, practice screens** | App shell, team board, receiving, patient chart, documentation sidebar, nurse form, CMS-1500 screen |
| **D: Frontend, decision and pharma, then pitch** | Sign-up, Considering, hold list, pharma dashboard, design consistency, then slides and video |

Agreeing on API contracts in Phase 0 lets the frontend build against mock data from the start.

---

## 9. Still to decide
- **Submission deadline and realistic build hours**, to turn the percentages into clock-time checkpoints.
- **Team size and strengths**, to confirm the split above.
- **The demo drug** (verify its code status and dates in the CMS files).
