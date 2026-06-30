"""BillSplit backend package.

Load .env as early as possible — BEFORE any submodule reads os.getenv at import
time (auth.py reads GOOGLE_CLIENT_ID / EXTRACT_DAILY_LIMIT, main.py reads
ALLOWED_ORIGINS). Without this, import order could leave those unset even when
.env defines them, silently disabling auth.
"""

from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
