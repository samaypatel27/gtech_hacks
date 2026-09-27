"""The Claude client (FDA label extraction and the documentation check)."""

import anthropic
from dotenv import load_dotenv

load_dotenv()

# Credentials resolve lazily (ANTHROPIC_API_KEY or an `ant auth login` profile),
# so the app still starts without them; only the Claude features need them.
claude = anthropic.AsyncAnthropic()
