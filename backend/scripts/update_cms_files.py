"""Refresh backend/data/ from a CMS quarterly ASP release.

CMS publishes the ASP NDC-HCPCS crosswalk and Medicare Part B payment limit
file each quarter at https://www.cms.gov/medicare/payment/part-b-drugs/asp-pricing-files.
Zip names aren't consistent between quarters, so pass both URLs explicitly:

    python scripts/update_cms_files.py \
        https://www.cms.gov/files/zip/october-2026-ndc-hcpcs-crosswalk-final.zip \
        https://www.cms.gov/files/zip/october-2026-medicare-part-b-payment-limit-files-final.zip

Only HCPCS Level II rows (codes starting with a letter) are kept. Numeric
codes are CPT, whose descriptors are AMA-licensed, and are never drug codes
this app bills anyway. After running, update CMS_QUARTER in main.py.
"""

import csv
import io
import sys
import zipfile
from pathlib import Path

import httpx

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def read_508_csv(zip_url: str, name_contains: str) -> list[list[str]]:
    response = httpx.get(zip_url, follow_redirects=True, timeout=60)
    response.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        # The "section 508" CSV is the plain-text twin of the .xls file.
        name = next(
            n
            for n in archive.namelist()
            if n.lower().endswith(".csv") and name_contains in n.lower()
        )
        text = archive.read(name).decode("utf-8", errors="replace")
    return list(csv.reader(io.StringIO(text)))


def write_table(rows: list[list[str]], header_first_cell: str, out_name: str):
    start = next(i for i, row in enumerate(rows) if row and row[0] == header_first_cell)
    header = [cell for cell in rows[start] if cell]
    kept = [
        row[: len(header)]
        for row in rows[start + 1 :]
        if row and row[0][:1].isalpha()
    ]
    with open(DATA_DIR / out_name, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(kept)
    print(f"{out_name}: {len(kept)} rows")


def main(crosswalk_url: str, payment_limit_url: str):
    DATA_DIR.mkdir(exist_ok=True)
    crosswalk = read_508_csv(crosswalk_url, "asp ndc-hcpcs crosswalk")
    # The header's first cell is the year-specific code column, e.g. "_2026_CODE".
    code_header = next(row[0] for row in crosswalk if row and row[0].endswith("_CODE"))
    write_table(crosswalk, code_header, "asp_ndc_hcpcs_crosswalk.csv")

    limits = read_508_csv(payment_limit_url, "payment limit file")
    write_table(limits, "HCPCS Code", "asp_payment_limits.csv")


if __name__ == "__main__":
    main(*sys.argv[1:3])
