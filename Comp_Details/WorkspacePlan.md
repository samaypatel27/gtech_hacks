# Team Workspace — Build Plan (Phase 3: Prepare)

This plan covers the **team workspace** (`/doctor/workspace/:practiceDrugId`), the Prepare stage from `BuildPlan.md`. It's built in **layers**:
- **Layer 0** is prerequisites.
- **Layer 1** is the outline: the layout and the shells for every card.
- **Layers 2–6** fill in each user's features, one at a time.
- **Layer 7** adds the extras that make it stand out.

---

## 1. What the workspace is for

The workspace is where **"we're adopting DrugX" becomes "we're ready to treat with DrugX."** It's finished when three things are true:

1. **The drug is on the shelf:** bought, received, stored correctly and recorded as stock.
2. **The nurse knows how to prepare and give it,** and has the supplies.
3. **The biller knows exactly how to bill it** while it's on a generic code, for each of the practice's insurers.

When all three are done, the practice's status for the drug goes from **`adopting` → `active` ("Ready to treat")**. That's the handoff into Treat & Bill.

**Today:** each card is a paragraph of text plus a checkbox. **Goal:** each role *does or enters* something specific, and the workspace shows readiness building up.

---

## 2. Who does what

| Person | Sees | Does or enters | Saved in |
|---|---|---|---|
| **Doctor** (owner) | Overall readiness, what's blocking it, hold list | **Planned patients per month**; **hold list** entries | `practice_drugs.planned_patients_per_month`, `practice_drugs.hold_list` |
| **Front desk: Purchasing** | Distributors, vial sizes + NDCs, **least-waste vial mix**, **order quantity** | Pick a distributor, mark **"order placed"** (optional PO number / date) | `tasks.inputs` |
| **Front desk: Receiving** | Storage rule, what to check on arrival | **Upload invoice** → confirm the lines read from it (NDC, lot, quantity, unit cost, expiry) → mark **"stored"** | `practice_drugs.invoices`, `practice_drugs.stock` |
| **Nurse: Setup** | Step-by-step preparation guide, what to record on treatment day | Check off the **supplies checklist**; acknowledge the guide | `tasks.inputs` |
| **Biller: Setup** | Drug-specific billing: today's code, units, Item 19 example, JW/JZ, invoice rule, expected permanent date, **one row per insurer** | Confirm each insurer row; optionally flag a problem (→ Get help) | `tasks.inputs` |

### The order things happen in
```
Doctor sets planned patients ──► Purchasing (order placed) ──► Receiving (invoice → stock) ─┐
                                                                                           ├──► READY TO TREAT
Nurse setup (supplies + guide) ────────────────────────────────────────────────────────────┤     (status → active)
Biller setup (per-insurer review) ─────────────────────────────────────────────────────────┘
```
- **Receiving is locked until the order is placed.**
- Nurse and biller setup can happen at the same time as purchasing and receiving.
- **Ready to treat** = all four tasks done **and** stock on hand > 0.

---

## 3. Layer 0: Prerequisites

Do these first. Every later layer depends on them.

### Bugs
- [ ] **Duplicate tasks:** `POST /api/practice-drugs/{id}/team-ready` inserts 4 new tasks on every click. Fix: if the practice-drug already has tasks, return the existing ones and don't insert.
- [ ] **Silent save failures:** the checkbox only rolls back on a network error. Also roll back (and show a small error) when the response isn't OK.

### Data model
- [ ] **Add `inputs` (JSON, default `{}`) to `tasks`.** This holds each card's entries ("order placed", confirmed supplies, insurers reviewed…). Invoices and stock stay on `practice_drugs`.
- [ ] **Add `planned_patients_per_month` to `practice_drugs`**, if it's not already there.
- [ ] **Add `ready_at` (timestamp) to `practice_drugs`**, set when the workspace reaches "Ready to treat."

### Data gaps (the demo drug needs at least these)
- [ ] **Vial strengths:** parse each NDC description (e.g. "300 mg/10 mL") into `ndcs[].strength_mg` and `ndcs[].single_dose`. The vial mix and quantity need it.
- [ ] **Distributors:** add a field to the Drug maker page, or enter them by hand for the demo drug.
- [ ] **Codes list:** at least `[{code: generic, from: approval date}, {code: permanent, from: expected date}]` for the demo drug. The biller card reads it.
- [ ] **Insurer policies:** enter Medicare, BCBS and Aetna by hand for the demo drug (coverage, prior auth, requirements).

---

## 4. Layer 1: Workspace outline

**Goal:** the new page layout with all card shells, readiness and lock logic, using existing data. The cards still show the current instruction text inside the new shells.

### Layout
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Back to all drugs                                                          │
│                                                                              │
│  VYKOURA — Team workspace                      [ Adopting ]  status pill     │
│  ┌──────────── Readiness ─────────────┐   ┌── Generic-code window ─────────┐ │
│  │  ◔  2 of 4 done                    │   │ FDA approval ── today ── Oct 1 │ │
│  │  Stock ▓▓░░  Nurse ▓▓▓▓  Billing ░░│   │ J3490 now   →   J0644 expected │ │
│  └────────────────────────────────────┘   └────────────────────────────────┘ │
│                                                                              │
│  DOCTOR  Planned patients/month: [ 3 ]    Hold list: 3 waiting  [ Manage ]   │
│                                                                              │
│ ┌─ FRONT DESK ─────────┐ ┌─ NURSE ──────────────┐ ┌─ BILLER ─────────────┐  │  ┌─ ACTIVITY ──────┐
│ │ ▸ Purchasing   TODO  │ │ ▸ Nurse setup  DONE ✓│ │ ▸ Billing setup TODO │  │  │ Nurse finished  │
│ │   …card body…        │ │   …card body…        │ │   …card body…        │  │  │ setup · 2m ago  │
│ │ ▸ Receiving  🔒LOCKED│ │                      │ │                      │  │  │ Dr. Patel set   │
│ │   waiting on: order  │ │                      │ │                      │  │  │ 3 patients/mo   │
│ └──────────────────────┘ └──────────────────────┘ └──────────────────────┘  │  └─────────────────┘
│                                                                              │
│  (when complete) ┌─────────────────────────────────────────────────────────┐ │
│                  │ ✓ Vykoura is ready at Patel Oncology                     │ │
│                  │ 3 patients are waiting.   [ Start first patient → ]      │ │
│                  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Parts
| Part | What it shows | Data |
|---|---|---|
| **Header** | Drug name, status pill (`adopting` / `active`) | `practice_drugs.status`, `drugs.brand_name` |
| **Readiness meter** | A ring plus three bars (Stock / Nurse / Billing), "N of 4 done" | Task statuses + stock |
| **Generic-code window** | A timeline: approval → today → expected permanent code, current code → expected code | `drugs.codes` (shows "not yet available" until filled) |
| **Doctor strip** | Planned patients, hold-list count, Manage button | `practice_drugs` (a placeholder until Layer 2) |
| **Role lanes** | Three columns: Front desk, Nurse, Biller | `tasks` grouped by role |
| **Card shell** | Title, state badge, expandable body, "waiting on…" when locked | `tasks` |
| **Activity feed** | Recent actions, newest first | `events` (a placeholder until Layer 7) |
| **Ready banner** | Appears when everything is done | Status becomes `active` |

### Card states
| State | Looks like | When |
|---|---|---|
| **Locked** | Greyed out, 🔒, "waiting on: …" | A prerequisite isn't done (Receiving before "order placed") |
| **To do** | Normal | Available, nothing entered |
| **In progress** | Partly filled | Some inputs entered, not complete |
| **Done** | ✓, muted, collapsible | Its completion rule is met |

**A card completes when its inputs are done, not from a free checkbox.** For example, Receiving completes when an invoice is confirmed and marked stored. Until a card's features exist (Layers 2–6), keep a manual "mark done" as a fallback.

### Backend for Layer 1
- [ ] **Extend `GET /api/practice-drugs/{id}/tasks`** to also return:
  - the practice-drug: status, planned patients, hold-list count, stock summary, ready_at
  - a drug summary: brand name, codes, `approval_date`
- [ ] **`PATCH /api/tasks/{id}`** (replaces the status-only endpoint): accepts `status` and/or `inputs`, and **recalculates readiness**. When all 4 tasks are done and stock > 0, it sets `practice_drugs.status = 'active'` and `ready_at`.
- [ ] **Polling:** the page re-fetches every ~3 seconds so the whole team sees updates.

### Done when
The layout renders with real tasks, the lanes and states work, Receiving is locked until Purchasing is done, the readiness meter updates, and completing everything (with the manual fallback) shows the Ready banner and sets the status to `active`.

---

## 5. Layer 2: Doctor

### What they see
- The doctor strip: planned patients, hold-list count, overall readiness.
- The **Ready banner** when complete, with **"Start first patient →"** (links to Treat & Bill; a placeholder until Phase 4) and, if there's a hold list, *"3 patients are waiting. Start them now."*

### What they do
- **Set planned patients per month** (a number input, saved on change). This drives the Purchasing quantities and the payment-timing estimate.
- **Manage the hold list:** a small panel to add or remove waiting patients (a name or patient ID for now; linked to `patients` later).

### Backend
- [ ] `PATCH /api/practice-drugs/{id}`: `planned_patients_per_month`
- [ ] `POST /api/practice-drugs/{id}/hold-list` / `DELETE …/hold-list/{entry}`
- [ ] Also make the Consider page's **"Add patients to hold list"** button use the same endpoint (and set status `holding` if the practice hasn't adopted).

### Done when
Planned patients saves and updates Purchasing; the hold list can be added to and removed from; the Ready banner shows the hold-list count.

---

## 6. Layer 3: Front desk, Purchasing

### What they see
```
┌─ 🛒 Purchasing ─────────────────────────────────────── TO DO ─┐
│ Where to buy:  ABC Specialty · XYZ Oncology   (from drug maker) │
│ Vial sizes:    100 mg  NDC 12345-0678-01                        │
│                300 mg  NDC 12345-0679-01                        │
│ Dose:          500 mg (from label: 7 mg/kg × 70 kg typical)     │
│ Best mix:      1 × 300 mg + 2 × 100 mg → 0 mg waste             │
│ Planned:       [ 3 ] patients / month  ◄ slider                 │
│ Order:         3 × 300 mg · 6 × 100 mg                          │
│                                                                 │
│ Distributor [ ABC Specialty ▾ ]   PO # [ ______ ] (optional)    │
│                                      [ Mark order placed ]      │
└─────────────────────────────────────────────────────────────────┘
```

### What they do
- Adjust planned patients (the same value as the doctor strip), then pick a distributor, optionally enter a PO number, and click **Mark order placed**.

### Logic
- **Dose:** `billing_rules.dose_for` (fixed dose, or rate × typical weight or body surface area).
- **Best mix:** `billing_rules.vial_mix(dose, strengths)`.
- **Order quantity:** best mix × planned patients.

### Saved
`tasks.inputs = {distributor, po_number, order_placed_at, quantities}`, and the task becomes done, which **unlocks Receiving**.

### Backend
- [ ] `GET /api/practice-drugs/{id}/purchasing-plan`: returns dose, vial mix and quantities (uses `billing_rules`).

### Done when
Changing planned patients updates the quantities live, and "Mark order placed" completes the card and unlocks Receiving.

---

## 7. Layer 4: Front desk, Receiving

### What they see
```
┌─ 📦 Receiving ──────────────────────────────────────── TO DO ─┐
│ Storage: Refrigerate 2–8°C · Do not freeze · Protect from light │
│          [FDA label §16]                                        │
│ ┌───────────────────────────────────────────────┐              │
│ │   Drop the invoice PDF here                    │              │
│ └───────────────────────────────────────────────┘              │
│ Read from invoice (confirm):                                    │
│   NDC 12345-0679-01 ✓ matches Vykoura 300 mg                    │
│   Lot A123 · Qty 3 · $4,950.00/vial · Exp 2027-08               │
│   NDC 12345-0678-01 ✓ matches Vykoura 100 mg                    │
│   Lot B456 · Qty 6 · $1,650.00/vial · Exp 2027-08               │
│                                   [ Confirm lines ]             │
│ ☐ Stored at 2–8°C                  [ Mark stored ]              │
└─────────────────────────────────────────────────────────────────┘
```

### What they do
1. **Upload the invoice PDF.**
2. **Review and confirm** the lines it reads (editable if something's wrong).
3. **Mark stored** after refrigerating.

### Logic
- The invoice is uploaded to Supabase Storage. **Claude reads** the lines: NDC, lot, quantity, unit cost, expiry.
- **Each NDC is checked** against the drug's NDCs (✓ match / ⚠ mismatch).
- Confirming adds the lines to `practice_drugs.invoices` and adds the quantities to `practice_drugs.stock`.
- **Fallback:** manual line entry, if AI reading isn't ready.

### Saved
`practice_drugs.invoices`, `practice_drugs.stock`, `tasks.inputs = {invoice_id, stored_at}`. The task becomes done when confirmed and stored.

### Backend
- [ ] `POST /api/practice-drugs/{id}/invoices` (file upload → storage → Claude extraction → returns lines to confirm)
- [ ] `POST /api/practice-drugs/{id}/invoices/{invoice_id}/confirm` (writes invoices and stock)

### Done when
Uploading an invoice shows the extracted lines with NDC checks, confirming records stock, and "Mark stored" completes the card.

---

## 8. Layer 5: Nurse

### What they see
```
┌─ 💉 Nurse setup ────────────────────────────────────── TO DO ─┐
│ Preparation (from FDA label)                         [§2.3]   │
│   1. Dilute dose in 250 mL 0.9% Sodium Chloride               │
│   2. Administer through a 0.2-micron in-line filter           │
│   3. Infuse IV over 60 minutes                                │
│   4. Use within 4 hours at room temperature                   │
│ Supplies on hand                                              │
│   ☐ 0.2-micron in-line filter                                 │
│   ☐ 250 mL 0.9% NaCl bags                                     │
│   ☐ Infusion tubing                                           │
│ On treatment day you'll record:                               │
│   dose given · vials used (NDC, lot) · waste · start/stop time│
│ ☐ I've reviewed the preparation guide    [ Mark ready ]       │
└───────────────────────────────────────────────────────────────┘
```

### What they do
Check off each supply, acknowledge the guide, and click **Mark ready**.

### Logic
- **Steps and supplies come from the label.** Claude turns `preparation_instructions` into a numbered list plus a supplies list, with citations. This can happen once, when the drug is launched, and be stored on `drugs` (e.g. `prep_steps`, `supplies`).
- **Fallback:** show the existing preparation text as-is, with a generic supplies list.

### Saved
`tasks.inputs = {supplies_confirmed: [...], guide_acknowledged: true}`. Done when all supplies are checked and the guide is acknowledged.

### Backend
- [ ] Add prep steps and supplies to label extraction (or a separate one-time extraction) and store them on `drugs`.

### Done when
The numbered guide and supplies checklist appear, and checking everything plus acknowledging completes the card.

---

## 9. Layer 6: Biller

### What they see
```
┌─ 💵 Billing setup ──────────────────────────────────── TO DO ─┐
│ Today's code:  J3490 (generic)   units = 1        [Medicare]  │
│ Permanent:     J0644 expected Oct 1 — we'll switch for you    │
│ Waste:         Single-dose vial → add a JW line for waste;    │
│                JZ if nothing is wasted                        │
│ Invoice:       Required as an attachment                      │
│ Item 19 example:                                              │
│   "Vykoura 500mg IV NDC 12345067900 $4950"        42 / 80 ✓   │
│ Your insurers                                                 │
│   Medicare  ✓ Covered for approved uses         [ Reviewed ]  │
│   BCBS      ⚠ Prior auth required               [ Reviewed ]  │
│   Aetna     ⏳ Policy under review               [ Reviewed ]  │
│                                   [ Something's off? Get help ]│
└───────────────────────────────────────────────────────────────┘
```

### What they do
Click **Reviewed** on each insurer row. They can optionally click **Get help** if something's off (placeholder until Get help exists).

### Logic (all `billing_rules`, no AI)
- **Today's code:** `code_for(drug.codes, payer, today)`
- **Units rule:** `units(...)`
- **JW/JZ:** `waste_modifier(single_dose, waste)`
- **Item 19 example:** `item19(...)`, using the typical dose, the first NDC and the invoice cost (once received)
- **Insurer rows:** `drugs.payer_policies`, filtered to `practices.payers`

### Saved
`tasks.inputs = {payers_reviewed: ["Medicare", "BCBS", "Aetna"]}`. Done when every insurer the practice has is reviewed.

### Backend
- [ ] `GET /api/practice-drugs/{id}/billing-setup`: returns code, units rule, modifier rule, Item 19 example and insurer rows (uses `billing_rules`)
- [ ] Replace the current generic billing text with this drug-specific content

### Done when
The card shows drug-specific billing facts from the rules and one row per practice insurer, and reviewing all rows completes it.

---

## 10. Layer 7: Extras that make it stand out

In order of impact per hour of work:

| # | Feature | What it is | Effort |
|---|---|---|---|
| 1 | **Source chips** | Every fact gets a small chip ("FDA label §16", "Medicare contractor rule"); hovering shows the exact text. The data already has citations. | Low |
| 2 | **Activity feed + events** | "Front desk uploaded invoice · 2m ago". Every action also writes to `events`, which feeds the pharma dashboard. | Low |
| 3 | **"Blocked? Get help" on each card** | Prefills a help request from the card's context (connects to the pharma side) | Low, once Get help exists |
| 4 | **Viewing as (role focus)** | Picking a role enlarges that role's lane and dims the others | Low |
| 5 | **3D vial stock gauge** | Reuse the app's 3D vial; its fill level shows vials on hand or readiness | Low–medium |
| 6 | **Handoff arrows between lanes** | Show which card unlocks which (Purchasing → Receiving → stock → Ready) | Medium |

**Recommended:** 1 and 2 for sure; 3–6 if there's time.

---

## 11. All backend changes in one place

| Endpoint | Layer | Purpose |
|---|---|---|
| Fix `POST /api/practice-drugs/{id}/team-ready` | 0 | No duplicate tasks |
| Extend `GET /api/practice-drugs/{id}/tasks` | 1 | Also return the practice-drug and drug summary |
| `PATCH /api/tasks/{id}` | 1 | Save status and/or inputs; recalculate readiness; set `active` + `ready_at` |
| `PATCH /api/practice-drugs/{id}` | 2 | Planned patients |
| `POST` / `DELETE /api/practice-drugs/{id}/hold-list` | 2 | Hold list |
| `GET /api/practice-drugs/{id}/purchasing-plan` | 3 | Dose, vial mix, quantities |
| `POST /api/practice-drugs/{id}/invoices` (+ `/confirm`) | 4 | Invoice upload, AI read, confirm → stock |
| Prep steps + supplies extraction → `drugs` | 5 | Nurse card content |
| `GET /api/practice-drugs/{id}/billing-setup` | 6 | Drug-specific billing facts and insurer rows |
| Event writes in each endpoint above | 7 | Activity feed + pharma signals |

## 12. Database changes in one place

| Change | Layer |
|---|---|
| `tasks.inputs` (JSON, default `{}`) | 0 |
| `practice_drugs.planned_patients_per_month` (if missing) | 0 |
| `practice_drugs.ready_at` (timestamp) | 0 |
| `drugs.ndcs[].strength_mg`, `ndcs[].single_dose` | 0 |
| `drugs.codes`, `drugs.distributors`, `drugs.payer_policies` filled for the demo drug | 0 |
| `drugs.prep_steps`, `drugs.supplies` (JSON) | 5 |

---

## 13. Build order and checkpoints

| Layer | Build | Checkpoint |
|---|---|---|
| 0 | Bug fixes, new columns, demo-drug data | No duplicate tasks; demo drug has strengths, codes, distributors and insurer policies |
| 1 | Outline: layout, lanes, card shells, states, readiness, polling | Page renders real tasks; the Ready banner works with manual fallback |
| 2 | Doctor: planned patients, hold list, Ready banner | Planned patients saves; hold list works |
| 3 | Purchasing card | Live quantities; "order placed" unlocks Receiving |
| 4 | Receiving card | Invoice → confirmed lines → stock |
| 5 | Nurse card | Guide + supplies checklist completes the card |
| 6 | Biller card | Drug-specific facts + insurer rows complete the card |
| 7 | Source chips, activity feed (+ events), extras | Every fact has a source; actions show in the feed |

**Time-box reminder (from `BuildPlan.md`):** if Prepare runs over, ship the simplest version of the remaining cards (manual invoice entry, plain preparation text) and move on to Treat & Bill.
