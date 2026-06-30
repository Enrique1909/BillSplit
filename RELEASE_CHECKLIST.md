# BillSplit — Public Release Checklist

Everything **you** need to do to take the app live. The code is done; these are
the external/account steps. Details: [docs/03_auth_and_analytics.md](docs/03_auth_and_analytics.md)
and [docs/04_deploy_render_vercel.md](docs/04_deploy_render_vercel.md).

Env var quick-reference:

| Where | Variable | Value |
|---|---|---|
| `backend/.env` + Render | `GEMINI_API_KEY` | your AI Studio key |
| `backend/.env` + Render | `GOOGLE_CLIENT_ID` | OAuth Web client ID |
| `backend/.env` + Render | `ALLOWED_ORIGINS` | `*` local → Vercel URL in prod |
| `backend/.env` + Render | `EXTRACT_DAILY_LIMIT` | `25` |
| `frontend/.env` + Vercel | `VITE_GOOGLE_CLIENT_ID` | **same** OAuth client ID |
| `frontend/.env` + Vercel | `VITE_GA_MEASUREMENT_ID` | GA4 `G-XXXX` |
| `frontend/.env` + Vercel | `VITE_API_BASE` | blank local → Render URL in prod |

---

## Phase A — Get the accounts/keys (free)

- [ ] **Gemini key** (if not already): create at <https://aistudio.google.com/> → put in `backend/.env` as `GEMINI_API_KEY`.
- [ ] **Google OAuth client ID**: Google Cloud Console → APIs & Services → Credentials → **Create Credentials → OAuth client ID → Web application**.
  - [ ] Configure the **OAuth consent screen** (External; app name + your email).
  - [ ] Add **Authorized JavaScript origins**: `http://localhost:5173` (add the Vercel URL later in Phase E).
  - [ ] Copy the **Client ID**.
- [ ] **GA4 property**: <https://analytics.google.com/> → Admin → Create property → **Web** data stream → copy the **Measurement ID** (`G-XXXX`).

## Phase B — Test locally

- [ ] Create `frontend/.env` from `frontend/.env.example`; set `VITE_GOOGLE_CLIENT_ID` + `VITE_GA_MEASUREMENT_ID` (leave `VITE_API_BASE` blank).
- [ ] Create/update `backend/.env`; set `GOOGLE_CLIENT_ID` (same as frontend) + `GEMINI_API_KEY`.
- [ ] **Restart the backend** (`uvicorn`) and **restart the frontend dev server** so both pick up the new `.env` + all the recent code changes.
- [ ] Verify: sign in with Google → upload a bill → crop/rotate → review → people → assign → split → share (WhatsApp + UPI). Confirm the Google button works and a bad/missing token is rejected.

## Phase C — Put it on GitHub

- [ ] `git init && git add -A && git commit -m "BillSplit"` (the `.env` files are already gitignored — double-check they're NOT committed).
- [ ] Create an empty GitHub repo and `git push`.

## Phase D — Deploy the backend (Render, free, no Docker)

- [ ] Render → **New → Blueprint** (reads `render.yaml`) — or **New → Web Service** with Root Directory `backend`, Build `pip install -r requirements.txt`, Start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
- [ ] Set env vars: `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID` (leave `ALLOWED_ORIGINS` for Phase E).
- [ ] Deploy → note the URL (e.g. `https://billsplit-api.onrender.com`) → check `/api/health` returns `{"status":"ok"}`.

## Phase E — Deploy the frontend (Vercel, free)

- [ ] Vercel → **Add New → Project** → import the repo → set **Root Directory = `frontend`**.
- [ ] Env vars: `VITE_GOOGLE_CLIENT_ID`, `VITE_GA_MEASUREMENT_ID`, `VITE_API_BASE` = the Render URL.
- [ ] Deploy → note the URL (e.g. `https://billsplit.vercel.app`).

## Phase F — Connect the two + go public

- [ ] **Render** → set `ALLOWED_ORIGINS` = your Vercel URL → save (redeploys). *(CORS)*
- [ ] **Google Cloud** → OAuth client → add your Vercel URL to **Authorized JavaScript origins**. *(or the button throws `origin_mismatch`)*
- [ ] **Google Cloud** → OAuth consent screen → **Publish app** so anyone (not just test users) can sign in. *(Basic profile/email scopes need no Google verification — it's instant.)*

## Phase G — Verify live + polish

- [ ] Open the Vercel URL on a **phone**: sign in → full flow → test **WhatsApp share with bill photo** and **UPI "Pay" / QR** (these need HTTPS + a real device).
- [ ] (Optional) Avoid Render cold starts: point a free pinger (<https://uptimerobot.com> / <https://cron-job.org>) at `…/api/health` every ~10 min.
- [ ] Watch GA4 **Realtime** to confirm events (`stage_view`, `extract_success`, `split_computed`, …) are arriving.

---

### Known limitations (fine for launch)
- Per-user daily rate limit is **in-memory** — resets on restart, not shared across instances. Add Redis if you scale to multiple backend instances.
- Render free **sleeps after 15 min idle** (first request ~30–50s) unless you add the uptime pinger.
- No bill history is stored (sign-in only gates access), as chosen.
