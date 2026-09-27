"""Put the demo back to a clean start: one command before each rehearsal.

    python scripts/reset_demo.py <practice email> [--received] [--all-workspaces]

Run from `backend/` (needs backend/.env with SUPABASE_URL +
SUPABASE_SERVICE_ROLE_KEY). The practice must already exist (sign up through
the app first). Re-runnable; every step overwrites rather than appends.

1. Practice profile: the demo payers (the three Pasatru has policies for) and
   capabilities, so "Review insurers" and the Considering lights have data.
2. Pasatru's demo data (DEMO_DRUG below): billing codes, payer policies,
   distributors, vial strengths and dose. Re-launching Pasatru through the
   drug-maker page rewrites `ndcs` without `strength_mg`, which breaks every
   order -- this puts it back.
3. Deletes the practice's Pasatru workspace (cascading to its tasks and
   treatments), so the demo starts at "considering": opening Pasatru's drug
   page recreates it. With --all-workspaces, every workspace of the practice.
4. Reseeds the three demo patients (scripts/seed_patients.py).
5. --received: pre-creates the Pasatru workspace with an invoice and stock on
   hand, the safety net if the Receiving card can't record one yet. 10 vials
   covers Maria's 7 with no purchase; the next patient gets a "Buy" card.
"""

import argparse
import os

from dotenv import load_dotenv
from supabase import create_client

from seed_patients import find_practice, seed_patients

load_dotenv()

DEMO_APPLICATION_ID = "BLA761508"  # Pasatru

DEMO_PAYERS = ["Medicare", "BCBS", "Aetna"]
DEMO_CAPABILITIES = {"infusion_chairs": True, "refrigeration": True}

NDC_11 = "61755-0012-01"
DEMO_DRUG = {
    "typical_adult_dose": {"amount": 10, "unit": "mg/kg"},
    "is_single_dose_vial": True,
    "is_antineoplastic": False,
    "has_permanent_code": False,
    "generic_billing_code": "J3590",
    "permanent_hcpcs_code": None,
    "ndcs": [
        {
            "ndc_10": "61755-012-01",
            "ndc_11": NDC_11,
            "sample": False,
            "description": "1 VIAL, SINGLE-DOSE in 1 CARTON (61755-012-01) / 5 mL in 1 VIAL, SINGLE-DOSE (61755-012-00)",
            "single_dose": True,
            "strength_mg": 100,
        }
    ],
    # The generic code must end the day before the permanent one starts, or
    # billing_rules.code_for raises on the overlap.
    "codes": [
        {"code": "J3590", "type": "generic", "from": "2026-02-01", "to": "2026-09-30"},
        {"code": "J0289", "type": "permanent", "unit": "1 MG", "from": "2026-10-01"},
    ],
    "distributors": [{"name": "ASD Healthcare"}, {"name": "McKesson Specialty Health"}],
    "payer_policies": [
        {
            "payer": "Medicare",
            "covered": True,
            "prior_auth": False,
            "notes": "Covered for approved uses per LCD. No prior authorization required.",
        },
        {
            "payer": "BCBS",
            "covered": True,
            "prior_auth": True,
            "notes": "Prior authorization required before first dose. Requires documented FOP diagnosis with genetic confirmation of an ACVR1 mutation.",
            "documentation_requirements": ["Genetic confirmation of an ACVR1 mutation (e.g. R206H)"],
        },
        {
            "payer": "Aetna",
            "covered": None,
            "prior_auth": None,
            "notes": "Policy under review. Verify coverage before treatment.",
        },
    ],
}

DEMO_LOT = "PSA24091"
DEMO_VIALS = 10
DEMO_INVOICE = {
    "file_path": None,
    "distributor": "ASD Healthcare",
    "uploaded_at": "2026-09-28T09:00:00+00:00",
    "lines": [{"ndc_11": NDC_11, "lot": DEMO_LOT, "quantity": DEMO_VIALS, "cost_per_vial": 1850.00}],
}


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("email", help="the demo practice's sign-in email")
    parser.add_argument(
        "--received", action="store_true", help="start with Pasatru's invoice and stock already recorded"
    )
    parser.add_argument(
        "--all-workspaces", action="store_true", help="delete every workspace of the practice, not just Pasatru's"
    )
    args = parser.parse_args()

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    practice = find_practice(supabase, args.email)
    print(f"Resetting the demo for {practice['name']} ({args.email}, practice {practice['id']})")

    supabase.table("practices").update(
        {"payers": DEMO_PAYERS, "capabilities": DEMO_CAPABILITIES}
    ).eq("id", practice["id"]).execute()
    print(f"1. Practice: payers {', '.join(DEMO_PAYERS)}; infusion chairs + refrigeration")

    drug = (
        supabase.table("drugs")
        .update(DEMO_DRUG)
        .eq("application_id", DEMO_APPLICATION_ID)
        .execute()
        .data
    )
    if not drug:
        raise SystemExit(f"Demo drug {DEMO_APPLICATION_ID} isn't in the drugs table -- launch it first")
    print(f"2. {drug[0]['brand_name']}: codes, payer policies, distributors, vials and dose restored")

    workspaces = supabase.table("practice_drugs").delete().eq("practice_id", practice["id"])
    if not args.all_workspaces:
        workspaces = workspaces.eq("application_id", DEMO_APPLICATION_ID)
    deleted = workspaces.execute().data
    scope = "all workspaces" if args.all_workspaces else "the Pasatru workspace"
    print(f"3. Deleted {scope} ({len(deleted)} row{'s' if len(deleted) != 1 else ''}, with their tasks and treatments)")

    count = seed_patients(supabase, practice["id"])
    print(f"4. Seeded {count} patients (Maria / Medicare, James / BCBS, Aisha / Aetna)")

    if args.received:
        supabase.table("practice_drugs").insert(
            {
                "practice_id": practice["id"],
                "application_id": DEMO_APPLICATION_ID,
                "status": "considering",
                "invoices": [DEMO_INVOICE],
                "stock_on_hand": [{"ndc_11": NDC_11, "lot": DEMO_LOT, "quantity": DEMO_VIALS}],
            }
        ).execute()
        print(f"5. Pasatru received: {DEMO_VIALS} vials of lot {DEMO_LOT} at $1,850.00 each, invoice on file")

    print("Done. Next: sign in, open Pasatru, click \"Get my team ready\".")


if __name__ == "__main__":
    main()
