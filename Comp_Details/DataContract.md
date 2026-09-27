# Data Contract — Workspace ↔ Treat & Bill

**Purpose:** where every piece of information is **entered**, where it's **saved** in the database, and who **reads** it later, especially the claim builder. Workspace (setup) and Treat & Bill (per patient) are built by different people; this is the agreement between them.

**Based on:** the real Supabase schema (9 tables + the `pharma_summary` view), checked Sep 27.

---

## 1. The rules

1. **`tasks.inputs` is only for the task card's own state** (checkboxes, "reviewed", "order placed"). Anything a later step needs must also be saved in its real home (`practice_drugs`, `patients`, `treatments`).
2. **Data is entered once, in one place.** No second copy of patient, practice or invoice data.
3. **The claim is assembled, then frozen.** The claim builder gathers from 5 tables and saves the finished claim in `treatments.claim`, a snapshot of what was true on the date of service. Later changes (new insurer, new permanent code) don't silently change an exported claim.

---

## 2. How the tables connect

```
                         treatments
                        /          \
          patient_id  /              \  practice_drug_id
                     ▼                ▼
                 patients        practice_drugs
                     \             /        \
        practice_id   \           / practice_id  \  application_id
                       ▼         ▼                 ▼
                        practices                 drugs
```
| Foreign key | Points to |
|---|---|
| `treatments.patient_id` | `patients.id` |
| `treatments.practice_drug_id` | `practice_drugs.id` |
| `practice_drugs.practice_id` | `practices.id` |
| `practice_drugs.application_id` | `drugs.application_id` |
| `patients.practice_id` | `practices.id` |
| `tasks.practice_drug_id` / `tasks.treatment_id` | `practice_drugs.id` / `treatments.id` |

**Backend rule:** when creating a treatment, check that **the patient's practice = the workspace's practice.** Foreign keys alone don't enforce this, and it's also a privacy safeguard.

---

## 3. Setup tasks (workspace team): what each saves

| # | Task (`kind`) | `role` | Person enters | **Saved to (real home)** | In `tasks.inputs` | Used later by |
|---|---|---|---|---|---|---|
| 1 | Set planned patients (`plan_patients`)* | doctor | Patients per month | `practice_drugs.planned_patients_per_month` | — | Purchasing quantities |
| 2 | Place the order (`purchasing`) | front_desk | Distributor, optional PO number, "order placed" | — | `{distributor, po_number, order_placed_at, quantities:[{ndc_11, vials}], waits_for}` | Unlocks Receiving |
| 3 | Receive & store (`receiving`) | front_desk | Invoice file + lines, "stored" | **`practice_drugs.invoices`** + **`practice_drugs.stock_on_hand`** | `{invoice_id, stored_at, waits_for}` | **Claim** (price, invoice attachment), nurse's vial picker, readiness |
| 4 | Nurse setup (`nurse_setup`) | nurse | Supplies checked, guide reviewed | — | `{supplies_confirmed:[...], guide_reviewed:true}` | Readiness |
| 5 | Review insurers (`payer_review`)* | biller | "Reviewed" per insurer | — | `{payers_reviewed:{"Medicare":"<time>"}}` | Readiness |
| 6 | Confirm billing setup (`billing_setup`) | biller | Confirm | — | `{confirmed_at, waits_for}` | Readiness |

\* **Not yet allowed by the `tasks.kind` check constraint.** See section 8.

**Only task #3 (Receiving) feeds the claim.**

### Invoice and stock shapes (must match exactly)
The columns exist; this agrees on what goes inside them.

```jsonc
// practice_drugs.invoices  — one object per uploaded invoice
[{
  "invoice_id": "inv_001",                      // unique within this practice_drug
  "status": "pending",                          // pending (AI read, not confirmed) → confirmed
  "invoice_number": "ASD-448120",
  "invoice_date": "2026-09-27",
  "distributor": "ASD Healthcare",
  "file_path": "invoices/<practice_id>/<practice_drug_id>/inv_001.pdf",   // private Storage bucket
  "uploaded_at": "2026-09-27T14:02:00Z",
  "lines": [
    { "ndc_11": "12345067801", "lot": "A123", "quantity": 3, "unit_cost": 4950.00, "expiry": "2027-08-31" }
  ]
}]

// practice_drugs.stock_on_hand  — one entry per NDC + lot; added on invoice confirm, reduced when the nurse uses vials
[
  { "ndc_11": "12345067801", "lot": "A123", "quantity": 3, "unit_cost": 4950.00, "invoice_id": "inv_001" }
]
```
`unit_cost` and `invoice_id` on each stock entry are **new keys inside the existing JSON** (no schema change). They let the claim find the **price and invoice file for the exact vials used**.

---

## 4. Invoice upload flow (AI reads, code checks, person confirms)

```
Upload PDF/photo ─► private Storage ─► Claude reads it ─► code checks ─► save as "pending" ─► person reviews/edits ─► Confirm
                                                                                                                 │
                                                                   invoices[].status = "confirmed"  ◄────────────┤
                                                                   stock_on_hand += confirmed lines ◄────────────┘
```
1. **Storage:** a private Supabase Storage bucket `invoices`, path `invoices/{practice_id}/{practice_drug_id}/{invoice_id}.pdf`. Uploaded through the backend; the bucket is never public.
2. **AI read (Claude, strict JSON output):** distributor, invoice number, invoice date, lines (NDC as printed, description, lot, expiry, quantity, unit cost, line total).
3. **Code checks (no AI):**
   - normalize each NDC to 11 digits (invoices often print them without dashes)
   - **match each NDC to `drugs.ndcs`** (✓ / ⚠ not this drug)
   - quantity × unit cost = line total
   - flag missing fields
4. **Pending:** append to `invoices` with `status: "pending"`. **Stock does not change yet.**
5. **Review:** the Receiving card shows the lines with ✓ / ⚠; every field is editable.
6. **Confirm:** `status: "confirmed"`, lines added to `stock_on_hand`, Receiving task inputs get `{invoice_id, stored_at}`.
7. **Fallback:** the same form with blank fields, for manual entry.

**Suggested split:** the upload/read/check endpoint is AI work (Treat & Bill side, Harsha); the Receiving card that calls it is the workspace team's.

---

## 5. Per-patient data (Treat & Bill)

### `patients` (existing columns)
`first_name`, `last_name`, `date_of_birth`, `sex` (M/F), `address` {street, city, state, zip}, `weight_kg`, `payer`, `member_id`, `diagnosis` (free text), `visit_note`.

### `treatments`: one row per dose, filled in stages
| Stage | Existing columns | **To add** | Entered on / by |
|---|---|---|---|
| **Order** | `ordered_dose`, `dose_unit`, `vial_mix`, `documentation_check` {items[], prior_auth_required, checked_at}, `signed_note`, `signed_at` | **`diagnosis_codes`** (confirmed ICD-10s) | Patient chart / doctor + AI |
| **Prior auth** | (only `documentation_check.prior_auth_required`) | **`prior_auth`** {required, number, obtained_at} | Prior-auth task / biller |
| **Preparation** | `vials_used` [{ndc_11, lot, quantity}], `waste_amount` | — | Treatment record / nurse |
| **Administration** | `date_of_service`, `dose_given`, `infusion_start`, `infusion_stop` | — | Treatment record / nurse |
| **Claim** | `billing_code`, `claim` (all CMS-1500 fields), `claim_checks`, `claim_versions` | **`payer_response`** {result, reason, received_at} | Built automatically; reviewed by the biller |
| **Status** | ordered → signed → administered → claim_ready → exported → needs_recoding | **+ paid, returned, denied** | App |

When the nurse saves **Preparation**, the vials used are **subtracted from `practice_drugs.stock_on_hand`**.

---

## 6. Where the claim builder gets every CMS-1500 field

The builder takes **one treatment ID**, calls `load_claim_context(treatment_id)` (follows the links once, returns one object), and builds from that.

| Box | Field | Source | Status |
|---|---|---|---|
| 1, 1a | Insurance type, insured ID | `patients.payer`, `patients.member_id` | ✅ |
| 2, 3, 5 | Patient name, DOB/sex, address | `patients.first_name/last_name/date_of_birth/sex/address` | ✅ |
| 4, 6, 7, 11 | Insured info, group number | Assume "same as patient" | 🟡 Demo assumption |
| 12, 13, 31 | Signatures | "Signature on file" (+ `treatments.signed_at`) | ✅ |
| 19 | Drug description (generic-code claims) | `billing_rules.item19(...)`: `drugs.brand_name`, `treatments.dose_given` + `dose_unit`, `drugs.route_of_administration`, `vials_used[].ndc_11`, price from `stock_on_hand[].unit_cost` | ✅ once invoice shapes (section 3) are used |
| 21 | Diagnosis codes | **`treatments.diagnosis_codes`** | ❌ Column to add |
| 22 | Resubmission code + original | `treatments.claim_versions` | ✅ |
| 23 | Prior auth number | **`treatments.prior_auth.number`** | ❌ Column to add |
| 24A | Date of service | `treatments.date_of_service` | ✅ |
| 24A (shaded) | NDC: `N4` + 11-digit NDC + unit + quantity | `treatments.vials_used` | ✅ |
| 24B | Place of service | `11` (office), constant | ✅ |
| 24D | Drug code | `billing_rules.code_for(drugs.codes, patients.payer, date_of_service)` → saved to `treatments.billing_code` | ✅ |
| 24D | JW / JZ modifier | `waste_modifier(drugs.is_single_dose_vial, treatments.waste_amount)` | ✅ |
| 24D | Infusion codes | `admin_codes(infusion_start, infusion_stop, drugs.is_antineoplastic)` | ✅ |
| 24E | Diagnosis pointer | Links lines to box 21 | ✅ |
| 24F | Charges | Fee schedule in config (`config/fee_schedule.json`) | ❌ To add (config, not a table) |
| 24G | Units | `billing_rules.units(...)` with `drugs.codes[].unit`, `dose_given`, `waste_amount` | ✅ |
| 24J | Treating NPI | `practices.npi` | ✅ |
| 25 | Tax ID | **`practices.tax_id`** | ❌ Column to add |
| 26 | Patient account number | `patients.id` | ✅ |
| 27 | Accept assignment | Yes, constant | ✅ |
| 28 | Total charge | Sum of 24F | ✅ |
| 32, 33, 33a | Service location, billing provider, NPI | `practices.name`, **`practices.address`**, **`practices.phone`**, `practices.npi` | ❌ Address / phone to add |
| Attachments | Invoice, label, signed note | `invoices[].file_path`, DailyMed (fetched live), `treatments.signed_note` | ✅ |

### What changes from claim to claim
Every claim uses the **same sources**, but the **lines** depend on the data:
| Variation | Effect |
|---|---|
| Generic vs. permanent code (by date of service) | Item 19 + units = 1 + invoice attached, vs. units = dose ÷ billing unit |
| Waste vs. no waste | Extra **JW** line, or **JZ** |
| Infusion length | One infusion code, or first hour + additional hours |
| Cancer drug or not | Different infusion code family |
| Two vial sizes (two NDCs) | Usually one drug line per NDC (*verify with the contractor's guidance*) |
| Insurer | Medicare vs. commercial rules (`claim_rules` config) |
| Prior auth required | Box 23 filled or empty |
| Corrected claim | Box 22 resubmission code 7 + original reference |

Each variation becomes a **test case** for the claim builder.

---

## 7. "Waits for": calculated, not dragged

`tasks.status` only allows `todo` / `done`. The workspace currently stores Awaiting by hand in `inputs.board_status`. For **core** tasks, Awaiting should instead be **calculated by the backend** from `inputs.waits_for`:

```jsonc
{ "waits_for": { "task_kind": "plan_patients" } }        // Place the order
{ "waits_for": { "task_kind": "purchasing" } }           // Receive & store
{ "waits_for": { "task_kind": "receiving" } }            // Confirm billing setup (needs the invoice price)
{ "waits_for": { "treatment_step": "signed" } }          // Prior auth, Prepare dose (per patient)
{ "waits_for": { "treatment_step": "prepared" } }        // Give infusion
{ "waits_for": { "treatment_step": "administered" } }    // Claim review
```
If the thing it waits for isn't done → **Awaiting** ("Waiting on: …"); otherwise → To do; done → Complete. Manual moves can stay for custom tasks.

Per-patient tasks (created by Treat & Bill) also set `tasks.treatment_id` and a page link in `inputs.link` (e.g. `/treatments/42/record`).

---

## 8. Schema fixes (for whoever owns the database)

```sql
-- Provider info for boxes 25, 32, 33
alter table practices
  add column address jsonb,          -- {street, city, state, zip}; the NPI lookup already returns it
  add column phone varchar,
  add column tax_id varchar;         -- fake value for the demo

-- Per-dose claim info
alter table treatments
  add column diagnosis_codes jsonb not null default '[]',  -- ["C34.90"] confirmed ICD-10s (box 21)
  add column prior_auth jsonb,                              -- {required, number, obtained_at} (box 23)
  add column payer_response jsonb;                          -- {result: paid|returned|denied, reason, received_at}

-- Extend allowed values (edit the existing check constraints)
--   treatments.status  += 'paid', 'returned', 'denied'
--   tasks.kind         += 'plan_patients', 'payer_review', 'sign_order', 'prior_auth', 'prepare_dose'
```
Also:
- Create the private Storage bucket **`invoices`**.
- Save the practice address at sign-up (from the NPI lookup).

---

## 9. Decision: no separate "claim inputs" table
- A second table copying claim fields would duplicate patient, practice and invoice data, and the copies would drift apart.
- `treatments.claim` already *is* "one place with every claim field": assembled from the 5 tables, then frozen.
- **Later, if needed:** a separate `claims` table (linked to the treatment) holding `claim`, `claim_checks`, `claim_versions` and `payer_response`, if a dose ever needs several claims (e.g. primary + secondary insurer). Not needed for the hackathon.

---

## 10. Privacy issue to fix before patient tasks exist

`GET /api/workspaces/by-role/{role}` has **no login check and returns workspaces from every practice**. Once Treat & Bill creates tasks like "Record **Maria's** infusion," it would expose patient names across practices. Before per-patient tasks go live, it must use the login check (`current_practice`) and return only that practice's workspaces.
