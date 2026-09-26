"""Resolve missing openFDA fields (application_number, route, approval_date)
for the DoctorDashboard seed drug list, and write a JSON snapshot so the app
can be seeded without hitting the network again.

Re-runnable: `python scripts/resolve_drug_data.py` from `backend/`.

Billing-code sourcing: CMS Q1 2026 and Q2 2026 HCPCS application summaries,
and a Blue Cross Vermont prior-authorization list revised 08/27/2026.
Note: AVOPEF, FAVLYXA and VYKOURA are expected to receive permanent codes
J9186, J9191 and J0644 respectively, effective 2026-10-01.
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

OPENFDA_URL = "https://api.fda.gov/drug/drugsfda.json"
OUTPUT_PATH = Path(__file__).parent / "drug_seed_data.json"
TIMEOUT = 5
THROTTLE_SECONDS = 0.3

# brand | generic | pubchem_query | application_number | route | billing_code | approval_date
# "resolve" means look it up against openFDA.
DRUGS = [
    # generic (no permanent code yet)
    dict(brand="AVOPEF", generic="etoposide", pubchem_query="etoposide",
         application_number="NDA220200", route="IV", billing_code="J9999",
         approval_date="2026-02-13", code_status="generic"),
    dict(brand="FAVLYXA", generic="fluorouracil", pubchem_query="fluorouracil",
         application_number="NDA220201", route="IV", billing_code="J9999",
         approval_date="2026-02-20", code_status="generic"),
    dict(brand="VYKOURA", generic="leucovorin calcium", pubchem_query="leucovorin",
         application_number="NDA220406", route="IV/IM", billing_code="J3490",
         approval_date="resolve", code_status="generic"),
    dict(brand="IVRA", generic="melphalan hydrochloride", pubchem_query="melphalan",
         application_number="resolve", route="IV", billing_code="J9999",
         approval_date="resolve", code_status="generic"),
    dict(brand="EVDI", generic="trabectedin", pubchem_query="trabectedin",
         application_number="resolve", route="IV", billing_code="J9999",
         approval_date="resolve", code_status="generic"),
    dict(brand="GRAFAPEX", generic="treosulfan", pubchem_query="treosulfan",
         application_number="resolve", route="IV", billing_code="J9999",
         approval_date="resolve", code_status="generic"),
    dict(brand="UPTRAVI", generic="selexipag", pubchem_query="selexipag",
         application_number="resolve", route="IV", billing_code="J3490",
         approval_date="resolve", code_status="generic",
         search_hint="injection"),

    # permanent code
    dict(brand="CONTEPO", generic="fosfomycin", pubchem_query="fosfomycin",
         application_number="resolve", route="IV", billing_code="J0528",
         approval_date="2025-10-22", code_status="permanent"),
    dict(brand="FERABRIGHT", generic="ferumoxytol", pubchem_query="ferumoxytol",
         application_number="resolve", route="IV", billing_code="A9574",
         approval_date="2025-10-16", code_status="permanent"),
    dict(brand="TYZAVAN", generic="vancomycin", pubchem_query="vancomycin",
         application_number="NDA211962", route="IV", billing_code="J3375",
         approval_date="2025-06-27", code_status="permanent"),
    dict(brand="KYXATA", generic="carboplatin", pubchem_query="carboplatin",
         application_number="resolve", route="IV", billing_code="J9278",
         approval_date="resolve", code_status="permanent"),
    dict(brand="AVGEMSI", generic="gemcitabine", pubchem_query="gemcitabine",
         application_number="resolve", route="IV", billing_code="J9184",
         approval_date="resolve", code_status="permanent"),
    dict(brand="VELCADE", generic="bortezomib", pubchem_query="bortezomib",
         application_number="NDA021602", route="IV/SC", billing_code="J9041",
         approval_date="resolve", code_status="permanent"),
    dict(brand="KYPROLIS", generic="carfilzomib", pubchem_query="carfilzomib",
         application_number="NDA202714", route="IV", billing_code="J9047",
         approval_date="resolve", code_status="permanent"),
    dict(brand="JEVTANA", generic="cabazitaxel", pubchem_query="cabazitaxel",
         application_number="NDA201023", route="IV", billing_code="J9043",
         approval_date="resolve", code_status="permanent"),
    dict(brand="HALAVEN", generic="eribulin mesylate", pubchem_query="eribulin",
         application_number="NDA201532", route="IV", billing_code="J9179",
         approval_date="resolve", code_status="permanent"),
    dict(brand="ZEPZELCA", generic="lurbinectedin", pubchem_query="lurbinectedin",
         application_number="NDA213702", route="IV", billing_code="J9223",
         approval_date="resolve", code_status="permanent"),
    dict(brand="FOLOTYN", generic="pralatrexate", pubchem_query="pralatrexate",
         application_number="NDA022468", route="IV", billing_code="J9307",
         approval_date="resolve", code_status="permanent"),
    dict(brand="REZZAYO", generic="rezafungin", pubchem_query="rezafungin",
         application_number="NDA217417", route="IV", billing_code="J0349",
         approval_date="resolve", code_status="permanent"),
    dict(brand="COSELA", generic="trilaciclib", pubchem_query="trilaciclib",
         application_number="NDA214200", route="IV", billing_code="J1448",
         approval_date="resolve", code_status="permanent"),
]

SPARES = [
    dict(brand="PEMRYDI RTU", generic="pemetrexed", pubchem_query="pemetrexed",
         application_number="resolve", route="IV", billing_code="J9324",
         approval_date="resolve", code_status="permanent"),
    dict(brand="BORUZU", generic="bortezomib", pubchem_query="bortezomib",
         application_number="resolve", route="IV", billing_code="J9054",
         approval_date="resolve", code_status="permanent"),
    dict(brand="BEIZRAY", generic="docetaxel", pubchem_query="docetaxel",
         application_number="resolve", route="IV", billing_code="J9174",
         approval_date="resolve", code_status="permanent"),
    dict(brand="BELEODAQ", generic="belinostat", pubchem_query="belinostat",
         application_number="resolve", route="IV", billing_code="J9032",
         approval_date="resolve", code_status="permanent"),
    dict(brand="RADICAVA", generic="edaravone", pubchem_query="edaravone",
         application_number="resolve", route="IV", billing_code="J1301",
         approval_date="resolve", code_status="permanent"),
    dict(brand="ZULRESSO", generic="brexanolone", pubchem_query="brexanolone",
         application_number="resolve", route="IV", billing_code="J1632",
         approval_date="resolve", code_status="permanent"),
]


def openfda_search(field, value):
    params = urllib.parse.urlencode(
        {"search": f'openfda.{field}:"{value}"', "limit": 10}
    )
    url = f"{OPENFDA_URL}?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "gtech-hacks-seed-script"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.load(resp).get("results", [])
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return []
        raise
    except urllib.error.URLError:
        return []


def earliest_orig_date(record):
    dates = [
        s["submission_status_date"]
        for s in record.get("submissions", [])
        if s.get("submission_type") == "ORIG" and s.get("submission_status") == "AP"
    ]
    if not dates:
        dates = [s["submission_status_date"] for s in record.get("submissions", []) if s.get("submission_status_date")]
    if not dates:
        return None
    raw = min(dates)
    return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"


def routes_for(record):
    routes = {p.get("route", "") for p in record.get("products", []) if p.get("route")}
    return ", ".join(sorted(routes)) if routes else None


def resolve_one(drug):
    resolved = dict(drug)
    resolved["openfda_notes"] = []

    used_generic_fallback = False
    records = openfda_search("brand_name", drug["brand"])
    if not records:
        # brand-name-with-suffix drugs (e.g. "UPTRAVI") plus fallback to generic name
        bare_brand = drug["brand"].split(" ")[0]
        if bare_brand != drug["brand"]:
            records = openfda_search("brand_name", bare_brand)
        if not records:
            records = openfda_search("generic_name", drug["generic"].split(" ")[0].upper())
            used_generic_fallback = bool(records)
            if records:
                resolved["openfda_notes"].append("matched via generic_name fallback")

    if not records:
        resolved["found"] = False
        return resolved

    # A generic-name-only fallback (no direct brand hit) only counts as a
    # real match for THIS brand if it corroborates the application_number
    # we were already given -- otherwise it's just picking an unrelated
    # product that happens to share the same active ingredient, which is
    # not good enough to trust ("NDA products only", correct via openFDA
    # only when openFDA actually has a record *for that brand*).
    if used_generic_fallback and drug["application_number"] == "resolve":
        resolved["found"] = False
        resolved["openfda_notes"].append("generic_name fallback unconfirmed (no application_number to cross-check) -> treated as not found")
        return resolved

    # If a search_hint is given (e.g. "injection"), prefer the record whose
    # products mention that dosage form; otherwise prefer one matching the
    # provided application_number; otherwise take the first result.
    chosen = None
    hint = drug.get("search_hint")
    if hint:
        for r in records:
            if any(hint.upper() in (p.get("dosage_form") or "").upper() for p in r.get("products", [])):
                chosen = r
                break
    if chosen is None and drug["application_number"] != "resolve":
        for r in records:
            if r.get("application_number") == drug["application_number"]:
                chosen = r
                break
        if chosen is None and used_generic_fallback:
            # Fallback-only match that doesn't corroborate the given
            # application_number is just a same-ingredient product from a
            # different brand -- not trustworthy enough to correct onto.
            resolved["found"] = False
            resolved["openfda_notes"].append(
                f"generic_name fallback found no record matching given application_number {drug['application_number']} -> treated as not found"
            )
            return resolved
    if chosen is None:
        chosen = records[0]

    resolved_app_number = chosen.get("application_number")
    resolved_route = routes_for(chosen)
    resolved_date = earliest_orig_date(chosen)

    if not resolved_app_number or not resolved_app_number.startswith("NDA"):
        resolved["found"] = False
        resolved["openfda_notes"].append(f"openFDA match is not an NDA product ({resolved_app_number}) -> treated as not found")
        return resolved

    if drug["application_number"] != "resolve" and resolved_app_number != drug["application_number"]:
        resolved["openfda_notes"].append(
            f"corrected application_number {drug['application_number']} -> {resolved_app_number}"
        )
        resolved["application_number"] = resolved_app_number
    if drug["application_number"] == "resolve":
        resolved["application_number"] = resolved_app_number
    if drug["approval_date"] == "resolve":
        resolved["approval_date"] = resolved_date

    resolved["found"] = True
    resolved["openfda_sponsor"] = chosen.get("sponsor_name")
    resolved["openfda_route_raw"] = resolved_route
    return resolved


def main():
    results = []
    used_spares = []
    spare_pool = list(SPARES)

    for drug in DRUGS:
        print(f"Resolving {drug['brand']}...")
        resolved = resolve_one(drug)
        time.sleep(THROTTLE_SECONDS)

        if not resolved.get("found") or not resolved.get("application_number"):
            if not spare_pool:
                print(f"  NOT FOUND, no spares left, dropping {drug['brand']}")
                continue
            spare = spare_pool.pop(0)
            print(f"  NOT FOUND -> replacing with spare {spare['brand']}")
            spare_resolved = resolve_one(spare)
            time.sleep(THROTTLE_SECONDS)
            spare_resolved["replaced"] = drug["brand"]
            used_spares.append(spare["brand"])
            results.append(spare_resolved)
            continue

        results.append(resolved)

    snapshot = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source_note": (
            "Billing codes from CMS Q1 2026 / Q2 2026 HCPCS application summaries "
            "and a Blue Cross Vermont prior-authorization list revised 08/27/2026. "
            "AVOPEF, FAVLYXA, VYKOURA get permanent codes J9186, J9191, J0644 "
            "effective 2026-10-01."
        ),
        "used_spares": used_spares,
        "drugs": results,
    }
    OUTPUT_PATH.write_text(json.dumps(snapshot, indent=2))
    print(f"\nWrote {len(results)} drugs to {OUTPUT_PATH}")
    print(f"Spares used: {used_spares or 'none'}")


if __name__ == "__main__":
    main()
