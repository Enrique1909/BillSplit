import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import type { Bill, Person, SplitResponse } from "../types";
import {
  ArrowLeft, Check, Copy, IndianRupee, QrCode, RotateCcw, WhatsApp,
} from "./icons";

// Remembers each person's UPI ID by name across bills, so the payer's VPA
// pre-fills next time they're the one who paid.
const UPI_MAP_KEY = "billsplit-upi-ids";

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

/**
 * Build a UPI "pay" deep link. The PAYER's VPA is the PAYEE here, so tapping it
 * opens the friend's UPI app pre-filled to pay that amount straight into the
 * bill-payer's account. Works with any UPI app (GPay, PhonePe, Paytm, …).
 */
function upiPayLink(vpa: string, amount: number, note: string): string {
  const pn = vpa.split("@")[0] || "BillSplit";
  const tn = note.replace(/[^a-zA-Z0-9 ]/g, "").trim().slice(0, 40);
  const q = [
    `pa=${encodeURIComponent(vpa.trim())}`,
    `pn=${encodeURIComponent(pn)}`,
    `am=${amount.toFixed(2)}`,
    `cu=INR`,
    `tn=${encodeURIComponent(tn)}`,
  ].join("&");
  return `upi://pay?${q}`;
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
  lines.push(`${name ? `${name} · ` : ""}${inr(split.grand_total)}`);
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
    lines.push(`${p.name} - ${inr(b.total)}`);

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

  lines.push("via BillSplit");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Decode the backend's base64 JPEG preview into a File for the Web Share API.
function base64ToFile(b64: string, filename: string): File | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], filename, { type: "image/jpeg" });
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
  const restaurant = bill.restaurant.name?.trim() || "Bill";

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

  // ----- QR (generated on-device) -----
  const [qrFor, setQrFor] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string>("");
  async function toggleQr(personId: string, link: string) {
    if (qrFor === personId) {
      setQrFor(null);
      return;
    }
    try {
      const url = await QRCode.toDataURL(link, {
        margin: 1,
        width: 240,
        color: { dark: "#000000", light: "#ffffff" },
      });
      setQrUrl(url);
      setQrFor(personId);
    } catch {
      /* ignore */
    }
  }

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

  async function copy() {
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
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  function openWhatsApp() {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  // Bill photo attachment via the Web Share API (the only way to attach a file —
  // wa.me text links can't carry an image). The user picks WhatsApp from the
  // native share sheet and gets the photo + breakdown together. Falls back to
  // the text-only WhatsApp link where file sharing isn't supported (e.g. desktop).
  const billFile = useMemo(
    () =>
      bill.preview_image_base64
        ? base64ToFile(bill.preview_image_base64, "bill.jpg")
        : null,
    [bill.preview_image_base64]
  );
  const canShareBill =
    !!billFile &&
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [billFile] });

  async function shareWithBill() {
    if (billFile && canShareBill) {
      try {
        await navigator.share({ files: [billFile], text });
        return;
      } catch (e: any) {
        if (e?.name === "AbortError") return; // user dismissed the sheet
        // otherwise fall through to the text-only link
      }
    }
    openWhatsApp();
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
        <button
          onClick={canShareBill ? shareWithBill : openWhatsApp}
          className="btn-primary btn-md gap-2 flex-1"
        >
          <WhatsApp className="text-base" />
          {canShareBill ? "Share with bill photo" : "Open WhatsApp"}
        </button>
      </div>
      {canShareBill && (
        <button
          onClick={openWhatsApp}
          className="btn-ghost btn-sm mt-2 gap-1.5"
        >
          Open WhatsApp — text only
        </button>
      )}
      <p className="mt-2 text-xs text-fg-subtle leading-snug">
        {canShareBill
          ? "“Share with bill photo” opens your share sheet — pick WhatsApp to send the bill image and breakdown together."
          : bill.preview_image_base64
          ? "Attaching the bill photo needs a phone — on desktop the message goes as text only."
          : "No bill photo available to attach."}
      </p>

      {/* ---- Collect via UPI ---- */}
      <section className="card p-4 mt-5">
        <h3 className="flex items-center gap-2 font-semibold text-fg">
          <IndianRupee className="text-accent text-base" />
          Collect via UPI
        </h3>
        <p className="text-xs text-fg-muted mt-1 mb-3 leading-relaxed">
          Who paid the bill? Pick them and add their UPI ID — everyone else gets a
          link to pay them their share directly. Nothing routes through BillSplit.
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
            <ul className="mt-4 space-y-2">
              {debtors.map((b) => {
                const p = personById[b.person_id];
                if (!p) return null;
                const link = upiPayLink(upiId, b.total, `${restaurant} ${p.name}`);
                const open = qrFor === b.person_id;
                return (
                  <li
                    key={b.person_id}
                    className="rounded-xl border border-line bg-surface-2/40 p-2.5"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-8 h-8 rounded-full grid place-items-center text-white font-bold text-xs shrink-0"
                        style={{ backgroundColor: p.color }}
                      >
                        {p.name[0]?.toUpperCase()}
                      </span>
                      <span className="flex-1 min-w-0 font-medium truncate">{p.name}</span>
                      <span className="tabular-nums font-semibold shrink-0">{inr(b.total)}</span>
                      <a href={link} className="btn-primary btn-sm shrink-0">
                        Pay {payer.name.split(" ")[0]}
                      </a>
                      <button
                        onClick={() => toggleQr(b.person_id, link)}
                        className={`btn-sm shrink-0 ${open ? "btn-primary" : "btn-secondary"}`}
                        aria-label={`Show QR for ${p.name} to pay ${payer.name}`}
                        aria-pressed={open}
                      >
                        <QrCode className="text-base" />
                      </button>
                    </div>
                    {open && qrUrl && (
                      <div className="mt-3 flex flex-col items-center gap-1.5 animate-scale-in">
                        <img
                          src={qrUrl}
                          alt={`Scan to pay ${payer.name} for ${p.name}'s share`}
                          className="w-44 h-44 rounded-lg bg-white p-2"
                        />
                        <p className="text-xs text-fg-subtle text-center">
                          {p.name} scans to pay {inr(b.total)} to {upiId.trim()}
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        )}

        {payer && validUpi && debtors.length > 0 && (
          <p className="text-[11px] text-fg-subtle mt-3 leading-snug">
            "Pay {payer.name.split(" ")[0]}" opens the friend's UPI app pre-filled
            — best on Android, in person, or when you send the link directly. The
            WhatsApp draft also names {payer.name} and their UPI ID so anyone can
            pay manually, and the QR works for in-person scanning.
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
