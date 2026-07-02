"""Vision-LLM extractor for restaurant bills.

Primary backend: Google Gemini (free tier, ~1500 req/day on gemini-2.0-flash).
Why Gemini over alternatives:
  - Free tier handles personal-project volume comfortably
  - Strong on Indian-script + tabular-receipt formats in our testing
  - Returns structured JSON reliably with response_mime_type="application/json"

The extractor is responsible for:
  1. Loading the image (any format Pillow can read, including HEIC via pillow-heif)
  2. Calling Gemini with the EXTRACTION_PROMPT
  3. Parsing the JSON response into our Pydantic schema
  4. Recomputing reconciliation locally so we never trust the model's math blindly
"""

from __future__ import annotations

import base64
import io
import json
import re
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image, ImageOps

log = logging.getLogger("billsplit.extractor")

# Register HEIC opener (Indian users overwhelmingly upload iPhone HEIC photos).
# We track exactly what failed so the error message can tell the user whether
# pillow-heif is missing entirely, or installed but broken (libheif missing).
_HEIF_SUPPORTED = False
_HEIF_ERROR: str | None = None
try:
    import pillow_heif  # type: ignore

    try:
        pillow_heif.register_heif_opener()
        _HEIF_SUPPORTED = True
        log.info("HEIC support enabled via pillow_heif")
    except Exception as e:
        _HEIF_ERROR = (
            f"pillow_heif imported but register_heif_opener() failed: {e}. "
            f"Usually means libheif is missing — try `brew install libheif` then `pip install --force-reinstall pillow-heif`."
        )
        log.warning(_HEIF_ERROR)
except ImportError:
    _HEIF_ERROR = (
        "pillow_heif not installed. Activate your venv and run "
        "`pip install pillow-heif`."
    )
    log.warning(_HEIF_ERROR)


def _convert_heic_via_subprocess(image_path: Path) -> Path | None:
    """Last-resort HEIC → JPEG fallback using whatever the OS has lying around.

    Order tried:
      1. macOS `sips` (built-in, no install needed)
      2. ImageMagick `magick` or `convert`

    Returns the path to a temp JPEG, or None if all fallbacks failed.
    """
    out_path = Path(tempfile.mkstemp(suffix=".jpg")[1])
    candidates = []
    if shutil.which("sips"):
        candidates.append(["sips", "-s", "format", "jpeg", str(image_path), "--out", str(out_path)])
    if shutil.which("magick"):
        candidates.append(["magick", str(image_path), str(out_path)])
    elif shutil.which("convert"):
        candidates.append(["convert", str(image_path), str(out_path)])

    for cmd in candidates:
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=15)
            if r.returncode == 0 and out_path.exists() and out_path.stat().st_size > 0:
                log.info(f"HEIC fallback conversion succeeded with: {cmd[0]}")
                return out_path
        except Exception as e:
            log.warning(f"HEIC fallback {cmd[0]} failed: {e}")

    out_path.unlink(missing_ok=True)
    return None

from google import genai
from google.genai import types as genai_types

import random
import time

from .prompts import EXTRACTION_PROMPT
from .schema import Bill

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

_API_KEY = os.getenv("GEMINI_API_KEY")
_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
# When the primary model is overloaded (503 "high demand"), fall back to these
# in order. A different model family (e.g. 2.0-flash) has separate capacity, so
# it often succeeds when a 2.5 model is busy. Comma-separated; override via env.
_FALLBACK_MODELS = [
    m.strip()
    for m in os.getenv(
        "GEMINI_FALLBACK_MODELS", "gemini-2.5-flash,gemini-2.0-flash"
    ).split(",")
    if m.strip()
]


class ExtractorError(RuntimeError):
    pass


class OverloadedError(ExtractorError):
    """Every candidate model returned a transient 'overloaded / high demand' error."""


def _load_image(image_path: str | Path) -> Image.Image:
    image_path = Path(image_path)
    suffix = str(image_path).lower().rsplit(".", 1)[-1]
    converted_tmp: Path | None = None

    if suffix in {"heic", "heif"} and not _HEIF_SUPPORTED:
        # Last-ditch attempt: shell out to `sips` (macOS) or ImageMagick.
        converted_tmp = _convert_heic_via_subprocess(image_path)
        if converted_tmp is not None:
            image_path = converted_tmp
        else:
            raise ExtractorError(
                "Couldn't decode the HEIC photo. " + (_HEIF_ERROR or "") + "\n\n"
                "Quick fix in your backend terminal:\n"
                "    cd backend\n"
                "    source .venv/bin/activate    # if you use a venv\n"
                "    pip install pillow-heif\n"
                "    # restart uvicorn\n\n"
                "If that fails on macOS, also run:  brew install libheif"
            )
    try:
        img = Image.open(image_path)
        img.load()
    except Exception as e:
        raise ExtractorError(
            f"Could not decode image: {type(e).__name__}: {e}. "
            f"Make sure the upload is a valid JPEG, PNG, or HEIC file."
        ) from e
    finally:
        if converted_tmp is not None:
            converted_tmp.unlink(missing_ok=True)
    # Honour EXIF orientation. Phones store photos in raw sensor (usually
    # landscape) pixels plus an orientation tag rather than rotating the pixels.
    # Without this, the preview we hand back — and the image Gemini reads — comes
    # out sideways for portrait phone shots. exif_transpose rotates the pixels to
    # match the tag and strips the now-redundant tag. No-op for images without
    # one (e.g. the browser-cropped JPEG, whose pixels are already upright).
    img = ImageOps.exif_transpose(img) or img
    # Normalize: convert to RGB and resize so we don't waste tokens on huge phone photos.
    if img.mode != "RGB":
        img = img.convert("RGB")
    max_side = 1600
    if max(img.size) > max_side:
        ratio = max_side / max(img.size)
        new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
        img = img.resize(new_size, Image.LANCZOS)
    return img


def _is_transient(msg: str) -> bool:
    """True for retryable server/overload errors (vs. a real client error)."""
    m = msg.lower()
    return (
        " 503" in msg
        or " 502" in msg
        or " 504" in msg
        or " 429" in msg
        or "unavailable" in m
        or "deadline_exceeded" in m
        or "overload" in m
        or "high demand" in m
        or "resource_exhausted" in m
    )


def _generate_with_fallback(client, img_bytes: bytes):
    """Call Gemini, retrying transient errors and falling back across models when
    one is overloaded. Returns the response, or raises ExtractorError /
    OverloadedError.
    """
    # Configured model first, then fallbacks — deduped, order preserved.
    models: list[str] = []
    for m in [_MODEL, *_FALLBACK_MODELS]:
        if m and m not in models:
            models.append(m)

    for model in models:
        is_25 = model.startswith("gemini-2.5")
        config_kwargs = {
            "response_mime_type": "application/json",
            "temperature": 0.1,
            # Give big bills plenty of room so the JSON isn't truncated mid-object
            # (long addresses + many items add up — and on 2.5, thinking tokens
            # also count against this budget). 2.5 supports up to 65k; 2.0/1.5 cap
            # at 8192.
            "max_output_tokens": 32768 if is_25 else 8192,
        }
        # Small thinking budget for 2.5 models — enough to run the cross-check
        # without burning time. 2.0/1.5 don't take a thinking_config.
        if is_25 or "thinking" in model:
            config_kwargs["thinking_config"] = genai_types.ThinkingConfig(thinking_budget=512)

        for attempt in range(3):
            try:
                return client.models.generate_content(
                    model=model,
                    contents=[
                        genai_types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
                        EXTRACTION_PROMPT,
                    ],
                    config=genai_types.GenerateContentConfig(**config_kwargs),
                )
            except Exception as e:  # ServerError, ClientError, network, etc.
                msg = str(e)
                if not _is_transient(msg):
                    # Real error (bad key, invalid request) — fallbacks won't help.
                    raise ExtractorError(f"Gemini call failed: {msg[:200]}") from e
                if attempt < 2:
                    time.sleep((2 ** attempt) + random.random())
        log.warning("Gemini model '%s' overloaded after retries; trying next.", model)

    # Every model was overloaded.
    raise OverloadedError(
        "Gemini is busy right now (every model reported 'high demand'). "
        "Please try again in a minute."
    )


def extract_bill_with_gemini(image_path: str | Path) -> Bill:
    """Extract a Bill from an image using Gemini.

    Raises ExtractorError if the API key is missing, the response isn't JSON,
    or the response doesn't fit the schema.
    """
    if not _API_KEY:
        raise ExtractorError(
            "GEMINI_API_KEY missing. Add it to backend/.env (see .env.example)."
        )

    client = genai.Client(api_key=_API_KEY)

    img = _load_image(image_path)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    img_bytes = buf.getvalue()

    response = _generate_with_fallback(client, img_bytes)

    raw_text = (response.text or "").strip()
    # Strip accidental markdown fences (```json … ```), just in case.
    if raw_text.startswith("```"):
        raw_text = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_text).strip()

    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError as e:
        # Valid-looking JSON that won't parse usually means it was cut off — the
        # model hit its output-token cap mid-object on a very large bill.
        finish = ""
        try:
            finish = str(response.candidates[0].finish_reason)
        except Exception:
            pass
        if "MAX_TOKENS" in finish or (raw_text.startswith("{") and not raw_text.rstrip().endswith("}")):
            raise ExtractorError(
                "That bill was too large to read in one go (the response got cut "
                "off). Try cropping tighter to just the items, or split a very long "
                "receipt into two photos."
            ) from e
        raise ExtractorError(
            f"Gemini returned non-JSON. First 300 chars: {raw_text[:300]!r}"
        ) from e

    payload.setdefault("source_image", str(image_path))
    try:
        bill = Bill.model_validate(payload)
    except Exception as e:
        raise ExtractorError(
            f"Schema validation failed: {e}. Raw payload: {json.dumps(payload)[:500]}"
        ) from e

    # ARCHITECTURE: Gemini extracts raw values only. ALL arithmetic happens in
    # Python (Bill.recompute) — section subtotals, reconciliation, delta. We
    # never trust LLM math; small round-off discrepancies auto-correct.
    bill.recompute()

    # Attach a browser-renderable JPEG of the (already normalized) image.
    # This works even when the upload was HEIC, which most browsers can't render directly.
    bill.preview_image_base64 = base64.b64encode(img_bytes).decode("ascii")

    return bill
