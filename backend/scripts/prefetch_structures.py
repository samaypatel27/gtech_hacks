"""Warm the PubChem structure-PNG cache for every seeded drug, so the demo
never depends on a live PubChem call.

Re-runnable: `python scripts/prefetch_structures.py` from `backend/`.
Reads application_id + pubchem_query straight from drug_seed_data.json
(no DB round-trip needed). A miss (e.g. ferumoxytol, which PubChem may not
have a simple 2D structure for) is recorded in cache/structures/manifest.json
and is expected -- the frontend falls back to a generated pattern for it.
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from pubchem_structures import get_or_fetch_structure  # noqa: E402

SNAPSHOT_PATH = Path(__file__).parent / "drug_seed_data.json"


async def main():
    snapshot = json.loads(SNAPSHOT_PATH.read_text())
    hits, misses = [], []

    for drug in snapshot["drugs"]:
        application_id = drug["application_number"]
        content = await get_or_fetch_structure(application_id, drug["pubchem_query"])
        if content is None:
            misses.append(drug["brand"])
            print(f"  MISS  {application_id} ({drug['brand']}, query={drug['pubchem_query']!r})")
        else:
            hits.append(drug["brand"])
            print(f"  hit   {application_id} ({drug['brand']})")

    print(f"\n{len(hits)} cached, {len(misses)} miss(es): {misses or 'none'}")


if __name__ == "__main__":
    asyncio.run(main())
