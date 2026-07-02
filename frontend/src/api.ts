import type { Assignment, Bill, SplitOptions, SplitResponse } from "./types";

// In dev, requests go to "/api" (proxied to FastAPI by Vite). In production the
// frontend and backend are separate origins, so set VITE_API_BASE to the backend
// URL (e.g. https://api.billsplit.app) and CORS-allow the frontend there.
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";
const API = `${API_BASE}/api`;

function authHeaders(token?: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Pull the clean FastAPI `detail` string out of an error response so users see
// a readable message (e.g. "Gemini is busy…") instead of raw JSON + status code.
async function readError(r: Response): Promise<string> {
  const text = await r.text();
  try {
    const j = JSON.parse(text);
    if (j && typeof j.detail === "string") return j.detail;
  } catch {
    /* not JSON */
  }
  return text || `${r.status} ${r.statusText}`;
}

/** Basic end-of-flow feedback → logged server-side (best-effort). */
export async function sendFeedback(
  sentiment: "good" | "bad",
  wouldUseAgain: boolean
): Promise<void> {
  try {
    await fetch(`${API}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentiment, would_use_again: wouldUseAgain }),
    });
  } catch {
    /* best-effort, non-blocking */
  }
}

/** Tell the backend who just signed in (so the owner sees identities in logs). */
export async function pingSession(token?: string | null): Promise<void> {
  try {
    await fetch(`${API}/auth/session`, { method: "POST", headers: authHeaders(token) });
  } catch {
    /* best-effort, non-blocking */
  }
}

export async function extractBill(file: File, token?: string | null): Promise<Bill> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${API}/extract`, {
    method: "POST",
    body: fd,
    headers: authHeaders(token),
  });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export async function splitBill(
  bill: Bill,
  assignments: Record<string, Assignment[]>,
  options: SplitOptions,
  token?: string | null
): Promise<SplitResponse> {
  const r = await fetch(`${API}/split`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ bill, assignments, options }),
  });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}
