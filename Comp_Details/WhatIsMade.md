I updated [BuildPlan.md](Comp_Details/BuildPlan.md) (section 5 is now the 8-table design) and changed the older table names in the phase steps to match. Then I compared our plan to what's in the repo, without changing any code.

**Legend:** ✅ done · 🟡 partly done · ❌ not started

## Behind the scenes: the drug maker launches a drug
| What should happen | Status | What's there now |
|---|---|---|
| Drug maker enters a drug and the app builds its profile | ✅ | "Drug maker" page: enter name and application ID, it fetches everything and saves |
| Fetch the FDA label | ✅ | Live openFDA call |
| AI reads the label (dosing, infusion time, preparation, single-dose vial, approved uses and required tests), with citations | ✅ | Claude extraction works, with sources for each field. Two extracted values (typical dose, "is it a cancer drug") aren't saved. |
| Storage requirements | ✅ | Saved as raw label text |
| Vial sizes and NDCs | 🟡 | NDC list fetched and saved, but not converted to 11 digits and vial strengths aren't parsed out |
| Pick the generic code (J9999 / J3590 / J3490) | ✅ | Works, but the logic runs in the browser instead of the backend |
| Check whether a permanent code exists | 🟡 | Uses the real CMS file, but matches by brand name (not NDC) and ignores effective dates |
| Expected permanent-code date | ❌ | Placeholder value that's in the past |
| Code history with start and end dates (the base for Switch) | ❌ | — |
| Insurer coverage per payer | ❌ | — |
| Distributors (where to buy) | ❌ | — |
| Cost per dose | 🟡 | Uses Medicare's payment amount, and only for drugs that already have a code. Not what we planned. |
| Sources for every fact | ✅ | Citations saved |
| Save the drug to the database | ✅ | `drugs` table, plus 20 seeded drugs with basic info only |
| Quarterly CMS data refresh | ✅ | Script exists |
| Packaging images | ✅ | Extra: DailyMed images on the drug page |

## Stage 1: Consider ("Can we use this?")
| What should happen | Status | What's there now |
|---|---|---|
| Doctor signs up with NPI | ❌ | No sign-up; Home just has "Drug maker" and "Doctor" buttons |
| Practice profile (insurers, capabilities) | ❌ | No practices table |
| Home with launch messages and search | 🟡 | A grid of all drugs with vial images and amber/green status. No search box and no launch messages. |
| Drug page shows the drug's info | 🟡 | Sections for billing path, payment timing, workflow and clinical specs, but it lists raw fields. Sources show only as a count. |
| **Four lights**, personalized to the practice | ❌ | No lights, no coverage, no "we can draft these for you" message |
| Actions: team ready, hold, notify me, talk to specialist | 🟡 | "Get my team ready" and "Add patients to hold list" buttons exist but don't do anything. The other two don't exist. |
| Save the decision and log it | ❌ | — |

## Stage 2: Prepare ("Are we ready?")
| What should happen | Status |
|---|---|
| Team board (home screen) with tasks for each role | ❌ |
| Purchasing card (distributors, vial mix, quantity) | ❌ |
| Invoice upload and AI reading | ❌ |
| Stock on hand | ❌ |
| Hold list | ❌ |

## Stage 3: Treat & Bill ("Will we get paid?")
| What should happen | Status |
|---|---|
| Patients and visit notes | ❌ |
| Doctor orders the drug, with dose and vial mix | ❌ |
| Documentation check with quotes | ❌ |
| AI drafts missing note text; doctor signs | ❌ |
| "Buy for this patient" task when there's no stock | ❌ |
| Nurse's treatment form (waste, infusion code) | ❌ |
| Claim builder (CMS-1500) and the 8 checks | ❌ |
| Export with attachments | ❌ |

## Stage 4: Switch ("What now that the code is here?")
| What should happen | Status | Notes |
|---|---|---|
| Permanent code takes effect by date of service | ❌ | The app already knows generic vs. permanent codes, but nothing about dates |
| Claims flagged for recoding; corrected claims | ❌ | |
| "Review your hold list" alert | ❌ | |

## Pharma side (throughout)
| What should happen | Status | Notes |
|---|---|---|
| Launch drug page | ✅ | Works, with a progress log |
| Activity log | ❌ | |
| Dashboard (funnel, hesitation reasons, snags) using the privacy view | ❌ | |
| Get help and the help queue | ❌ | |

## Across the whole app
| What should happen | Status | Notes |
|---|---|---|
| Role switcher (doctor, nurse, biller, front desk, pharma) | 🟡 | Only "Drug maker" and "Doctor" |
| Secret keys kept on the server; row-level security on | ✅ | Good compliance foundation |
| Endpoints protected from unauthorized writes | ❌ | Anyone can save or overwrite a drug |
| Audit trail and privacy boundary | ❌ | |
| Billing-rule tests | ❌ | |
| Visual polish | ✅ | Animated background, 3D vials, loading animations |

## Summary
- **Behind the scenes (drug profile):** roughly **60–70% done.** The FDA and CMS connections and the Claude label reading all work.
- **Consider:** about **20%.** There's a drug grid and a detail page, but no sign-up, practice profile or four lights.
- **Prepare, Treat & Bill, Switch and the pharma dashboard:** not started.

**Worth reusing even though we're rebuilding** (your call later):
- The openFDA and CMS fetching code
- The Claude extraction instructions and output format, which are well done
- The CMS refresh script
- The drug grid and detail page styling

Everything from the patient onward, which is where the core billing automation lives, still needs to be built.