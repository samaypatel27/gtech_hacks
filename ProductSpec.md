# LaunchReady — Product Spec (working name)

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
- **Result:** some practices "simply wait until the permanent code is assigned" (IPD Analytics), and billing confusion can make providers switch to a competitor's drug (MMIT).
- **Honest limit:** there's no public statistic on how much this delays adoption, so we say practices are *apprehensive*, not that they refuse.

**Key sources:** Noridian and FCSO (Medicare contractor rules), CMS HCPCS coding procedures, IPD Analytics, MMIT, STAT (sponsored by J&J), and the Mesoblast, Eagle and Omeros J-code announcements.

---

## 3. Who it's for

| Role | Who | What they get |
|---|---|---|
| **Main user** | The doctor, especially an independent practice owner in a buy-and-bill specialty (oncology, ophthalmology, rheumatology, urology) who carries the financial risk | A clear adoption answer, a documentation check when ordering, and a heads-up when the code goes live |
| **Supporting users** | Nurse, biller, front desk | Drafted tasks, a prefilled treatment form, a claim built for them |
| **Customer (pays)** | The drug maker, through Impiricus | Faster launch uptake, plus visibility into where practices hesitate or get stuck |
| **Beneficiary** | The patient | Gets the new treatment sooner |

**Business model:** free for practices, sponsored per drug launch by the drug maker through Impiricus (like CoverMyMeds: free to providers, funded by pharma).

---

## 4. The workflow in plain language

**The characters:** Dr. Patel runs a small cancer practice. Maria, 62, has lung cancer that got worse on standard chemo. DrugX is a new cancer drug.

1. **The drug maker launches DrugX.** The FDA approves it, but it has no permanent billing code yet, so it has to be billed under the generic code J9999. The drug maker turns DrugX on in LaunchReady.

2. **The app builds DrugX's profile automatically.** It reads the FDA label and CMS's data, then works out which generic code applies, what the claims will need, how the drug must be stored and given, and when the permanent code is expected. Nobody at any clinic has to do anything.

3. **Dr. Patel hears about DrugX.** It might be through an Impiricus launch message, a rep, a conference, or a patient asking. She taps **"Can my practice use this?"** (or searches for the drug in the app).

4. **The app answers for her practice specifically.** She sees three lights:
   - **Billing path:** "Billed under J9999 for now. Claims need extra details, but **we can draft and check them for you**, and we'll switch automatically when the permanent code arrives."
   - **Payment timing:** "Generic-code claims pay slower. Here's roughly how much cash would be tied up for the patients you're planning."
   - **Workflow:** "Must be refrigerated, 60-minute infusion, needs a filter. Your practice has what it needs."

5. **Dr. Patel decides.** Knowing the billing is handled, she decides to start using DrugX. If she weren't ready yet, she could add patients to a **hold list** and ask to be notified when the permanent code goes live.

6. **The team gets ready.** She clicks **"Get my team ready,"** and the app drafts a checklist for each person:
   - **Front desk:** how to receive and store the drug.
   - **Nurse:** how to prepare and give it, and what to record.
   - **Biller:** exactly how to bill it while it's on the generic code.

7. **The clinic buys the drug.** The practice orders DrugX from its distributor and pays up front. The front desk uploads the invoice, and the app reads the NDC, lot number and price.

8. **Dr. Patel orders DrugX for Maria.** She makes the medical decision herself; the app doesn't. She clicks **New Order → DrugX**, and the app calculates the dose from Maria's weight.

9. **The app checks the paperwork.** It reads Dr. Patel's note and checks that it documents everything payers need for DrugX: diagnosis, mutation result, prior treatment. It finds the test method is missing and **drafts the missing sentences**. She approves them and signs the order.

10. **Maria gets the medicine.** The nurse gives the infusion. The nurse's form is already filled in from the order and invoice, so she only confirms the dose and enters start and stop times. The app works out how much drug was wasted and which administration code applies.

11. **The app builds the reimbursement claim.** It drafts the CMS-1500 with everything a generic-code claim needs:
    - the code and waste modifier
    - units = 1
    - the NDC in 11-digit format
    - the drug description in Item 19
    - the diagnosis code
    - the infusion line

    Then it runs its checks and bundles the invoice, FDA label and signed note.

12. **The clinic files for reimbursement.** The biller reviews the claim, sees every check green, and clicks **Export**. The claim goes out through the clinic's clearinghouse to Medicare. Because nothing is missing, it doesn't get bounced back, and the clinic gets paid sooner.

13. **If anything goes wrong, they get help.** A red check shows exactly what to fix. If the practice is stuck or a claim is denied, **Get help** packages the problem and sends it to DrugX's reimbursement specialist.

14. **The permanent code arrives (Switch Day).** CMS assigns DrugX its own code. The app switches every claim template automatically (new code, units calculated from the dose), and Dr. Patel sees: **"The barrier is gone. Review your hold list (3 patients)."**

15. **Throughout, the drug maker sees the big picture.** Its dashboard shows which practices looked at DrugX, which got ready, which started, and where they hesitated or got stuck. So it knows **which doctors to help, when, and with what.**

---

## 5. Product structure: one app, two sides

One web app with a sidebar. A **"Viewing as"** dropdown switches roles (demo shortcut); in real life each person logs in and sees only their own part.

**Clinic side**
| Page | Used by | Purpose | Workflow step |
|---|---|---|---|
| Home | Doctor | Launch message inbox and drug search | 3 |
| Drug page ("Considering") | Doctor | "Can my practice use this?" | 4–5 |
| Hold list | Doctor | Private list of waiting patients | 5, 14 |
| Team board | Whole team | Role checklists | 6 |
| Receiving | Front desk | Invoice upload | 7 |
| Patients | Doctor | Chart, ordering, documentation check | 8–9 |
| Treatments | Nurse | Administration form | 10 |
| Claims | Biller | Claim review, checks, export | 11–13 |
| Practice settings | Practice manager | Practice profile (once) | — |

**Pharma side**
| Page | Used by | Purpose | Workflow step |
|---|---|---|---|
| Launch dashboard | Drug maker's launch team | Where practices hesitate or get stuck | 15 |
| Help requests | Drug maker's reimbursement specialists | Packaged help requests | 13 |

---

## 6. The detailed steps

### Step 1–2: Drug profile, built automatically (once per drug)
- **Trigger:** the drug maker activates DrugX.
- **The app:**
  - Pulls the FDA label from the **openFDA drug label API** and NDCs and packages from the **openFDA NDC API**.
  - **AI** extracts, with citations to label sections: approved uses and their conditions, dosing (e.g. mg/kg), route, infusion time, preparation (e.g. in-line filter), storage, and single- vs multi-dose vials.
  - **Code** picks the generic code: cancer drug → J9999; otherwise biologic (application number starts with "BLA") → J3590; otherwise J3490. Rules are stored as data with citations, because payers vary. *(Verify the cancer-biologic case for the demo drug.)*
  - **Code** checks the CMS quarterly HCPCS file to confirm no permanent code exists yet.
  - **AI** reads CMS's published HCPCS application summaries to find whether a permanent code has been applied for and the expected effective date.
- **Edge case:** if the drug already has a permanent code, the app says "Standard billing applies (J____)" and skips the generic-code flow.
- **Practice profile (once per practice):** specialty, setting (physician office), region (which Medicare contractor), main payers, and capabilities (infusion chairs, refrigeration). Clinic IDs (NPI, tax ID) go in config.

### Step 3–4: Considering (doctor)
- **Entry points:** an Impiricus launch message (mocked as email or in-app, **not SMS**), searching on Home, or a shared link.
- **The DrugX page, personalized to the practice, with three lights:**

| Light | Example text | How it's built |
|---|---|---|
| **Billing path** 🟡 | "Billed under J9999 until its permanent code arrives (expected Oct 1). Claims need a drug description, the 11-digit NDC and the invoice. **We can draft and check these for you, and switch automatically when the permanent code goes live.**" | Code rules, encoded Medicare contractor rules, CMS application status |
| **Payment timing** 🟡 | "Generic-code claims are priced by hand, so expect slower payment. Estimated cash tied up for 3 patients: ~$X." (labeled as an estimate) | Cost per dose (from the drug maker or invoice) × planned patients × typical payment delay. **Timing only, never profit.** |
| **Workflow** 🟢 | "Refrigerate 2–8°C. 60-min IV infusion with in-line filter. Your practice has infusion chairs ✓." | AI label extraction compared with the practice profile |

- Every fact links to its source (label section, CMS file, contractor rule).
- **Actions:** Get my team ready · Add patients to hold list · Notify me when the permanent code is live · Talk to DrugX's reimbursement specialist.
- **Logged for pharma (anonymous):** page viewed, which lights were yellow or red, which action was taken, or none.

### Step 5: Decision and hold list (doctor)
- **Proceed:** go to the team board.
- **Wait:** add patients to the **hold list**, a private list stored on the practice side. Pharma sees only an anonymous count ("3 on hold"), and only if the practice opts in. Each entry can later become an order.

### Step 6: Team board (whole practice)
- Three columns, each task **drafted by AI** from the drug profile:
  - **Front desk / receiving:** storage requirements, receiving checklist, invoice filing.
  - **Nurse:** preparation and administration steps from the label, and what to record (dose, waste, start/stop times, lot).
  - **Biller:** "DrugX bills as J9999 with units = 1," the Item 19 template, NDC format, JW/JZ rule, invoice requirement, and the permanent-code date.
- Tasks can be checked off, and **everyone sees updates live.** Readiness progress feeds the pharma dashboard (anonymized).

### Step 7: Buying the drug and the invoice (front desk)
- The practice buys DrugX from its distributor and **uploads the invoice PDF**.
- **AI** reads it: NDC, lot number, quantity, cost per vial.
- **Code** confirms the NDC matches a DrugX package from openFDA and flags a mismatch.

### Step 8–9: Ordering and documentation check (doctor)
- **The doctor makes the clinical decision.** The app makes no clinical call.
- On the patient's chart: **New Order → DrugX**.
- **Dose** is calculated by code from weight × the label dose (e.g. 500 mg → 2 × 300 mg vials, 100 mg expected waste).
- A **"Documentation for payers"** sidebar opens. **AI** reads the free-text note and checks it against the label's approved-use requirements, quoting the note for each item:
  - ✓ Diagnosis documented (stage IV NSCLC)
  - ✓ Mutation result documented (KRAS G12C)
  - ✓ Prior therapy documented
  - ✗ Test method not documented → **[Draft addition]**
  - ✓ Dose, route and frequency in the order
- **Draft addition:** AI writes the missing text from the chart; the doctor edits or approves it, and it goes into the note.
- **Wording:** "Ready for typical payer requirements," never "approved" or "cleared."
- The doctor **signs the order**.
- *Demo note: the note is editable live. Deleting the KRAS line flips its check to ✗, which proves it's real.*

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
  - Clinic info from config; patient and insurance info from the synthetic record.
- **Pre-submission checks** (green, or red with a **Fix** link):
  1. Drug details complete in Item 19
  2. NDC in 11-digit format and matches the invoice
  3. Units correct for the code type
  4. JW/JZ applied correctly
  5. Diagnosis matches an approved use
  6. Documentation complete (from Step 9)
  7. Administration code matches the infusion times
  8. Attachments ready
- **Attachment packet:** invoice, FDA label and signed note, bundled into one PDF.
- Hover over any field to see **why this value** and where it came from.

### Step 12: Filing (biller)
- **The biller reviews and clicks Export:** a CMS-1500 PDF plus the packet, "ready for your clearinghouse." **Nothing is auto-submitted.**
- In real life, the clearinghouse forwards the claim to Medicare or the payer.

### Step 13: Get help (anyone at the practice)
- A **Get help** button on the Drug page, Team board and Claims.
- It packages the issue: drug, the failing check or step, the claim draft **without patient identifiers**, and the practice contact.
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
- **Map or list** of opted-in practices, colored 🟢 / 🟡 / 🔴.
- **Hesitation reasons:** which light was yellow when practices didn't proceed, which tells the drug maker to send reimbursement education rather than clinical reps.
- **Top snags:** e.g. "40% of first orders missing test-method documentation" → **[Send guidance to all practices]**.
- **Help requests** → **[Assign specialist]**.
- **Privacy:** practice-level and aggregate only, never patient data, opt-in.
- *Demo note: dashboard numbers are seeded and labeled as mock.*

---

## 7. Data sources

| Data | Source | Real or mocked |
|---|---|---|
| Drug label facts | openFDA drug label API (DailyMed) | **Real, live** |
| NDCs and packages | openFDA NDC API | **Real, live** |
| Permanent-code status | CMS quarterly HCPCS file | **Real** (loaded file) |
| Pending code applications | CMS HCPCS application summaries (PDF) | **Real** (AI-parsed) |
| Units after the permanent code | CMS ASP NDC–HCPCS crosswalk | **Real** (loaded file) |
| Medicare generic-code rules | Noridian / FCSO guidance, encoded with citations | **Real** (encoded) |
| Patients | Synthea synthetic patients (FHIR JSON) | Mocked, labeled |
| Doctor's note | Free text, editable live | Mocked, labeled |
| Invoice | Realistic PDF, uploaded live | Mocked, labeled |
| Cost per dose | Drug maker input / invoice | Mocked |
| Impiricus launch message | Email / in-app card | Mocked, labeled |
| Pharma dashboard numbers | Seeded data | Mocked, labeled |

**Real-world integration:** in a real deployment, LaunchReady connects to the practice's health record system (like Epic) through FHIR, the standard healthcare data API. The demo uses synthetic patients in that same format.

---

## 8. What's AI and what's plain code

| AI (reading messy text) | Plain code (rules and math) |
|---|---|
| Extract facts from FDA label text | Pick the generic code |
| Read CMS application summary PDFs | NDC 10→11 conversion |
| Read the invoice PDF | Units (generic vs permanent code) |
| Check the note against approved-use requirements | JW/JZ waste modifier and waste amount |
| Draft missing note text | Administration code from infusion times |
| Draft team board tasks | Dose from weight × label |
| Suggest a diagnosis code (human confirms) | Item 19 template and length check |
| Summarize a help request | Pre-submission checks, Switch Day logic, cash-timing estimate |

**Principle:** AI reads, code calculates, a human approves.

---

## 9. Guardrails
- **No real patient data.** Synthetic data only; hold-list identities stay on the practice side.
- **No clinical decisions.** The app checks documentation; the doctor decides treatment.
- **No profit or margin messaging.** Payment timing and risk only.
- **"Ready for typical payer requirements,"** never "approved" or "cleared." "Verify with your Medicare contractor or payer" throughout.
- **A human reviews and submits every claim.** Nothing is auto-submitted.
- **Help is optional and product-specific.** The app drafts; the practice stays in control. Sponsored content is clearly labeled.
- **Opt-in, aggregate data only** reaches pharma.

---

## 10. Tech stack (suggested)
- **Frontend:** Next.js + Tailwind + shadcn/ui, one app with a role switcher.
- **Backend and database:** Supabase (Postgres, real-time updates for the team board and claim, file storage for PDFs).
- **AI:** an LLM with structured JSON output and citations.
- **Rules engine:** TypeScript module for code selection, NDC, units, modifiers, administration codes and checks, with unit tests.
- **PDF:** fill a CMS-1500 template (or an HTML replica exported to PDF) and merge the attachment packet.
- **External:** openFDA APIs live; CMS files preloaded.

---

## 11. Scope limits and next steps
- **Scope:** Medicare physician-office rules only (maybe one public commercial payer policy). Health-record integration and pharma data are mocked.
- **Future:** more payers, real health-record integration, automatic CMS monitoring, hospital outpatient (C9399), and consented payment-outcome benchmarks.
- **Before building:**
  1. Run it past the Impiricus mentors.
  2. Pick a real demo drug that's currently on a generic code.
  3. Verify the Medicare rules (Item 19 contents, units = 1, invoice, JW/JZ) on the chosen contractor's current page.
