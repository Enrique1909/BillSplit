# Public release: Auth (Google Sign-In) + Analytics (GA4)

The app is gated behind **Google Sign-In** (direct, via Google Identity Services —
$0, no user cap, no third-party vendor) and instrumented with **Google Analytics 4**.
The backend verifies each Google ID token and enforces a per-user daily extraction
cap (cost control on the paid Gemini calls).

Until you configure the env vars below, everything still runs locally:
- Frontend shows a "Sign-In isn't configured" notice on the gate.
- Backend logs `AUTH IS DISABLED` and accepts requests (dev only).

---

## 1. Google OAuth client ID (free) — required for sign-in

1. Go to <https://console.cloud.google.com/apis/credentials> (create/select a project).
2. **Configure the OAuth consent screen** (External, add app name + your email; you can
   keep it in "Testing" with a few test users, or publish it).
3. **Create Credentials → OAuth client ID → Application type: Web application**.
4. Under **Authorized JavaScript origins**, add every origin the app is served from:
   - `http://localhost:5173` (dev)
   - your production origin, e.g. `https://billsplit.example.com`
   *(No redirect URIs are needed — GIS uses the origin only.)*
5. Copy the **Client ID** (looks like `1234-abc.apps.googleusercontent.com`).

Put the **same** client ID in both places:
- `frontend/.env` → `VITE_GOOGLE_CLIENT_ID=...`
- `backend/.env`  → `GOOGLE_CLIENT_ID=...`   ← this is the token *audience*; it must match.

## 2. Google Analytics 4 (free) — optional but requested

1. Go to <https://analytics.google.com/> → Admin → **Create property** → add a **Web** data stream.
2. Copy the **Measurement ID** (`G-XXXXXXXXXX`).
3. `frontend/.env` → `VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX`.

Events tracked: `stage_view` (funnel step), `extract_started/success/failed`,
`platform_summary_added`, `split_computed`. Users are identified only by the opaque
Google `sub` — no names/emails sent to GA.

## 3. Production wiring

- `frontend/.env` → `VITE_API_BASE=https://api.your-domain` (backend origin).
- `backend/.env`  → `ALLOWED_ORIGINS=https://billsplit.example.com` (comma-separated; tightens CORS).
- `backend/.env`  → `EXTRACT_DAILY_LIMIT=25` (paid extractions per user per day).

Install the backend dep (already present via google-genai, but explicit now):
```
cd backend && source .venv/bin/activate && pip install -r requirements.txt
```

## How it works

- Frontend: GIS issues a Google **ID token** on sign-in; it's kept client-side and sent
  as `Authorization: Bearer <id_token>` on every `/api/*` call (`src/auth.tsx`, `src/api.ts`).
- Backend: `require_user` verifies the token with `google-auth` (signature, expiry, issuer,
  audience) and `enforce_extract_quota` applies the daily cap (`app/auth.py`).
- No bills are stored; sign-in only gates access + enables per-user limits.

### Limitations to know
- The daily rate limit is **in-memory** — it resets on restart and isn't shared across
  multiple backend instances. For horizontal scaling, back it with Redis.
- ID tokens last ~1 hour; the frontend silently re-issues for returning users (GIS
  auto-select) and drops the session on expiry.
