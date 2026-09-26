# LaunchReady — Product Spec v2 (working name)

*v2 changes, based on the Impiricus mentor conversation (see MentorNotes.txt):*
- *Standalone app with no EMR/EHR integration, because Impiricus targets individual doctors and private practices.*
- *NPI sign-up and verification added.*
- *Payer coverage status added to the Considering page, plus a new section on how insurance fits in.*
- *New data and compliance section with three data tiers, since one of the judges is the SVP of Data Analytics.*
- *New section on why this is worth money to Impiricus.*
- *Purchasing task added to the team board, supporting both "stock ahead" and "buy per patient."*

---

## 1. What it is

**One-liner:** When a new clinic-administered drug launches, LaunchReady meets the doctor at the moment they wonder "can my practice actually use this?", shows them the path, gets their team ready, and makes sure the billing works until the drug gets its permanent billing code.

**Pitch paragraph:**
> "When a new drug is approved, it can take 6 to 9 months to get its own billing code. Ryoncil took about 9.5. Until then, claims are manual and easy to get denied, and practices pay thousands of dollars per dose up front. So many practices simply wait. Patients wait for better treatment, and drug makers lose momentum in the months that matter most. LaunchReady meets the doctor at that hesitation, shows them their practice can do it, handles the paperwork, and brings them back when the barrier drops."

**Impiricus framing:** Impiricus's launch messages tell doctors a new drug works. LaunchReady makes those messages *actionable* by answering the doctor's real next question: "can my practice use it?"

---

## 2. The problem

- Infused and injected drugs are **buy-and-bill**: the practice buys the drug up front (often $10k+ per dose), gives it to the patient, then bills insurance to get paid back.
- A newly approved drug has **no permanent billing (HCPCS) code** yet. CMS takes applications quarterly, only after FDA approval, and new codes take effect about 6 months after the application. In total that's typically about 6 to 9 months. *Real example: Ryoncil was approved Dec 18, 2024, and its code J3402 took effect Oct 1, 2025.*
- Until then, practices bill a **generic "not otherwise classified" code**:
  - **J9999:** cancer drugs
  - **J3590:** biologics
  - **J3490:** everything else
  - (C9399 is for hospital outpatient departments and is out of scope)
- Generic-code claims need hand-written drug details (name, strength, dose, route in Item 19), the 11-digit NDC, units = 1 (Medicare) and often the invoice. Medicare contractors price them by hand, and **missing details make the claim "unprocessable."**
- When the permanent code arrives, claims still using the generic code are **denied**.
- **Coverage adds a second uncertainty:** commercial insurers may not have finished writing a coverage policy for a brand-new drug.
- **Result:** some practices "simply wait until the permanent code is assigned" (IPD Analytics), and billing confusion can make providers switch to a competitor's drug (MMIT).
- **Honest limit:** there's no public statistic on how much this delays adoption, so we say practices are *apprehensive*, not that they refuse.

**Key sources:** Noridian and FCSO (Medicare contractor rules), CMS HCPCS coding procedures, IPD Analytics, MMIT, STAT (sponsored by J&J), and the Mesoblast, Eagle and Omeros J-code announcements.

---

## 3. Who it's for

| Role | Who | What they get |
|---|---|---|
| **Main user** | The doctor, especially an **independent or private-practice** physician in a buy-and-bill specialty (oncology, ophthalmology, rheumatology, urology) who carries the financial risk | A clear adoption answer, a documentation check when ordering, and a heads-up when the code goes live |
| **Supporting users** | Nurse, biller, front desk | Drafted tasks, a treatment form, a claim built for them |
| **Customer (pays)** | The drug maker, through Impiricus | Faster launch uptake, plus visibility into where practices hesitate or get stuck |
| **Beneficiary** | The patient | Gets the new treatment sooner |

**Not the target:** hospitals and large health systems. This matches Impiricus's focus on individual doctors and private practices.

---

## 4. Why it's worth it to Impiricus (commercial fit)

1. **Launch sponsorship revenue.** Drug makers already spend heavily on launch and market access (reimbursement specialists, patient-support programs, billing guides). LaunchReady is sponsored per drug launch, through Impiricus. It's free for practices, like CoverMyMeds: free to providers, funded by pharma.
2. **A new data asset.** Today, nobody can see *where practices hesitate or get stuck* with a new drug. LaunchReady creates that signal: readiness, hesitation reasons and common snags, aggregated and de-identified. HCP-level insight like this is what Impiricus already sells to pharma.
3. **Makes Impiricus's existing launch messages work harder.** A launch message becomes a starting point that leads to real adoption, not just an impression. That's measurable and something they can upsell.
4. **Builds on Impiricus's strengths:** a verified, NPI-based HCP network, pharma relationships and compliance experience.

---

## 5. The workflow in plain language

**The characters:** Dr. Patel runs a small independent cancer practice. Maria, 62, has lung cancer that got worse on standard chemo. DrugX is a new cancer drug.

1. **The drug maker launches DrugX.** The FDA approves it, but it has no permanent billing code yet, so it has to be billed under the generic code J9999. The drug maker turns DrugX on in LaunchReady.

2. **The app builds DrugX's profile automatically.** It reads the FDA label, CMS's data and public insurer policies, then works out:
   - which generic code applies
   - what the claims will need
   - which insurers cover it so far
   - how the drug must be stored and given
   - when the permanent code is expected

   Nobody at any clinic has to do anything.

3. **Dr. Patel signs up and hears about DrugX.** She joined LaunchReady with her **NPI number**, so the app knows she's a verified oncologist in Georgia, which tells it her Medicare contractor. She hears about DrugX through an Impiricus launch message, a rep, a conference, or a patient asking. She taps **"Can my practice use this?"** (or searches for the drug).

4. **The app answers for her practice specifically.** She sees four lights:
   - **Coverage:** "Medicare: covered for approved uses. Aetna: policy under review. BCBS: prior authorization required."
   - **Billing path:** "Billed under J9999 for now. Claims need extra details, but **we can draft and check them for you**, and we'll switch automatically when the permanent code arrives."
   - **Payment timing:** "Generic-code claims pay slower. Here's roughly how much cash would be tied up for the patients you're planning."
   - **Workflow:** "Must be refrigerated, 60-minute infusion, needs a filter. Your practice has what it needs."

5. **Dr. Patel decides.** Knowing the billing is handled, she decides to start using DrugX. If she weren't ready yet, she could add patients to a **hold list** and ask to be notified when the permanent code goes live.

6. **The team gets ready.** She clicks **"Get my team ready,"** and the app drafts a checklist for each person:
   - **Front desk – purchasing:** which distributors carry DrugX, which vial sizes to order, the best vial mix for the planned doses, and roughly how many.
   - **Front desk – receiving:** how to receive and store the drug.
   - **Nurse:** how to prepare and give it, and what to record.
   - **Biller:** exactly how to bill it while it's on the generic code.

7. **The clinic buys the drug.** Staff (not the doctor) order DrugX on the distributor's own website and pay up front. LaunchReady doesn't do the buying; it just tells them what to buy. The front desk uploads the invoice, and the app reads the NDC, lot number and price.
   - **Stock ahead:** the practice buys before any patient is ordered (this step happens here).
   - **Buy per patient:** many practices don't stock expensive new drugs. If the doctor orders DrugX for a patient and there's no stock recorded, the app automatically creates a "buy for this patient" task after step 9.

8. **Dr. Patel orders DrugX for Maria.** She makes the medical decision herself; the app doesn't. She adds Maria in the app (or picks her if she's already there), **pastes or uploads her visit note**, and clicks **New Order → DrugX**. The app calculates the dose from Maria's weight.

9. **The app checks the paperwork.** It reads the note and checks that it documents everything payers need for DrugX: diagnosis, mutation result, prior treatment. It finds the test method is missing and **drafts the missing sentences**. She approves them and signs the order.

10. **Maria gets the medicine.** The nurse gives the infusion. The nurse's form in the app is already filled in from the order and invoice, so she only confirms the dose and enters start and stop times. The app works out how much drug was wasted and which administration code applies.

11. **The app builds the reimbursement claim.** It drafts the CMS-1500 with everything a generic-code claim needs:
    - the code and waste modifier
    - units = 1
    - the NDC in 11-digit format
    - the drug description in Item 19
    - the diagnosis code
    - the infusion line
    - Dr. Patel's NPI

    Then it runs its checks and bundles the invoice, FDA label and signed note.

12. **The clinic files for reimbursement.** The biller reviews the claim, sees every check green, and clicks **Export**. The claim goes out through the clinic's clearinghouse to the insurer. Because nothing is missing, it doesn't get bounced back, and the clinic gets paid sooner.

13. **If anything goes wrong, they get help.** A red check shows exactly what to fix. If the practice is stuck or a claim is denied, **Get help** packages the problem, without patient details, and sends it to DrugX's reimbursement specialist.

14. **The permanent code arrives (Switch Day).** CMS assigns DrugX its own code. The app switches every claim template automatically (new code, units calculated from the dose), and Dr. Patel sees: **"The barrier is gone. Review your hold list (3 patients)."**

15. **Throughout, the drug maker sees the big picture.** Its dashboard shows, aggregated and de-identified, how many practices looked at DrugX, got ready and started, and where they hesitated or got stuck. So it knows **what help to send, and where.**

---

## 6. Product structure: one standalone app, two sides

One web app with a sidebar. It **does not connect to any EMR/EHR.** Everything the practice needs is entered or uploaded in the app. A **"Viewing as"** dropdown switches roles (demo shortcut); in real life each person logs in and sees only their own part.

**Clinic side**
| Page | Used by | Purpose | Workflow step |
|---|---|---|---|
| Sign-up | Doctor | NPI verification, practice profile | 3 |
| Home | Doctor | Launch message inbox and drug search | 3 |
| Drug page ("Considering") | Doctor | "Can my practice use this?" | 4–5 |
| Hold list | Doctor | Private list of waiting patients | 5, 14 |
| Team board | Whole team | Role checklists, including purchasing | 6 |
| Receiving | Front desk | Stock on hand and invoice upload | 7 |
| Patients | Doctor | Patient entry, note, ordering, documentation check | 8–9 |
| Treatments | Nurse | Administration form | 10 |
| Claims | Biller | Claim review, checks, export | 11–13 |
| Practice settings | Practice manager | Payers, capabilities, data-sharing choices | — |

**Pharma side**
| Page | Used by | Purpose | Workflow step |
|---|---|---|---|
| Launch dashboard | Drug maker's launch team | Aggregated readiness and hesitation signals | 15 |
| Help requests | Drug maker's reimbursement specialists | Help requests the practice chose to send | 13 |

---

## 7. The detailed steps

### Step 1–2: Drug profile, built automatically (once per drug)
- **Trigger:** the drug maker activates DrugX.
- **The app:**
  - Pulls the FDA label from the **openFDA drug label API** and NDCs and packages from the **openFDA NDC API**.
  - **AI** extracts, with citations to label sections: approved uses and their conditions, dosing (e.g. mg/kg), route, infusion time, preparation (e.g. in-line filter), storage, and single- vs multi-dose vials.
  - **Code** picks the generic code: cancer drug → J9999; otherwise biologic (application number starts with "BLA") → J3590; otherwise J3490. Rules are stored as data with citations, because payers vary. *(Verify the cancer-biologic case for the demo drug.)*
  - **Code** checks the CMS quarterly HCPCS file to confirm no permanent code exists yet.
  - **AI** reads CMS's published HCPCS application summaries to find whether a permanent code has been applied for and the expected effective date.
  - **AI** reads public insurer medical-policy documents for the drug (Medicare contractor plus one or two commercial payers) and records coverage status and prior-auth requirements, with citations.
- **Edge case:** if the drug already has a permanent code, the app says "Standard billing applies (J____)" and skips the generic-code flow.

### Step 3: Sign-up with NPI, and entry points (doctor)
- **Sign-up:**
  - The doctor enters their **NPI**. The app looks it up in the **NPPES NPI Registry API** (free, public) and gets name, credentials, specialty, practice address, and whether it's an individual or organization NPI.
  - **Verified HCP:** only verified providers get access, and only verified HCPs receive pharma help.
  - **Auto-filled practice profile:** specialty, and state, which determines the Medicare contractor.
  - **Relevance:** drugs are shown only to matching specialties (e.g. DrugX goes to oncology).
  - The practice adds its main payers and capabilities (infusion chairs, refrigeration) once.
  - The NPI is reused later on the CMS-1500.
- **Entry points to a drug:** an Impiricus launch message (mocked as email or in-app, **not SMS**), searching on Home, or a shared link.

### Step 4: Considering (doctor)
- **The DrugX page, personalized to the practice, with four lights:**

| Light | Example text | How it's built |
|---|---|---|
| **Coverage** 🟡 | "Medicare: covered for approved uses. Aetna: policy under review. BCBS: prior auth required." | AI-read public insurer policies, filtered to the practice's payers |
| **Billing path** 🟡 | "Billed under J9999 until its permanent code arrives (expected Oct 1). Claims need a drug description, the 11-digit NDC and the invoice. **We can draft and check these for you, and switch automatically when the permanent code goes live.**" | Code rules, encoded Medicare contractor rules, CMS application status |
| **Payment timing** 🟡 | "Generic-code claims are priced by hand, so expect slower payment. Estimated cash tied up for 3 patients: ~$X." (labeled as an estimate) | Cost per dose (from the drug maker or invoice) × planned patients × typical payment delay. **Timing only, never profit.** |
| **Workflow** 🟢 | "Refrigerate 2–8°C. 60-min IV infusion with in-line filter. Your practice has infusion chairs ✓." | AI label extraction compared with the practice profile |

- Every fact links to its source (label section, CMS file, contractor rule, insurer policy).
- **Actions:** Get my team ready · Add patients to hold list · Notify me when the permanent code is live · Talk to DrugX's reimbursement specialist.
- **Signal recorded** (see section 10 for how it's shared): page viewed, which lights were yellow or red, which action was taken, or none.

### Step 5: Decision and hold list (doctor)
- **Proceed:** go to the team board.
- **Wait:** add patients to the **hold list**, a private list that never leaves the practice's workspace. Pharma can see only an aggregated count across practices, and only for practices that opted in.

### Step 6: Team board (whole practice)
- Created when the doctor clicks **"Get my team ready."** Three columns, each task **drafted by AI** from the drug profile:
  - **Front desk / purchasing** (a staff task, not the doctor's; see the purchasing card below).
  - **Front desk / receiving:** storage requirements, receiving checklist, invoice filing.
  - **Nurse:** preparation and administration steps from the label, and what to record (dose, waste, start/stop times, lot).
  - **Biller:** "DrugX bills as J9999 with units = 1," the Item 19 template, NDC format, JW/JZ rule, invoice requirement, the permanent-code date, and payer-specific notes (e.g. "BCBS requires prior auth").
- Tasks can be checked off, and **everyone sees updates live.**

**The purchasing card**
```
┌─ 🛒 Purchasing — DrugX ─────────────────────── Assigned: Front desk ─┐
│  Where to buy:  Limited distribution — ABC Specialty, XYZ Oncology    │
│  Vial sizes:    100 mg (NDC 12345-0678-01) · 300 mg (NDC 12345-0679-01)│
│  For planned patients (3 × 500 mg/month):                             │
│     Best mix per dose: 1 × 300 mg + 2 × 100 mg → 0 mg waste          │
│     Order for 1 month: 3 × 300 mg, 6 × 100 mg                         │
│  Storage on arrival: refrigerate 2–8°C immediately                    │
│  ☐ Order placed   ☐ Received & stored   ☐ Invoice uploaded           │
└───────────────────────────────────────────────────────────────────────┘
```
| Piece | Source | Type |
|---|---|---|
| Which distributors carry it | The drug maker (launch sponsor), since many new specialty drugs are limited distribution | Sponsor input |
| Vial sizes and NDCs | openFDA NDC API | Real data |
| Best vial mix and quantity | Dose × planned patients; pick the vial combination with the least waste | Plain code |
| Storage on arrival | FDA label | AI extraction |

- **Why it matters:** "where do we even buy this?" is a real first-week question for limited-distribution drugs, and the least-waste vial mix saves real money (e.g. two 300 mg vials for a 500 mg dose waste 100 mg of a $15k drug).
- **LaunchReady doesn't place orders.** Staff buy on the distributor's own website.
- *If time runs short, this card can shrink to just the invoice upload.*

### Step 7: Buying the drug and the invoice (front desk)
- **Staff** buy DrugX on the distributor's website. The doctor provides nothing for this step.
- **Two ways practices buy:**
  - **Stock ahead:** buy before any patient is ordered, using the purchasing card.
  - **Buy per patient:** many practices don't stock expensive new drugs, and instead buy after the doctor orders for a specific patient (the drug arrives in a day or two). If the doctor signs an order (Step 8–9) and no DrugX stock is recorded, the app automatically creates a task: **"Buy DrugX for Maria's treatment: 500 mg → 1 × 300 mg + 2 × 100 mg."**
- When the drug arrives, staff **upload the invoice PDF** and mark the stock received.
- **AI** reads the invoice: NDC, lot number, quantity, cost per vial.
- **Code** confirms the NDC matches a DrugX package from openFDA and flags a mismatch, then updates the stock on hand.

### Step 8–9: Ordering and documentation check (doctor)
- **The doctor makes the clinical decision.** The app makes no clinical call.
- **Patient entry (no EMR):** the doctor adds the patient in the app (name, DOB, weight, insurance, diagnosis), or picks an existing one, and **pastes or uploads the visit note** (text or PDF).
- **New Order → DrugX.** **Dose** is calculated by code from weight × the label dose (e.g. 500 mg → 2 × 300 mg vials, 100 mg expected waste).
- A **"Documentation for payers"** sidebar opens. **AI** reads the note and checks it against the label's approved-use requirements and the patient's insurer policy, quoting the note for each item:
  - ✓ Diagnosis documented (stage IV NSCLC)
  - ✓ Mutation result documented (KRAS G12C)
  - ✓ Prior therapy documented
  - ✗ Test method not documented → **[Draft addition]**
  - ✓ Dose, route and frequency in the order
  - ⚠ Patient's insurer requires prior auth → flagged (we don't do prior auth; we point to it)
- **Draft addition:** AI writes the missing text; the doctor edits or approves it, and it's added to the note stored in the app.
- **Wording:** "Ready for typical payer requirements," never "approved" or "cleared."
- The doctor **signs the order**.
- **If no DrugX stock is recorded,** signing automatically creates a "buy for this patient" purchasing task for the front desk (see Step 7).
- *Demo note: the note is editable live. Deleting the KRAS line flips its check to ✗, which proves it's real. Demo patients are generated with Synthea and loaded into the app.*

### Step 10: Treatment (nurse)
- The Treatments page shows a form **prefilled from the order and invoice**: drug, dose, vials, NDC, lot.
- The nurse confirms the dose given and enters **start and stop times**.
- **Code:**
  - **Waste** = vial total − dose given (e.g. 100 mg).
  - **Administration code** from duration: over 15 min, chemo infusion → 96413 for the first hour (+96415 per additional hour); ≤15 min → push (96409). Non-chemo drugs use 96365 / 96374.
- On submit, the **biller's claim updates live.**

### Step 11: Claim builder and checks (biller)
- The app drafts the **CMS-1500** (the electronic version is the 837P):
  - **Drug line:**
    - J9999, plus a **JW** line for the discarded amount (single-dose vial with waste), or **JZ** if there's no waste.
    - **Units = 1** for a generic code under Medicare.
    - **NDC:** converted from the label's 10-digit format (4-4-2, 5-3-2 or 5-4-1) to the 11-digit 5-4-2 format by adding a leading zero to the short segment, with qualifier N4, a unit qualifier (UN/ML/etc.) and quantity.
  - **Item 19:** "DrugX 500mg IV NDC 12345067890 $X", with a length check (up to 80 characters).
  - **Administration line:** 96413 (+96415 if needed).
  - **Item 21 diagnosis:** ICD-10 suggested by AI from the note (e.g. C34.90), confirmed by a human and checked against the approved use.
  - **Provider NPI** (Items 24J / 33) from the verified sign-up.
  - **Payer-specific rules:** Medicare rules by default; commercial payer rules where encoded.
- **Pre-submission checks** (green, or red with a **Fix** link):
  1. Drug details complete in Item 19
  2. NDC in 11-digit format and matches the invoice
  3. Units correct for the code type and payer
  4. JW/JZ applied correctly
  5. Diagnosis matches an approved use
  6. Documentation complete (from Step 9)
  7. Administration code matches the infusion times
  8. Attachments ready (and prior auth on file if the payer requires it)
- **Attachment packet:** invoice, FDA label and signed note, bundled into one PDF.
- Hover over any field to see **why this value** and where it came from.

### Step 12: Filing (biller)
- **The biller reviews and clicks Export:** a CMS-1500 PDF plus the packet, "ready for your clearinghouse." **Nothing is auto-submitted.**
- In real life, the clearinghouse forwards the claim to the insurer.

### Step 13: Get help (anyone at the practice)
- A **Get help** button on the Drug page, Team board and Claims.
- It packages the issue: drug, payer, the failing check or step, and the practice contact. **Patient identifiers are stripped before sending.**
- Sending is the practice's explicit choice, so sharing that practice's identity with the drug maker is consented.
- It appears in the drug maker's **Help requests** queue. Educational and product-specific only.

### Step 14: Switch Day (automatic)
- When CMS's quarterly update assigns DrugX its permanent code:
  - Alert: *"DrugX now has J9xxx (per 1 mg), effective Oct 1."*
  - For dates of service on or after Oct 1, templates switch: **units = dose ÷ the code's billing unit** (500 mg → 500 units), and JW waste units are recalculated the same way.
  - Draft claims that need recoding are flagged.
  - The doctor sees: **"The barrier is gone. Review your hold list (3 patients)."**
- *Demo note: a "simulate CMS update" button triggers this.*

### Step 15: Pharma launch dashboard (drug maker)
- **Top numbers:** practices that viewed DrugX, got ready, started, are stuck, or have returned claims. Countdown to the permanent code.
- **By region, not by practice:** readiness and hesitation shown per region or specialty. Individual practices appear only if they opted in or sent a help request.
- **Hesitation reasons:** which light was yellow when practices didn't proceed (coverage, billing path, payment timing, workflow), which tells the drug maker what kind of help to send.
- **Top snags:** e.g. "40% of first orders missing test-method documentation" → **[Send guidance to all practices]**.
- **Help requests** → **[Assign specialist]**.
- **Small counts hidden:** any number under 5 shows as "<5" so no practice can be singled out.
- *Demo note: dashboard numbers are seeded and labeled as mock.*

---

## 8. How insurance fits in

The insurer (payer) is **the other side of every claim**. LaunchReady doesn't need insurers to cooperate: it reads their **public** rules and sends them **standard, complete** claims.

| Insurer's role | What it means | Where it shows up in LaunchReady |
|---|---|---|
| **Coverage** | Does the insurer pay for this drug for this patient? Medicare Part B generally covers FDA-approved, medically necessary uses. Commercial insurers write their own policies and may still be reviewing a brand-new drug. | **Coverage light** on the Considering page. Prior-auth flag at ordering. |
| **Prior authorization** | Many commercial plans require approval before treatment | Flagged, not automated (existing tools like CoverMyMeds cover this) |
| **Claim rules** | Each insurer decides what a generic-code claim must include (units, Item 19, invoice) | Stored as payer rules with citations; used by the claim builder and checks |
| **Pricing** | No set price for generic codes, so the insurer prices by hand (often from the invoice or list price) | Why the invoice is attached; why payment timing is slower |
| **Processing** | Reviews, pays, returns or denies claims; appeals | Pre-submission checks aim for a clean claim on the first try |
| **Patient cost share** | E.g. Medicare's 20% coinsurance | Out of scope (future: point to the drug maker's patient-support program) |

**The honest nuance:** insurers benefit from clean claims (less manual review), but they aren't eager to speed up use of expensive new drugs. That's why LaunchReady relies only on public policies and standard claims, not on insurer participation.

**Scope for the demo:** Medicare (one contractor) plus one or two commercial insurers' public policies.

---

## 9. Data sources

| Data | Source | Real or mocked |
|---|---|---|
| Doctor identity and specialty | **NPPES NPI Registry API** | **Real, live** |
| Drug label facts | openFDA drug label API (DailyMed) | **Real, live** |
| NDCs and packages | openFDA NDC API | **Real, live** |
| Permanent-code status | CMS quarterly HCPCS file | **Real** (loaded file) |
| Pending code applications | CMS HCPCS application summaries (PDF) | **Real** (AI-parsed) |
| Units after the permanent code | CMS ASP NDC–HCPCS crosswalk | **Real** (loaded file) |
| Medicare generic-code rules | Noridian / FCSO guidance, encoded with citations | **Real** (encoded) |
| Insurer coverage policies | Public medical-policy documents (1–2 commercial insurers) | **Real** (AI-parsed) |
| Patients | Entered in the app; demo patients generated with Synthea | Mocked, labeled |
| Doctor's note | Pasted or uploaded in the app, editable live | Mocked, labeled |
| Invoice | Realistic PDF, uploaded live | Mocked, labeled |
| Cost per dose | Drug maker input / invoice | Mocked |
| Authorized distributors | Drug maker input (launch sponsor) | Mocked, labeled |
| Impiricus launch message | Email / in-app card | Mocked, labeled |
| Pharma dashboard numbers | Seeded data | Mocked, labeled |

**No EMR/EHR integration.** LaunchReady is standalone, built for independent and private practices. Patients, notes and treatment records are entered or uploaded directly.

---

## 10. Data and compliance

### Three data tiers
| Tier | What | Who can see it | Protection |
|---|---|---|---|
| **1. Public** | FDA labels, CMS files, insurer policies, NPI registry | Everyone | None needed |
| **2. Practice and patient data (PHI)** | Patients, notes, orders, treatment records, claims, invoices, hold list | **Only that practice**, by role (doctor, nurse, biller, front desk) | HIPAA: the platform operates as the practice's **business associate** under a signed **BAA**. Encrypted at rest and in transit, role-based access, minimum necessary, audit log of who viewed what. **Never leaves the practice's workspace.** |
| **3. Signals to pharma** | Readiness, hesitation reasons, snags, help requests | The drug maker | **Opt-in, de-identified, aggregated by region or specialty.** Counts under 5 hidden. No patient-level data, ever. A practice is named only if it opted in or sent a help request. |

### Data flow
```
 Public sources ──► Drug profile ──► Considering page (per practice)
 (FDA, CMS,                              │
  insurers, NPI)                         ▼
                             ┌─ Practice workspace (PHI) ─┐
                             │ patients · notes · orders  │
                             │ treatment · claims · hold  │
                             └─────────────┬──────────────┘
                                           │ de-identify + aggregate
                                           │ (opt-in, hide counts <5)
                                           ▼
                                  Pharma dashboard (no PHI)
                                           ▲
                   Help request ───────────┘ (practice-initiated,
                                              patient data stripped)
```

### Pharma-sponsorship rules
- **Product-specific and educational.** Help is only about the sponsored drug.
- **No profit or margin messaging.** Payment timing and risk only.
- **The practice stays in control.** The app drafts; the practice reviews and submits every claim. Nothing is auto-submitted.
- **No clinical decisions.** The app checks documentation; the doctor decides treatment.
- **Clear labeling** of sponsored content, and "verify with your Medicare contractor or payer" throughout.
- **Verified HCPs only** (NPI).
- **Open questions for Impiricus compliance:** whether a pharma-funded free tool counts as a transfer of value to doctors (Sunshine Act / Open Payments) or an inducement (anti-kickback statute). Our design keeps it informational and product-specific to minimize both.

---

## 11. What's AI and what's plain code

| AI (reading messy text) | Plain code (rules and math) |
|---|---|
| Extract facts from FDA label text | NPI lookup and verification |
| Read CMS application summary PDFs | Pick the generic code |
| Read insurer coverage policies | NDC 10→11 conversion |
| Read the invoice PDF | Units (generic vs permanent code, per payer) |
| Check the note against approved-use and payer requirements | JW/JZ waste modifier and waste amount |
| Draft missing note text | Administration code from infusion times |
| Draft team board tasks | Dose from weight × label, and least-waste vial mix |
| Suggest a diagnosis code (human confirms) | Item 19 template and length check |
| Summarize a help request | Pre-submission checks, Switch Day logic, cash-timing estimate, de-identification and aggregation |

**Principle:** AI reads, code calculates, a human approves.

---

## 12. Tech stack (suggested)
- **Frontend:** Next.js + Tailwind + shadcn/ui, one app with a role switcher.
- **Backend and database:** Supabase (Postgres, real-time updates for the team board and claim, file storage for PDFs, row-level security so each practice sees only its own data). Keep the database simple; the judges care more about the data flow and compliance than the database engineering.
- **AI:** an LLM with structured JSON output and citations.
- **Rules engine:** TypeScript module for code selection, NDC, units, modifiers, administration codes and checks, with unit tests.
- **PDF:** fill a CMS-1500 template (or an HTML replica exported to PDF) and merge the attachment packet.
- **External:** NPPES and openFDA APIs live; CMS files and insurer policies preloaded.

---

## 13. Scope limits and next steps
- **Scope:** Medicare physician-office rules plus one or two commercial insurers. Standalone app with no EMR integration. Pharma dashboard data is mocked.
- **Future:** more insurers, automatic CMS and insurer-policy monitoring, hospital outpatient (C9399), pointing to the drug maker's patient-support programs, and consented payment-outcome benchmarks.
- **Before building:**
  1. Pick a real demo drug that's currently on a generic code.
  2. Verify the Medicare rules (Item 19 contents, units = 1, invoice, JW/JZ) on the chosen contractor's current page.
  3. Find one or two public commercial insurer policies for that drug.
  4. Test the NPPES API with a real NPI.
