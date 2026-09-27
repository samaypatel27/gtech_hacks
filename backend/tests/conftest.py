"""Test setup.

Importing the stage modules creates the Supabase client (core/db.py), which
needs these variables to exist. The tests never talk to the database, so
placeholder values are enough when no backend/.env is present.
"""

import os

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test.placeholder.key")
