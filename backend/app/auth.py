"""Auth + rate limiting for the public API.

Verifies Google ID tokens (issued by Google Identity Services on the frontend)
using Google's free `google-auth` library — no third-party auth vendor, no cost.

Dev escape hatch: if GOOGLE_CLIENT_ID is unset, auth is DISABLED so local
development works before any setup. A loud warning is logged; production MUST set
GOOGLE_CLIENT_ID.
"""

from __future__ import annotations

import datetime
import logging
import os

from fastapi import Header, HTTPException
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

log = logging.getLogger("billsplit.auth")

# Must equal the frontend's VITE_GOOGLE_CLIENT_ID — it's the token *audience*.
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
EXTRACT_DAILY_LIMIT = int(os.getenv("EXTRACT_DAILY_LIMIT", "25"))

# Reused request object; google-auth caches Google's signing certs on it.
_google_request = google_requests.Request()

if not GOOGLE_CLIENT_ID:
    log.warning(
        "⚠️  GOOGLE_CLIENT_ID is not set — AUTH IS DISABLED. Anyone can call the "
        "API. Set GOOGLE_CLIENT_ID before deploying publicly."
    )


async def require_user(authorization: str | None = Header(default=None)) -> dict:
    """FastAPI dependency: returns the verified Google user claims, or 401."""
    if not GOOGLE_CLIENT_ID:
        return {"sub": "dev-user", "email": "dev@local"}  # auth disabled in dev

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign-in required (missing bearer token).")

    token = authorization.split(" ", 1)[1].strip()
    try:
        # Verifies signature, expiry, issuer (accounts.google.com) and that the
        # audience matches our client id. Raises ValueError otherwise.
        # clock_skew tolerates small clock differences ("token used too early").
        info = google_id_token.verify_oauth2_token(
            token, _google_request, GOOGLE_CLIENT_ID, clock_skew_in_seconds=10
        )
    except ValueError as e:
        raise HTTPException(401, f"Invalid or expired session: {e}")

    if not info.get("sub"):
        raise HTTPException(401, "Invalid token (no subject).")
    return info


# --- simple in-memory per-user daily quota -----------------------------------
# NOTE: in-memory means it resets on restart and isn't shared across processes/
# instances. Fine for a single-instance launch; swap for Redis if you scale out.
_usage: dict[str, tuple[str, int]] = {}  # sub -> (YYYY-MM-DD, count)


def enforce_extract_quota(user: dict) -> None:
    """Raise 429 if this user has hit the daily extraction cap. Counts the call."""
    if not GOOGLE_CLIENT_ID:
        return  # no limits when auth is disabled (dev)

    today = datetime.date.today().isoformat()
    sub = user["sub"]
    day, count = _usage.get(sub, (today, 0))
    if day != today:
        day, count = today, 0
    if count >= EXTRACT_DAILY_LIMIT:
        raise HTTPException(
            429,
            f"Daily limit reached ({EXTRACT_DAILY_LIMIT} bills/day). "
            f"Try again tomorrow.",
        )
    _usage[sub] = (day, count + 1)
