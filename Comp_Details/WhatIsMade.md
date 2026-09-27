# What's Made So Far + What's Next

**As of:** Sat Sep 26, ~4:50pm. Branch `workspace-UI` (commit `fc92197`), which is `main` (including Sawan's pinning) plus Samay's 2 workspace commits. Not merged into `main` yet.

**Legend:** ✅ done · 🟡 partly done · ❌ not started · 🆕 = changed in this round

---

## What's new this round
- **The team workspace was rebuilt** (Samay), following `WorkspacePlan.md` Layers 0–1:
  - **three role columns** (Front Desk / Nurse / Biller)
  - a **readiness meter** ("N of 4 tasks complete" plus Stock / Nurse / Billing bars)
  - a **billing-code timeline** ("Now: J3590 → Oct 1: J0289, we will switch for you")
  - a read-only **doctor strip** (planned patients, hold-list count)
  - **card states** (locked / to do / done), with **Receiving locked until Purchasing is done**
  - **auto-refresh every 3 seconds**, so the whole team sees changes
  - a **"Ready to treat" banner**
- **A new save endpoint for tasks:** saves status *and* inputs, then **recalculates readiness**. When all tasks are done and there's stock on hand, the practice's status becomes **active**; if something is undone, it goes back.
- **The duplicate-tasks bug is fixed:** clicking "Get my team ready" again just opens the existing workspace.
- **Failed saves are now caught:** cards show "Save failed, try again."
- **New columns:** `tasks.inputs` (what each person enters) and `practice_drugs.ready_at`.
- **A fully seeded demo drug, Pasatru (BLA761508):** distributors (ASD Healthcare, McKesson Specialty Health), codes (J3590 from Feb 1 → **J0289 from Oct 1, 2026**), insurer policies (Medicare / BCBS / Aetna) and vial strength (100 mg, single-dose).
- **Pinning drugs** (Sawan): doctors can pin drugs, and pinned drugs sort first. New `pinned_drugs` table.
- **A real login check** (Sawan): the pin endpoints verify the user's Supabase login token. This is the pattern to reuse on every other endpoint.

---

## The updated checklist

### Foundations
| What should happen | Status | What's there now |
|---|---|---|
| Database tables + privacy view | ✅ 🆕 | All 8 tables and the view, plus `pinned_drugs`, `tasks.inputs` and `practice_drugs.ready_at` |
| Doctor login | ✅ | Google + NPI sign-up |
| Role switcher | 🟡 | Still just "Drug maker" and "Doctor" |
| Seed data | 🟡 🆕 | **Demo drug Pasatru fully seeded**; still no demo patients |

### Behind the scenes: the drug maker launches a drug
| What should happen | Status | What's there now |
|---|---|---|
| Drug maker enters a drug and the app builds its profile | ✅ | |
| FDA label, AI reading with citations, typical dose, cancer flag | ✅ | |
| Storage requirements | ✅ | |
| Vial sizes and NDCs | 🟡 🆕 | 11-digit NDCs done; **vial strength entered by hand for the demo drug**, no parser for other drugs |
| Pick the generic code | ✅ | In both browser and backend |
| Check for a permanent code | 🟡 | By brand name, no dates |
| Expected permanent-code date | 🟡 🆕 | **Demo drug has one (Oct 1) through its codes list**, shown in the workspace; no source for other drugs |
| Code history with dates | 🟡 🆕 | **Demo drug: J3590 → J0289 on Oct 1.** The launch flow still doesn't fill this for new drugs. |
| Insurer coverage | 🟡 🆕 | **Demo drug only** (Medicare / BCBS / Aetna) |
| Distributors | 🟡 🆕 | **Demo drug only.** No field on the Drug maker page. |
| Cost per dose | 🟡 | Medicare's payment amount only |
| Sources, saving, CMS refresh | ✅ | |

### Billing rules engine
| What should happen | Status | What's there now |
|---|---|---|
| All billing rules as tested backend functions | ✅ | 36 tests; still only the NDC conversion is used by any screen |

### Stage 1: Consider ("Can we use this?")
| What should happen | Status | What's there now |
|---|---|---|
| Doctor signs up with NPI | ✅ | |
| Practice profile | ✅ | "Share with pharma" still can't be set |
| Home with launch messages and search | 🟡 🆕 | Drug grid, View Tasks toggle, and **pinning** (pinned drugs first). No search box, no launch messages. |
| Drug page | 🟡 | Coverage section plus the light text as headlines |
| Four lights | 🟡 | Calculated on the backend; colors and sources not shown; no "we can draft these for you" message. **The demo drug now has insurer data, but the Coverage light doesn't read it yet** (always "not yet available"). |
| Actions | 🟡 | "Get my team ready" works. "Add patients to hold list" still does nothing; "notify me" and "talk to specialist" don't exist. |
| Save the decision and log it | 🟡 | "Adopting" is saved. Holding isn't, and nothing is logged. |

### Stage 2: Prepare ("Are we ready?")
| What should happen | Status | What's there now |
|---|---|---|
| Team board with tasks for each role | 🟡 🆕 | **Rebuilt:** role columns, readiness meter, code timeline, doctor strip, card states, auto-refresh. Still one page per drug, setup tasks only, no activity feed. |
| Purchasing card (distributors, vial mix, quantity) | 🟡 🆕 | Unlocks Receiving when marked done. Shows distributors as text (demo drug only). **No vial mix, quantity, planned-patients slider or "order placed" entry yet.** |
| Receiving | 🟡 🆕 | Instructions shown; **now locked until Purchasing is done** |
| Nurse setup | 🟡 | Instructions shown as a paragraph; no numbered guide or supplies checklist |
| Billing setup | 🟡 | Still generic text, even though the demo drug now has codes and insurer data |
| **"Ready to treat"** | 🟡 🆕 | **The logic and the banner are built, but they can't be reached:** readiness needs stock on hand, and nothing adds stock yet. The banner button says "Back to all drugs" instead of "Start first patient." |
| Planned patients (doctor enters) | ❌ | Shown, not editable |
| Invoice upload and AI reading | ❌ | |
| Stock on hand | ❌ | **Blocks "Ready to treat"** |
| Hold list | ❌ | Count shown only; can't add or remove |

### Stage 3: Treat & Bill ("Will we get paid?")
| What should happen | Status | Notes |
|---|---|---|
| Patients and visit notes | ❌ | Table ready |
| Doctor orders the drug, with dose and vial mix | ❌ | Math ready |
| Documentation check with quotes | ❌ | Demo drug's approved uses and insurer requirements are ready to check against |
| AI drafts missing note text; doctor signs | ❌ | |
| "Buy for this patient" task | ❌ | Tasks can be created, so this is easy |
| Nurse's treatment form | ❌ | Math ready |
| Claim builder and the 8 checks | ❌ | Math, table and demo drug's codes ready |
| Export with attachments | ❌ | |

### Stage 4: Switch ("What now that the code is here?")
| What should happen | Status | Notes |
|---|---|---|
| Permanent code takes effect by date of service | 🟡 🆕 | Logic ready, **and the demo drug now has real code data to run on** (J3590 → J0289 on Oct 1) |
| Claims flagged for recoding; corrected claims | ❌ | |
| "Review your hold list" alert | ❌ | |

### Pharma side
| What should happen | Status | Notes |
|---|---|---|
| Launch drug page | ✅ | |
| Activity log | ❌ | Nothing writes events yet |
| Dashboard using the privacy view | 🟡 | View built, no dashboard |
| Get help and the help queue | ❌ | |

### Across the whole app
| What should happen | Status | Notes |
|---|---|---|
| Secret keys on the server; row-level security | ✅ | |
| Endpoints protected | 🟡 🆕 | **A login-token check now exists** (used by pins). Every other endpoint (lights, practices, tasks, workspaces) is still open. |
| Audit trail and privacy boundary | 🟡 | View exists; nothing logged |
| Billing-rule tests | ✅ | |
| Visual polish | ✅ | The workspace matches the rest of the app |

---

## Bugs and loose ends
| # | Issue | Status |
|---|---|---|
| 1 | "Get my team ready" duplicated tasks | ✅ 🆕 Fixed |
| 2 | Failed checkbox saves weren't caught | ✅ 🆕 Fixed |
| 3 | "Get my team ready" errors use a pop-up alert | ❌ Still there |
| 4 | **"Ready to treat" can't be reached** (nothing adds stock) | ❌ 🆕 **Blocker** |
| 5 | Ready banner says "Back to all drugs" instead of "Start first patient" | ❌ 🆕 |
| 6 | Coverage light ignores the seeded insurer data | ❌ 🆕 |
| 7 | `CLAUDE.md` says to run `backend/migrations/001_workspace_columns.sql`, but that file was deleted | ❌ 🆕 |
| 8 | Nothing sets a card to "in progress" | ❌ 🆕 Minor |

---

## Progress
| Area | Last check | Now |
|---|---|---|
| Foundations | ~70% | **~75%** (demo drug seeded) |
| Behind the scenes (drug profile) | ~75% | **~80%** (demo drug has codes, insurers, distributors, strength; the launch flow still doesn't fill these for new drugs) |
| Billing rules engine | Done | Done (still unused by screens) |
| Consider | ~60% | ~60% (pinning added) |
| Prepare | ~40% | **~55%**: layout, states, readiness logic done; missing stock, doctor inputs, and the interactive Purchasing / Receiving / Nurse / Biller cards |
| Treat & Bill | ~10% | ~10% |
| Switch | ~15% | **~20%** (real code data for the demo drug) |
| Pharma side | ~20% | ~20% |

---

# What's next

Following the product workflow (**Consider → Prepare → Treat & Bill → Switch**, with the pharma side throughout), here's what each stage still needs, most important first.

### Prepare: finish it (it's at ~55%, and it has a blocker)
1. **Stock (unblocks "Ready to treat").** A minimal Receiving: enter invoice lines by hand (NDC, lot, quantity, cost), confirm, and they're added to stock, with an NDC match check. Add AI invoice reading later.
2. **Doctor inputs:** editable planned patients, and a hold list you can add to and remove from. The Consider page's "Add patients to hold list" button should use the same endpoint.
3. **Purchasing card:** dose → least-waste vial mix → order quantity for the planned patients (all from `billing_rules`), a distributor picker, and "Mark order placed."
4. **Biller card:** today's code, units, JW/JZ, an Item 19 example with a character counter, and one row per insurer with "Reviewed." All the data and rules already exist; it's mostly display.
5. **Nurse card:** a numbered preparation guide and a supplies checklist. The simple version can split the existing text into steps.
6. **Ready banner:** "Start first patient →", which leads into Treat & Bill.

**Time box:** if this runs long, ship manual versions and move on. Treat & Bill matters more.

### Treat & Bill: the core of the demo (still at ~10%)
1. **Demo patients:** 3–5 hand-written patients (name, date of birth, weight, insurer, diagnosis, a visit note), including **"Maria."**
2. **Patient chart + order:** pick a patient, paste or edit the note, New Order → the dose and vial mix are calculated. No stock → a "buy for this patient" task.
3. **Documentation check (the AI centerpiece):** the note is checked against the drug's approved uses and the insurer's requirements, giving ✓/✗ with quotes. **"Draft addition"** writes the missing text, the doctor approves it, then signs.
4. **Nurse form:** prefilled; enter start and stop times → waste and infusion code are calculated.
5. **Claim builder:** code by date of service and insurer → units, JW/JZ line, NDC, Item 19, diagnosis, infusion line → the 8 checks → a CMS-1500 screen → Export.

### Switch
1. A **"Simulate CMS update"** button (for the demo drug, Oct 1 already exists in its codes list, so it can instead "set today's date" past Oct 1).
2. Recoding: drafts after the switch date get flagged and rebuilt.
3. A **"Review your hold list"** alert.

### Consider (polish, high visibility)
1. **Show the light colors and sources**; add **"we can draft these for you"** to the billing light.
2. **Make the Coverage light read the insurer data.**

### Pharma side
1. **Log events** in the endpoints that already exist (viewed drug, team ready, task done, order placed, stock received…). One small helper function, called from each endpoint.
2. **The pharma dashboard**, reading only the privacy view.
3. **Get help:** a button, and the help queue.

### Across the whole app
1. **Put the login-token check on every practice endpoint** (lights, practices, tasks, workspaces).
2. **Merge `workspace-UI` into `main`**, fix the `CLAUDE.md` migration note, and replace the alert pop-up.
3. **A role switcher** (doctor / nurse / biller / front desk / pharma) for the demo.

---

## Who does what (proposed; adjust names as needed)

The work splits into **three parallel streams**, so nobody waits on anyone else.

| Stream | Owner | What | Why them |
|---|---|---|---|
| **A: Finish Prepare** | **Samay** | Stock (manual Receiving), doctor inputs + hold list, Purchasing card, Biller card, Nurse card, "Start first patient." Frontend plus the small endpoints behind each card. | Built the workspace; knows the page |
| **B: Treat & Bill backend** | **Sawan** | Demo patients seed; treatment endpoints (create order, sign, record administration, build claim + 8 checks) using `billing_rules` and code-by-date; the "buy for this patient" task; the **event-logging helper**; the **login check on all endpoints** | Wrote `billing_rules`, the pipeline and the login check |
| **C: Treat & Bill AI + screens** | **Harsha** | The **documentation check + draft** (prompt, output format, endpoint); the patient chart page with the documentation sidebar; the nurse form; the CMS-1500 claim screen | The AI centerpiece and the demo spine |
| **D (if a 4th person, or whoever finishes first)** | — | Consider polish (light colors, sources, coverage from insurer data, "we can draft"), Switch (simulate + recode + hold-list alert), pharma dashboard, Get help | Independent of A–C |

### Agree on these now so streams B and C don't block each other
**Treatment endpoints (Sawan builds, Harsha's screens call them):**
| Endpoint | Does |
|---|---|
| `GET /api/patients` | The practice's patients |
| `POST /api/practice-drugs/{id}/treatments` | Create an order for a patient: calculates dose and vial mix; creates a "buy" task if there's no stock |
| `POST /api/treatments/{id}/doc-check` | Runs the AI documentation check on the note; returns items with ✓/✗ and quotes |
| `POST /api/treatments/{id}/draft-addition` | AI writes the missing note text |
| `POST /api/treatments/{id}/sign` | Saves the note copy and check results; status becomes signed |
| `PATCH /api/treatments/{id}/administration` | Nurse's record: calculates waste and infusion codes |
| `POST /api/treatments/{id}/claim` | Builds the claim JSON and runs the 8 checks |
| `GET /api/treatments/{id}` | Everything about one treatment, for the screens |

**Event helper (Sawan builds, everyone calls):** `log_event(practice_id, application_id, type, detail)`.

---

## Checkpoints
| # | Checkpoint | Done when |
|---|---|---|
| 1 | **Prepare complete** | Enter stock → all 4 cards done → "Ready to treat" shows → "Start first patient" works |
| 2 | **Treat & Bill backend** | Demo patients exist; the endpoints above return real data (check with `/docs`) |
| 3 | **Documentation check** | Pasting Maria's note returns ✓/✗ with quotes; "Draft addition" fixes the ✗ |
| 4 | **The full Maria path** | Order → check → sign → nurse → claim with 8 green checks → export, with no manual database edits |
| 5 | **Switch + Consider polish + pharma** | Simulated switch recodes claims; lights show colors and sources; dashboard shows events |
| 6 | **Hardening + pitch** | Login check everywhere, demo reset, slides, backup video |
