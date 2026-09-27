"""CMS billing-code data: the ASP NDC-HCPCS crosswalk and payment limits."""

import csv
from collections import defaultdict
from pathlib import Path

from fastapi import APIRouter

router = APIRouter()


# Loaded from CMS's quarterly ASP release; refresh with scripts/update_cms_files.py.
CMS_QUARTER = "October 2026"


CMS_DATA_DIR = Path(__file__).resolve().parent.parent / "data"


CROSSWALK_CITATION = f"CMS ASP NDC-HCPCS Crosswalk, {CMS_QUARTER}"


PAYMENT_LIMIT_CITATION = f"CMS Medicare Part B Payment Limit File, {CMS_QUARTER}"


# "Not otherwise classified" codes are what a drug is billed under *until* it
# has its own code, so a crosswalk row pointing at one isn't a permanent code.
NOC_CODES = {"J3490", "J3590", "J7599", "J7699", "J7799", "J8499", "J8999", "J9999", "C9399"}


def normalize_name(name: str) -> str:
    return " ".join(name.lower().split())


def load_crosswalk() -> dict[str, list[dict]]:
    by_brand = defaultdict(list)
    with open(CMS_DATA_DIR / "asp_ndc_hcpcs_crosswalk.csv", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader)
        for code, description, _labeler, _ndc, drug_name, billing_unit, *_ in reader:
            by_brand[normalize_name(drug_name)].append(
                {"code": code, "description": description, "billing_unit": billing_unit}
            )
    return by_brand


def load_payment_limits() -> dict[str, float]:
    limits = {}
    with open(CMS_DATA_DIR / "asp_payment_limits.csv", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader)
        for code, _description, _dosage, limit, *_ in reader:
            try:
                limits[code] = float(limit)
            except ValueError:
                pass  # e.g. "N/A" for products priced outside the ASP methodology
    return limits


CROSSWALK_BY_BRAND = load_crosswalk()


PAYMENT_LIMITS = load_payment_limits()


def find_permanent_codes(brand_name: str) -> list[dict]:
    """One entry per distinct drug-specific HCPCS code the brand's NDCs map to."""
    codes = {}
    for row in CROSSWALK_BY_BRAND.get(normalize_name(brand_name), []):
        if row["code"] not in NOC_CODES and row["code"] not in codes:
            codes[row["code"]] = {
                **row,
                "payment_limit": PAYMENT_LIMITS.get(row["code"]),
            }
    return list(codes.values())


@router.get("/api/cms/hcpcs-status/{brand_name}")
async def get_cms_hcpcs_status(brand_name: str):
    codes = find_permanent_codes(brand_name)
    if not codes:
        return {
            "status": "no_code_found",
            "has_permanent_code": False,
            "permanent_hcpcs_code": None,
            "codes": [],
            "message": (
                f"No permanent HCPCS code was found for '{brand_name}' in the "
                f"{CROSSWALK_CITATION}. A generic (miscellaneous) code is required "
                "until one is assigned."
            ),
            "citation": CROSSWALK_CITATION,
        }

    code_list = ", ".join(c["code"] for c in codes)
    return {
        "status": "code_found",
        "has_permanent_code": True,
        "permanent_hcpcs_code": code_list,
        # Each code's billing unit (e.g. "1 MG") and Medicare payment limit per unit.
        "codes": codes,
        "message": f"'{brand_name}' bills under {code_list} per the {CROSSWALK_CITATION}.",
        "citation": CROSSWALK_CITATION,
        "payment_limit_citation": PAYMENT_LIMIT_CITATION,
    }
