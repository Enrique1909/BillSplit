# Deploy free: backend on Render, frontend on Vercel

Two services, both free, no Docker. The backend (FastAPI) runs as a **native
Python** web service on Render; the frontend (Vite build) is a static site on
Vercel. Both deploy from a Git repo, so step 0 is getting this onto GitHub.

> Heads-up: Render's **free** web service **sleeps after ~15 min idle**, so the
> first request after a lull takes ~30–50s (cold start). See "Avoid cold starts"
> at the end to keep it warm.

---

## 0. Push to GitHub

This folder isn't a git repo yet. Create one and push (keep `.env` files out —
they're already gitignored):

```bash
cd /Users/enrique/Documents/Claude/Projects/BillSplit
git init && git add -A && git commit -m "BillSplit"
# create an empty repo on github.com, then:
git remote add origin https://github.com/<you>/billsplit.git
git push -u origin main
```

## 1. Backend → Render (native Python, no Docker)

1. Render → **New → Blueprint**, pick your repo. It reads `render.yaml` and creates
   the `billsplit-api` web service (free, Python).
   *(Or do it manually: New → **Web Service** → connect repo →*
   *Root Directory `backend`, Runtime **Python 3**,*
   *Build Command `pip install -r requirements.txt`,*
   *Start Command `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.)*
2. In the service's **Environment**, set the secret vars (the Blueprint marks them
   to fill in):
   - `GEMINI_API_KEY` — your free key from <https://aistudio.google.com/>
   - `GOOGLE_CLIENT_ID` — your Google OAuth Web client ID (same one as the frontend)
   - `ALLOWED_ORIGINS` — leave blank for now; set in step 3 once you know the Vercel URL
   - (`GEMINI_MODEL` and `EXTRACT_DAILY_LIMIT` already have defaults)
3. Deploy. Note the public URL, e.g. **`https://billsplit-api.onrender.com`**.
   Check `https://billsplit-api.onrender.com/api/health` → `{"status":"ok"}`.

## 2. Frontend → Vercel

1. Vercel → **Add New → Project**, import your repo.
2. Set **Root Directory = `frontend`** (important — it's a monorepo). Vercel
   auto-detects Vite (build `npm run build`, output `dist`).
3. Add **Environment Variables**:
   - `VITE_GOOGLE_CLIENT_ID` — your Google OAuth Web client ID
   - `VITE_GA_MEASUREMENT_ID` — your GA4 `G-XXXX` id (optional)
   - `VITE_API_BASE` — the Render URL from step 1, e.g. `https://billsplit-api.onrender.com`
4. Deploy. Note the URL, e.g. **`https://billsplit.vercel.app`**.

## 3. Wire the two together (the part everyone forgets)

Both URLs now exist, so close the loop:

1. **Render** → set `ALLOWED_ORIGINS` = your Vercel URL (e.g. `https://billsplit.vercel.app`)
   → save (it redeploys). This is the CORS allow-list.
2. **Google Cloud Console** → your OAuth client → **Authorized JavaScript origins**
   → add your Vercel URL (and keep `http://localhost:5173` for dev). Without this,
   the Google button errors with `origin_mismatch`.
3. Re-open the Vercel URL → "Continue with Google" should now work end to end.

## Avoid cold starts (optional)

Free Render sleeps after 15 min idle. Keep it warm with a free uptime pinger
hitting the health check every ~10 minutes:

- <https://uptimerobot.com> or <https://cron-job.org> → monitor
  `https://billsplit-api.onrender.com/api/health` every 10 min.

(750 free instance-hours/month is enough to stay up continuously for one service.)

## Cost reality

- Hosting: **$0** on both free tiers.
- Gemini: **$0** within the `2.5-flash` free tier (~1,500 req/day). The sign-in
  gate + `EXTRACT_DAILY_LIMIT` keep you inside it; raise the limit or add billing
  only if you outgrow it.
