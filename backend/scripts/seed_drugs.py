"""Replace all rows in the `drugs` table with the resolved seed data.

Re-runnable: `python scripts/seed_drugs.py` from `backend/` (needs
backend/.env with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). Reads the JSON
snapshot written by resolve_drug_data.py, so it never needs the network.

Billing-code sourcing: CMS Q1 2026 and Q2 2026 HCPCS application summaries,
and a Blue Cross Vermont prior-authorization list revised 08/27/2026.
AVOPEF, FAVLYXA and VYKOURA get permanent codes J9186, J9191 and J0644
effective 2026-10-01 (VYKOURA is seeded here; AVOPEF/FAVLYXA could not be
verified against openFDA and were swapped for spares -- see
drug_seed_data.json's "used_spares").
"""

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SNAPSHOT_PATH = Path(__file__).parent / "drug_seed_data.json"

# Real product display casing for brands that were given in all-caps.
BRAND_DISPLAY = {
    "PEMRYDI RTU": "Pemrydi RTU",
    "BORUZU": "Boruzu",
    "VYKOURA": "Vykoura",
    "BEIZRAY": "Beizray",
    "EVDI": "Evdi",
    "GRAFAPEX": "Grafapex",
    "UPTRAVI": "Uptravi",
    "CONTEPO": "Contepo",
    "FERABRIGHT": "Ferabright",
    "TYZAVAN": "Tyzavan",
    "KYXATA": "Kyxata",
    "AVGEMSI": "Avgemsi",
    "VELCADE": "Velcade",
    "KYPROLIS": "Kyprolis",
    "JEVTANA": "Jevtana",
    "HALAVEN": "Halaven",
    "ZEPZELCA": "Zepzelca",
    "FOLOTYN": "Folotyn",
    "REZZAYO": "Rezzayo",
    "COSELA": "Cosela",
}


def build_row(drug):
    is_permanent = drug["code_status"] == "permanent"
    return {
        "application_id": drug["application_number"],
        "brand_name": BRAND_DISPLAY.get(drug["brand"], drug["brand"].title()),
        "generic_billing_code": None if is_permanent else drug["billing_code"],
        "permanent_hcpcs_code": drug["billing_code"] if is_permanent else None,
        "has_permanent_code": is_permanent,
        "route_of_administration": drug["route"],
        "generic_name": drug["generic"],
        "approval_date": drug["approval_date"],
        "pubchem_query": drug["pubchem_query"],
        "code_status": drug["code_status"],
    }


def main():
    snapshot = json.loads(SNAPSHOT_PATH.read_text())
    rows = [build_row(d) for d in snapshot["drugs"]]

    supabase = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )

    supabase.table("drugs").delete().neq("application_id", "").execute()
    supabase.table("drugs").insert(rows).execute()

    print(f"Seeded {len(rows)} drugs from {SNAPSHOT_PATH.name}")


if __name__ == "__main__":
    main()
