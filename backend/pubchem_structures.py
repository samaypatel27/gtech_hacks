"""Fetch + file-cache 2D structure PNGs from PubChem's PUG REST service.

Shared by the /api/drugs/{application_id}/structure route (main.py) and the
prefetch script (scripts/prefetch_structures.py) so both use the same
cache layout, salt-stripping retry, and throttling.
"""

import json
import re
import time
from pathlib import Path
from typing import Optional

import httpx

PUBCHEM_PNG_URL = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{name}/PNG"
TIMEOUT_SECONDS = 5.0
THROTTLE_SECONDS = 0.4  # be polite to PubChem's shared rate limit

CACHE_DIR = Path(__file__).parent / "cache" / "structures"
MANIFEST_PATH = CACHE_DIR / "manifest.json"

# Common salt/ester suffixes that keep a name out of PubChem's parent-compound
# index. Stripped as a retry when the full name misses.
SALT_SUFFIXES = [
    " hydrochloride", " hcl", " mesylate", " sulfate", " phosphate",
    " sodium", " calcium", " citrate", " tartrate", " maleate",
    " succinate", " acetate", " besylate", " tosylate", " potassium",
]

_last_request_at = 0.0


def _throttle():
    global _last_request_at
    elapsed = time.monotonic() - _last_request_at
    if elapsed < THROTTLE_SECONDS:
        time.sleep(THROTTLE_SECONDS - elapsed)
    _last_request_at = time.monotonic()


def strip_salt(name: str) -> Optional[str]:
    lowered = name.lower()
    for suffix in SALT_SUFFIXES:
        if lowered.endswith(suffix):
            return name[: -len(suffix)].strip()
    return None


def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        return {}
    return json.loads(MANIFEST_PATH.read_text())


def save_manifest(manifest: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, sort_keys=True))


def cache_path(application_id: str) -> Path:
    return CACHE_DIR / f"{application_id}.png"


async def _fetch_png(client: httpx.AsyncClient, name: str) -> Optional[bytes]:
    _throttle()
    try:
        resp = await client.get(
            PUBCHEM_PNG_URL.format(name=name), timeout=TIMEOUT_SECONDS
        )
    except httpx.HTTPError:
        return None
    if resp.status_code != 200 or not resp.content:
        return None
    return resp.content


async def get_or_fetch_structure(application_id: str, pubchem_query: str) -> Optional[bytes]:
    """Returns cached/fetched PNG bytes, or None on a (now-cached) miss."""
    path = cache_path(application_id)
    if path.exists():
        return path.read_bytes()

    manifest = load_manifest()
    if manifest.get(application_id, {}).get("status") == "miss":
        return None

    async with httpx.AsyncClient() as client:
        content = await _fetch_png(client, pubchem_query)
        query_used = pubchem_query

        if content is None:
            stripped = strip_salt(pubchem_query)
            if stripped:
                content = await _fetch_png(client, stripped)
                query_used = stripped

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if content is not None:
        path.write_bytes(content)
        manifest[application_id] = {
            "status": "hit",
            "query_used": query_used,
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        save_manifest(manifest)
        return content

    manifest[application_id] = {
        "status": "miss",
        "query_used": pubchem_query,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    save_manifest(manifest)
    return None
