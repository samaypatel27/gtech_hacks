"""Reset one practice's demo patients (the Treat & Bill story).

Deletes that practice's existing patients -- which cascades to their
treatments and any treatment-linked tasks -- then inserts the four below, so
re-running it puts the demo back to a clean "no orders yet" state.

Re-runnable: `python scripts/seed_patients.py <practice email>` from
`backend/` (needs backend/.env with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
The practice must already exist (sign up through the app first).

All patients are synthetic. They're written for the demo drug Pasatru
(BLA761508, approved for fibrodysplasia ossificans progressiva in adults, dosed
10 mg/kg from 300 mg / 5 mL single-dose vials, the strength openFDA lists), one
per payer seeded on its `payer_policies`, plus one whose insurer has none:
- Maria (Medicare, covered): complete note; 68 kg -> 680 mg -> 3 vials (900 mg),
  220 mg waste, so her claim shows the JW waste line. On Medicare through
  disability (SSDI), which is why a 34-year-old has it.
- James (BCBS, prior auth required): note omits the ACVR1 genetic confirmation,
  so the documentation check has a gap to find and draft; 82 kg -> 820 mg ->
  3 vials, 80 mg waste.
- Aisha (Aetna, policy under review): complete note; 60 kg -> 600 mg -> exactly
  2 vials, no waste, so her claim shows JZ.
- Daniel (UnitedHealthcare, no Pasatru policy on file): the hold-list patient --
  the doctor wants to start him once coverage is confirmed; 75 kg -> 750 mg.
"""

import os
import sys

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

PATIENTS = [
    {
        "first_name": "Maria",
        "last_name": "Lopez",
        "date_of_birth": "1992-03-14",
        "sex": "F",
        "address": {"street": "418 Ponce De Leon Ave NE", "city": "Atlanta", "state": "GA", "zip": "30308"},
        "weight_kg": 68,
        "payer": "Medicare",
        "member_id": "1EG4-TE5-MK72",
        "diagnosis": "M61.10 Fibrodysplasia ossificans progressiva",
        "visit_note": (
            "34-year-old woman with fibrodysplasia ossificans progressiva (FOP), "
            "diagnosed at age 6 after great-toe malformation and first flare-up.\n"
            "Genetic testing: ACVR1 R206H heterozygous mutation confirmed (Emory Genetics Lab, 2021).\n"
            "Over the last 6 months she has had 3 clinician-assessed flare-ups (right shoulder, "
            "upper back, left hip) with new heterotopic ossification on low-dose whole-body CT.\n"
            "Prior therapy: short prednisone courses for flare-ups only; no disease-modifying therapy.\n"
            "Insurance: Medicare through Social Security disability (FOP).\n"
            "Weight today 68 kg. Not pregnant; contraception counseling done.\n"
            "Plan: start Pasatru 10 mg/kg IV over 60 minutes every 4 weeks to reduce new HO "
            "formation and flare-ups. Reviewed risks and benefits; patient agrees."
        ),
    },
    {
        "first_name": "James",
        "last_name": "Carter",
        "date_of_birth": "1985-08-02",
        "sex": "M",
        "address": {"street": "1290 Peachtree St NE", "city": "Atlanta", "state": "GA", "zip": "30309"},
        "weight_kg": 82,
        "payer": "BCBS",
        "member_id": "XJG884120337",
        "diagnosis": "M61.10 Fibrodysplasia ossificans progressiva",
        "visit_note": (
            "41-year-old man with fibrodysplasia ossificans progressiva, clinically diagnosed "
            "in childhood.\n"
            "Two flare-ups this year (jaw, left elbow) with progressive loss of mobility.\n"
            "Prior therapy: prednisone bursts for flare-ups.\n"
            "Weight today 82 kg.\n"
            "Plan: start Pasatru 10 mg/kg IV every 4 weeks."
        ),
    },
    {
        "first_name": "Aisha",
        "last_name": "Khan",
        "date_of_birth": "1999-11-21",
        "sex": "F",
        "address": {"street": "75 5th St NW", "city": "Atlanta", "state": "GA", "zip": "30308"},
        "weight_kg": 60,
        "payer": "Aetna",
        "member_id": "W284719305",
        "diagnosis": "M61.10 Fibrodysplasia ossificans progressiva",
        "visit_note": (
            "26-year-old woman with fibrodysplasia ossificans progressiva.\n"
            "Genetic testing: ACVR1 R206H mutation confirmed (2018).\n"
            "One clinician-assessed flare-up in the last 3 months (neck) with new HO on imaging.\n"
            "Prior therapy: prednisone for flare-ups.\n"
            "Weight today 60 kg. Pregnancy test negative today.\n"
            "Plan: start Pasatru 10 mg/kg IV over 60 minutes every 4 weeks."
        ),
    },
    {
        "first_name": "Daniel",
        "last_name": "Brooks",
        "date_of_birth": "1979-06-10",
        "sex": "M",
        "address": {"street": "1100 Spring St NW", "city": "Atlanta", "state": "GA", "zip": "30309"},
        "weight_kg": 75,
        "payer": "UnitedHealthcare",
        "member_id": "924816305",
        "diagnosis": "M61.10 Fibrodysplasia ossificans progressiva",
        "visit_note": (
            "47-year-old man with fibrodysplasia ossificans progressiva.\n"
            "Genetic testing: ACVR1 R206H mutation confirmed (2016).\n"
            "One flare-up in the last 6 months (right hip); mobility stable.\n"
            "Prior therapy: prednisone for flare-ups.\n"
            "Weight today 75 kg.\n"
            "Plan: discussed Pasatru 10 mg/kg IV every 4 weeks; start once UnitedHealthcare "
            "coverage is confirmed."
        ),
    },
]


def find_practice(supabase, email):
    practice = supabase.table("practices").select("*").eq("email", email).limit(1).execute()
    if not practice.data:
        sys.exit(f"No practice found for {email} -- sign up through the app first")
    return practice.data[0]


def seed_patients(supabase, practice_id):
    """Replace the practice's patients with PATIENTS; returns how many."""
    supabase.table("patients").delete().eq("practice_id", practice_id).execute()
    rows = [{**p, "practice_id": practice_id} for p in PATIENTS]
    supabase.table("patients").insert(rows).execute()
    return len(rows)


def main():
    if len(sys.argv) != 2:
        sys.exit("Usage: python scripts/seed_patients.py <practice email>")
    email = sys.argv[1]

    supabase = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )
    practice = find_practice(supabase, email)
    count = seed_patients(supabase, practice["id"])
    print(f"Seeded {count} patients for {practice['name']} ({email})")


if __name__ == "__main__":
    main()
