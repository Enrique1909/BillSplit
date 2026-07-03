import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import type { Bill, Person, SplitResponse } from "../types";
import {
  ArrowLeft, Check, Copy, IndianRupee, RotateCcw, WhatsApp,
} from "./icons";

// Remembers each person's UPI ID by name across bills, so the payer's VPA
// pre-fills next time they're the one who paid.
const UPI_MAP_KEY = "billsplit-upi-ids";

// Public app URL appended to shared messages so recipients can try it too.
// Override per-environment with VITE_APP_URL if the domain changes.
const APP_URL =
  (import.meta.env.VITE_APP_URL as string | undefined) ||
  "https://bill-split-lyart.vercel.app";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

// Loose VPA check: <handle>@<bank>, no spaces. Avoids false negatives on the
// many UPI handle formats (okicici, okhdfcbank, ybl, paytm, apl, …).
function isLikelyUpiId(v: string): boolean {
  return /^[^\s@]{2,}@[^\s@]{2,}$/.test(v.trim());
}

function loadUpiMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(UPI_MAP_KEY) || "{}");
  } catch {
    return {};
  }
}

// Format ₹ with a sign-aware option for the taxes/charges line.
const signedInr = (n: number) => `${n < 0 ? "−" : ""}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

function buildMessage(
  bill: Bill,
  people: Person[],
  split: SplitResponse,
  payerName: string,
  upiId: string
): string {
  const personById = Object.fromEntries(people.map((p) => [p.id, p]));
  const lines: string[] = [];
  const name = bill.restaurant.name?.trim();
  // `*…*` renders bold in WhatsApp — used for the money totals so they pop.
  lines.push(`${name ? `${name} · ` : ""}*${inr(split.grand_total)}*`);
  // Who-to-pay sits right under the header so it's the first thing people see.
  if (payerName && isLikelyUpiId(upiId)) {
    lines.push(`Pay ${payerName} · ${upiId.trim()}`);
  }
  lines.push("");

  // Highest payer first.
  const ordered = [...split.breakdowns].sort((a, b) => b.total - a.total);
  for (const b of ordered) {
    const p = personById[b.person_id];
    if (!p) continue;
    lines.push(`${p.name} - *${inr(b.total)}*`);

    // Items at the price each person pays (rounded to whole rupees, like the bill).
    let sumItems = 0;
    for (const it of b.items as any[]) {
      const amt = Math.round(it.amount);
      sumItems += amt;
      lines.push(`  • ${it.name} ₹${amt.toLocaleString("en-IN")}`);
    }
    // Final line captures taxes + charges − discounts so the items add up to the total.
    const extras = Math.round(b.total) - sumItems;
    if (extras !== 0) {
      lines.push(`  • Taxes & charges ${signedInr(extras)}`);
    }
    lines.push("");
  }

  lines.push(`via BillSplit (${APP_URL})`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// A no-amount UPI "collect" link → one QR the whole group can scan to pay the
// payer (each person enters/knows their own amount from the breakdown).
function upiCollectLink(vpa: string, payeeName: string): string {
  const pn = (payeeName || vpa.split("@")[0] || "BillSplit")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim();
  const q = [`pa=${encodeURIComponent(vpa.trim())}`, `pn=${encodeURIComponent(pn)}`, "cu=INR"].join("&");
  return `upi://pay?${q}`;
}

// Turn a QR PNG data URL into a File for the Web Share API.
function dataUrlToFile(dataUrl: string, filename: string): File | null {
  try {
    const [meta, b64] = dataUrl.split(",");
    const mime = /data:(.*?);base64/.exec(meta)?.[1] || "image/png";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], filename, { type: mime });
  } catch {
    return null;
  }
}

export function ShareStage({
  bill,
  people,
  split,
  onBack,
  onReset,
}: {
  bill: Bill;
  people: Person[];
  split: SplitResponse;
  onBack: () => void;
  onReset: () => void;
}) {
  const personById = Object.fromEntries(people.map((p) => [p.id, p]));

  // ----- who paid + their UPI -----
  const [payerId, setPayerId] = useState<string | null>(null);
  const payer = payerId ? personById[payerId] : null;
  const [upiId, setUpiId] = useState("");
  const validUpi = isLikelyUpiId(upiId);

  // When the payer changes, pre-fill their saved UPI ID (if any).
  useEffect(() => {
    if (!payer) {
      setUpiId("");
      return;
    }
    setUpiId(loadUpiMap()[payer.name] || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payerId]);

  // Remember a valid UPI ID against the payer's name for next time.
  useEffect(() => {
    if (!payer || !validUpi) return;
    try {
      const next = { ...loadUpiMap(), [payer.name]: upiId.trim() };
      localStorage.setItem(UPI_MAP_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, [payer, upiId, validUpi]);

  // One receiver QR (payer's UPI ID, no amount) — displayed for in-person
  // scanning; each payer scans it and enters their own amount. Generated
  // on-device whenever the payer/UPI changes.
  const [receiverQr, setReceiverQr] = useState<string>("");
  useEffect(() => {
    if (!payer || !validUpi) {
      setReceiverQr("");
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(upiCollectLink(upiId, payer.name), {
      margin: 2,
      width: 360,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setReceiverQr(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [payer, upiId, validUpi]);

  // ----- message draft (synced until the user edits it) -----
  const generated = useMemo(
    () =>
      buildMessage(bill, people, split, payer?.name ?? "", validUpi ? upiId : ""),
    [bill, people, split, payer, upiId, validUpi]
  );
  const [text, setText] = useState(generated);
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    if (!edited) setText(generated);
  }, [generated, edited]);

  const [copied, setCopied] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const rows = Math.min(20, Math.max(8, text.split("\n").length + 1));

  async function writeClipboard() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      taRef.current?.select();
      try {
        document.execCommand("copy");
      } catch {
        /* selected for manual copy */
      }
    }
  }
  async function copy() {
    await writeClipboard();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  // wa.me reliably delivers the breakdown TEXT (the important bit).
  function openWhatsApp() {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  // Share the payer's UPI QR as an image — one QR the whole group scans to pay
  // them. WhatsApp keeps EITHER text OR an image per share, so we also copy the
  // breakdown to the clipboard (send it first via "Send on WhatsApp", or paste
  // it under the QR). Falls back to downloading the QR where file-share isn't
  // supported (desktop).
  async function sharePaymentQr() {
    if (!payer || !validUpi) return;
    let dataUrl: string;
    try {
      dataUrl = await QRCode.toDataURL(upiCollectLink(upiId, payer.name), {
        margin: 2,
        width: 512,
        color: { dark: "#000000", light: "#ffffff" },
      });
    } catch {
      return;
    }
    const file = dataUrlToFile(dataUrl, `pay-${payer.name.replace(/\s+/g, "")}.png`);
    await writeClipboard();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
    if (file && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          text: `Pay ${payer.name} · ${upiId.trim()} — your share is in the breakdown 🙏`,
        });
      } catch {
        /* dismissed */
      }
    } else if (file) {
      // Desktop fallback: download the QR so it can be attached manually.
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  // Everyone except the payer owes the payer their share.
  const debtors = split.breakdowns
    .filter((b) => b.person_id !== payerId)
    .sort((a, b) => b.total - a.total); // most-owed first

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="flex items-center gap-2 text-xl sm:text-2xl font-bold tracking-tight mb-1">
        <WhatsApp className="text-accent text-xl" />
        Share the split
      </h2>
      <p className="text-fg-muted mb-5 text-sm leading-relaxed">
        Here's a ready-to-send breakdown. Edit anything you like, then send it on
        WhatsApp or copy it anywhere.
      </p>

      <div className="card p-2">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setEdited(true);
          }}
          rows={rows}
          spellCheck={false}
          aria-label="WhatsApp message draft"
          className="w-full resize-y rounded-lg bg-surface-2 text-fg p-3.5 text-sm leading-relaxed
            font-mono tabular-nums border border-line
            focus:outline-none focus:bg-surface focus:border-accent focus:ring-2 focus:ring-accent/25"
        />
      </div>

      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        <button onClick={copy} className="btn-secondary btn-md gap-1.5 sm:w-auto">
          {copied ? <Check className="text-base text-accent" /> : <Copy className="text-base" />}
          {copied ? "Copied!" : "Copy message"}
        </button>
        <button onClick={openWhatsApp} className="btn-primary btn-md gap-2 flex-1">
          <WhatsApp className="text-base" />
          Send on WhatsApp
        </button>
      </div>
      <p className="mt-2 text-xs text-fg-subtle leading-snug">
        Sends the breakdown text. To collect, set who paid below and share their
        payment QR.
      </p>

      {/* ---- Collect via UPI ---- */}
      <section className="card p-4 mt-5">
        <h3 className="flex items-center gap-2 font-semibold text-fg">
          <IndianRupee className="text-accent text-base" />
          Collect via UPI
        </h3>
        <p className="text-xs text-fg-muted mt-1 mb-3 leading-relaxed">
          Who paid the bill? Pick them and add their UPI ID — then everyone scans
          one QR to pay them, entering their amount from the list. Nothing routes
          through BillSplit.
        </p>

        {/* Payer picker */}
        <div className="flex flex-wrap gap-2">
          {split.breakdowns.map((b) => {
            const p = personById[b.person_id];
            if (!p) return null;
            const active = payerId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setPayerId(active ? null : p.id)}
                className={`inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full text-sm font-medium border transition active:scale-95 ${
                  active ? "text-white shadow-card" : "text-fg bg-surface hover:bg-surface-2"
                }`}
                style={
                  active
                    ? { backgroundColor: p.color, borderColor: p.color }
                    : { borderColor: "rgb(var(--line))" }
                }
                aria-pressed={active}
              >
                <span
                  className="w-6 h-6 rounded-full grid place-items-center text-white font-bold text-[11px]"
                  style={{ backgroundColor: active ? "rgba(0,0,0,0.2)" : p.color }}
                >
                  {p.name[0]?.toUpperCase()}
                </span>
                {p.name}
                {active && <Check className="text-sm" />}
              </button>
            );
          })}
        </div>

        {payer && (
          <div className="mt-4">
            <label className="text-xs font-medium text-fg-muted">
              {payer.name}'s UPI ID
            </label>
            <input
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              placeholder={`${payer.name.toLowerCase()}@okicici`}
              inputMode="email"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label={`${payer.name}'s UPI ID`}
              className="field mt-1"
            />
            {upiId.trim() !== "" && !validUpi && (
              <p className="text-xs text-danger mt-1.5">
                That doesn't look like a UPI ID — it should be like name@okicici.
              </p>
            )}
          </div>
        )}

        {payer && validUpi && (
          debtors.length === 0 ? (
            <p className="mt-4 text-sm text-fg-muted">
              {payer.name} covered everything — no one else to collect from.
            </p>
          ) : (
            <>
              {/* One QR everyone scans in person; they enter their own amount */}
              {receiverQr && (
                <div className="mt-4 flex flex-col items-center gap-2">
                  <img
                    src={receiverQr}
                    alt={`Scan to pay ${payer.name}`}
                    className="w-52 h-52 rounded-xl bg-white p-2.5 shadow-card"
                  />
                  <p className="text-sm font-semibold">Scan to pay {payer.name}</p>
                  <p className="text-xs text-fg-subtle text-center max-w-[17rem]">
                    Everyone scans this in their UPI app and enters their amount from the
                    list below.
                  </p>
                </div>
              )}

              {/* Who owes what — the amount each person enters */}
              <ul className="mt-4 rounded-xl border border-line overflow-hidden divide-y divide-line">
                {debtors.map((b) => {
                  const p = personById[b.person_id];
                  if (!p) return null;
                  return (
                    <li
                      key={b.person_id}
                      className="flex items-center gap-2.5 px-3 py-2.5 bg-surface-2/40"
                    >
                      <span
                        className="w-7 h-7 rounded-full grid place-items-center text-white font-bold text-[11px] shrink-0"
                        style={{ backgroundColor: p.color }}
                      >
                        {p.name[0]?.toUpperCase()}
                      </span>
                      <span className="flex-1 min-w-0 font-medium truncate">{p.name}</span>
                      <span className="tabular-nums font-semibold shrink-0">{inr(b.total)}</span>
                    </li>
                  );
                })}
              </ul>

              {/* Remote: share the same QR on WhatsApp */}
              <button onClick={sharePaymentQr} className="btn-secondary btn-md w-full mt-3 gap-2">
                <WhatsApp className="text-base" />
                Share this QR on WhatsApp
              </button>
            </>
          )
        )}

        {payer && validUpi && debtors.length > 0 && (
          <p className="text-[11px] text-fg-subtle mt-3 leading-snug">
            Works in any UPI app (GPay, PhonePe, Paytm…). "Share this QR on WhatsApp"
            sends the same QR to the group for those settling remotely.
          </p>
        )}
      </section>

      <div className="mt-8 flex flex-wrap justify-between items-center gap-3">
        <button onClick={onBack} className="btn-ghost btn-md gap-1.5">
          <ArrowLeft className="text-sm" />
          Back to split
        </button>
        <button onClick={onReset} className="btn-secondary btn-md gap-1.5">
          <RotateCcw className="text-sm" />
          New bill
        </button>
      </div>
    </div>
  );
}
