"""FastAPI app exposing extraction + split endpoints.

Endpoints:
  POST /api/extract      — upload an image, get a parsed Bill JSON
  POST /api/split        — given a Bill + assignments, get per-person totals
  GET  /api/health       — basic liveness

CORS is wide-open by default (single-device MVP).
"""

from __future__ import annotations

import logging
import os
import tempfile
import traceback
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .auth import enforce_extract_quota, require_user
from .extractor import ExtractorError, OverloadedError, extract_bill_with_gemini
from .schema import Bill
from .splitter import Assignment, SplitOptions, SplitResult, split_bill

log = logging.getLogger("billsplit")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = FastAPI(title="BillSplit API", version="0.1.0")

# Restrict CORS to your frontend origin(s) in production via ALLOWED_ORIGINS
# (comma-separated). Defaults to "*" for local dev. We authenticate with a Bearer
# token (not cookies), so credentials aren't required.
_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins or ["*"],
    allow_credentials=_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/auth/session")
def session(user: dict = Depends(require_user)) -> dict:
    """Called by the frontend right after sign-in. Logs WHO signed in (email) so
    the owner can see real identities in the server logs — the plain Google
    Sign-In flow keeps no user list, and GA4 only has anonymous counts.
    """
    log.info(
        "sign-in: email=%s name=%s sub=%s",
        user.get("email"), user.get("name"), user.get("sub"),
    )
    return {"ok": True}


@app.post("/api/extract", response_model=Bill)
async def extract(
    file: UploadFile = File(...),
    user: dict = Depends(require_user),
) -> Bill:
    if not file.filename:
        raise HTTPException(400, "filename missing")

    # Cost control: cap paid Gemini extractions per user per day.
    enforce_extract_quota(user)

    suffix = Path(file.filename).suffix.lower() or ".jpg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)

    log.info(
        f"/api/extract start: user={user.get('email', user.get('sub'))} "
        f"file={file.filename} bytes={tmp_path.stat().st_size}"
    )
    try:
        bill = extract_bill_with_gemini(tmp_path)
    except OverloadedError as e:
        # Google-side capacity, not our fault — 503 + Retry-After so the client
        # can show a friendly "busy, try again" instead of a scary error.
        log.warning("Gemini overloaded: %s", e)
        raise HTTPException(503, str(e), headers={"Retry-After": "30"})
    except ExtractorError as e:
        log.exception("ExtractorError")
        raise HTTPException(502, f"extraction failed: {e}")
    except Exception as e:
        # Never let an unexpected error become an opaque 500. Surface the message.
        tb = traceback.format_exc()
        log.error("Unexpected error in /api/extract:\n%s", tb)
        raise HTTPException(
            500,
            f"unexpected error: {type(e).__name__}: {e}. "
            f"Check the backend terminal for the full traceback."
        )
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass

    bill.source_image = file.filename
    log.info(
        f"/api/extract ok: {bill.restaurant.name} total=₹{bill.grand_total} "
        f"delta=₹{bill.reconciliation.delta}"
    )
    return bill


class SplitRequest(BaseModel):
    bill: Bill
    assignments: dict[str, list[Assignment]]    # item_id -> [(person_id, share)]
    options: SplitOptions = SplitOptions()


class SplitResponse(BaseModel):
    breakdowns: list[dict]
    grand_total: float
    sum_of_people: float
    residual_assigned_to: str | None
    warnings: list[str]


@app.post("/api/split", response_model=SplitResponse)
def split(req: SplitRequest, user: dict = Depends(require_user)) -> SplitResponse:
    # The frontend may have edited the bill (added taxes, marked items FOC, etc.).
    # Recompute everything before splitting to ensure subtotals/reconciliation are
    # consistent with the edited items.
    req.bill.recompute()
    try:
        result: SplitResult = split_bill(req.bill, req.assignments, req.options)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return SplitResponse(
        breakdowns=[b.__dict__ for b in result.breakdowns],
        grand_total=result.grand_total,
        sum_of_people=result.sum_of_people,
        residual_assigned_to=result.residual_assigned_to,
        warnings=result.warnings,
    )
