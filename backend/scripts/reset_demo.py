"""Put the demo back to a clean start: one command before each rehearsal.

    python scripts/reset_demo.py <practice email> [--launch-live | --received] [--all-workspaces]

Run from `backend/` (needs backend/.env with SUPABASE_URL +
SUPABASE_SERVICE_ROLE_KEY). The practice must already exist (sign up through
the app first). Re-runnable; every step overwrites rather than appends.

1. Practice profile: the demo payers (the three Pasatru has policies for, plus
   UnitedHealthcare, which has none) and capabilities, so "Review insurers"
   and the Considering lights have data.
2. Pasatru: writes the whole drug row from scripts/pasatru_demo.json (FDA
   label data plus the demo launch details: codes, insurer policies,
   distributors, vial size and price), creating it if it was deleted from the
   drug list. With --launch-live it deletes Pasatru instead, so the demo can
   launch it from the Drug Maker page ("Fill example") and every practice gets
   the "New drug" message.
3. Deletes the practice's Pasatru workspace (cascading to its tasks and
   treatments), so the demo starts at "considering": opening Pasatru's drug
   page recreates it. With --all-workspaces, every workspace of the practice.
4. Reseeds the demo patients (scripts/seed_patients.py).
5. Clears the practice's notifications (the bell), so launching Pasatru from
   the drug-maker page sends its "New drug" message again.
6. --received: pre-creates the Pasatru workspace with an invoice and stock on
   hand, the safety net if the Receiving card can't record one yet. 4 vials
   cover Maria's 3 with no purchase; James's order then gets a "Buy" card.
"""

import argparse
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

from seed_patients import find_practice, seed_patients

load_dotenv()

# The complete Pasatru row. Edit this file to change the demo drug's data.
DEMO_DRUG = json.loads((Path(__file__).parent / "pasatru_demo.json").read_text(encoding="utf-8"))
DEMO_APPLICATION_ID = DEMO_DRUG["application_id"]
NDC_11 = DEMO_DRUG["ndcs"][0]["ndc_11"]

# UnitedHealthcare has no Pasatru policy on file: the Coverage light says "verify".
DEMO_PAYERS = ["Medicare", "BCBS", "Aetna", "UnitedHealthcare"]
DEMO_CAPABILITIES = {"infusion_chairs": True, "refrigeration": True}

DEMO_LOT = "PSA24091"
DEMO_VIALS = 4  # Maria's 3 vials with 1 left over, so James's order needs a "Buy" card
DEMO_INVOICE = {
    "file_path": None,
    "distributor": "ASD Healthcare",
    "uploaded_at": "2026-09-28T09:00:00+00:00",
    "lines": [{"ndc_11": NDC_11, "lot": DEMO_LOT, "quantity": DEMO_VIALS, "cost_per_vial": DEMO_DRUG["ndcs"][0]["list_price"]}],
}


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("email", help="the demo practice's sign-in email")
    start = parser.add_mutually_exclusive_group()
    start.add_argument(
        "--launch-live", action="store_true", help="delete Pasatru so the demo launches it from the Drug Maker page"
    )
    start.add_argument(
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

    if args.launch_live:
        # Deleting the drug also deletes every practice's Pasatru workspace,
        # pins and notifications (the foreign keys cascade).
        supabase.table("drugs").delete().eq("application_id", DEMO_APPLICATION_ID).execute()
        print("2. Pasatru deleted: launch it from the Drug Maker page (Fill example → Fetch and save)")
    else:
        supabase.table("drugs").upsert(DEMO_DRUG, on_conflict="application_id").execute()
        print(f"2. {DEMO_DRUG['brand_name']} written from pasatru_demo.json (created if it was missing)")

    workspaces = supabase.table("practice_drugs").delete().eq("practice_id", practice["id"])
    if not args.all_workspaces:
        workspaces = workspaces.eq("application_id", DEMO_APPLICATION_ID)
    deleted = workspaces.execute().data
    scope = "all workspaces" if args.all_workspaces else "the Pasatru workspace"
    print(f"3. Deleted {scope} ({len(deleted)} row{'s' if len(deleted) != 1 else ''}, with their tasks and treatments)")

    count = seed_patients(supabase, practice["id"])
    print(f"4. Seeded {count} patients")

    cleared = supabase.table("notifications").delete().eq("practice_id", practice["id"]).execute().data
    print(f"5. Cleared {len(cleared)} notification{'s' if len(cleared) != 1 else ''}")

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
        cost = DEMO_INVOICE["lines"][0]["cost_per_vial"]
        print(f"6. Pasatru received: {DEMO_VIALS} vials of lot {DEMO_LOT} at ${cost:,.2f} each, invoice on file")

    if args.launch_live:
        print("Done. Next: Drug Maker → Fill example → Fetch and save, then sign in as the doctor.")
    else:
        print("Done. Next: sign in, open Pasatru, click \"Get my team ready\".")


if __name__ == "__main__":
    main()
