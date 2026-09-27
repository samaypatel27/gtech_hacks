"""The Supabase client every stage uses."""

import os

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

# Service role key bypasses RLS; every table has RLS enabled with no policies,
# so it must only ever be used server-side.
supabase = create_client(
    os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
)
