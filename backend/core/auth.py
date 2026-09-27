"""Login check: which practice is making this request."""

from typing import Optional

from fastapi import HTTPException, Header
from supabase_auth.errors import AuthError

from core.db import supabase


# Unlike the older email-in-the-URL endpoints, this trusts only a verified
# Supabase Auth session: the frontend sends the user's access token and
# Supabase itself confirms which email it belongs to.
def current_practice(authorization: Optional[str] = Header(default=None)) -> dict:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    try:
        user = supabase.auth.get_user(token).user
    except AuthError:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    if not user or not user.email:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    response = supabase.table("practices").select("*").eq("email", user.email).limit(1).execute()
    if not response.data:
        raise HTTPException(status_code=404, detail=f"No practice found for email {user.email}")
    return response.data[0]
