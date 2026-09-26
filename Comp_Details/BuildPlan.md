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
5. Save `drugs`, `drug_packages` and **`drug_codes` (effective_from / effective_to)**.

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
- **Insurer policies:** for the demo drug, Claude extracts coverage status, prior auth and documentation requirements from 1–2 insurer documents into `payer_drug_policies`. (Fallback: enter by hand, labeled.)
- **`GET /practices/{id}/drugs/{id}/considering`** computes the **four lights** on the server:
  - **Coverage:** from insurer policies, filtered to the practice's payers.
  - **Billing path:** current code, what claims need, expected permanent date, and "we can draft these for you."
  - **Payment timing:** cost per dose × planned patients × typical delay, labeled as an estimate. Timing only, never profit.
  - **Workflow:** label requirements vs. practice capabilities.
- **Decision actions:** adopt, hold, notify me, talk to specialist. Each writes `drug_adoptions` and an **event**.

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
- **"Simulate CMS update"** admin button: inserts a new `drug_codes` row with its effective date.
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
- **Database view `pharma_drug_summary`:** opted-in practices only, grouped by region and specialty, **counts under 5 hidden**.
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
- **Compliance touches:** `audit_log` entries for view, sign and export; backend checks that every request only touches its own practice; a data-sharing toggle in practice settings.
- **Edge cases:** a drug that already has a permanent code ("standard billing applies"); openFDA down (use the snapshot); AI call failure (clear error + retry).
- **Labels on everything mocked:** launch message, distributors, dashboard numbers.
- **One-command demo reset.**
- Loading and empty states; consistent design.

**Pitch** (start before the build is finished)
- Slides: the problem → the four questions → live demo → data flow and compliance → why it makes Impiricus money.
- Backup demo video, Devpost write-up, rehearsal with likely questions.

---

## 5. Database (three data tiers)

**Tier 1: Public reference data** (no restrictions)
| Table | Key columns |
|---|---|
| `drugs` | application_id, brand/generic name, approval date, route, dosing, typical dose, infusion minutes, preparation, storage, single-dose flag, approved uses (JSON), is_antineoplastic, citations, sponsor |
| **`drug_codes`** | application_id, payer (blank = Medicare), code, NOC or permanent, billing unit, **effective_from, effective_to**, citation |
| `drug_packages` | application_id, NDC-10, NDC-11, strength (mg), vial size, single-dose flag |
| `payers` | name, Medicare or commercial |
| `payer_drug_policies` | payer, drug, coverage status, prior auth required, documentation requirements (JSON), source link, date retrieved |
| `drug_distributors` | drug, distributor name and link (from the drug maker) |
| *Claim rules* | A config file with citations, not a table |

**Tier 2: Practice workspace** (patient data; only that practice can see it)
| Table | Key columns |
|---|---|
| `practices` | NPI, name, specialty, state, Medicare contractor, capabilities, payers, share-with-pharma choice |
| `users` | practice or drug maker, role, NPI |
| `drug_adoptions` | practice × drug: status (considering / adopting / holding / active), lights at decision time, planned patients per month |
| `hold_list` | practice, drug, patient, date |
| `tasks` | practice, drug, stage, role, title, details, status, patient (optional), created by (AI / automatic) |
| `invoices` | practice, file, distributor, lines (NDC, lot, quantity, unit cost), AI-extracted flag |
| `patients` | practice, name, date of birth, sex, weight, payer, member ID, diagnosis |
| `notes` | patient, author, text, version |
| `orders` | patient, drug, dose, route, frequency, status, documentation check results (items with quotes), signed by (NPI) |
| `administrations` | order, **date of service**, dose given, vials used (NDC, lot), waste, start and stop times |
| `claims` | administration, payer, status (draft / ready / exported / returned / needs recoding), claim JSON, check results, code used, replaces claim |
| `help_requests` | practice (named by consent), drug, payer, issue type, summary with patient details removed, status |
| `audit_log` | who, what, which record, when |

**Tier 3: Signals to pharma**
| Table / view | Key columns |
|---|---|
| `events` | drug, practice region and specialty, event type, time |
| View `pharma_drug_summary` | Aggregated by drug and region; opted-in practices only; counts under 5 hidden. **The only thing the pharma dashboard reads.** |

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
| Switch (simulated) | Audit log, region map |
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
