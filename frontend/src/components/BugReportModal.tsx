import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bug, Send, X } from "./icons";
import { track } from "../analytics";

const BUG_EMAIL = "edcosta149@gmail.com";

/**
 * Report-a-bug prompt, triggerable anytime from the footer. Opens the user's
 * email app pre-filled to BUG_EMAIL (zero backend, works immediately; the owner
 * gets the report + the reporter's address to reply). Auto-appends diagnostic
 * context so reports are actionable.
 */
export function BugReportModal({ onClose }: { onClose: () => void }) {
  const [desc, setDesc] = useState("");

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function send() {
    const body = [
      desc.trim() || "(no description)",
      "",
      "———",
      `Page: ${window.location.href}`,
      `When: ${new Date().toString()}`,
      `Device: ${navigator.userAgent}`,
    ]
      .filter(Boolean)
      .join("\n");
    const url = `mailto:${BUG_EMAIL}?subject=${encodeURIComponent(
      "BillSplit bug report"
    )}&body=${encodeURIComponent(body)}`;
    track("bug_report_opened");
    window.location.href = url;
    onClose();
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Report a bug"
      className="fixed inset-0 z-[60] bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="card shadow-pop p-6 max-w-md w-full animate-scale-in relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-2.5 right-2.5 grid place-items-center w-9 h-9 rounded-lg text-fg-subtle hover:text-fg hover:bg-surface-2 transition"
        >
          <X className="text-base" />
        </button>

        <h3 className="flex items-center gap-2 font-display font-bold text-lg mb-1">
          <Bug className="text-accent text-xl" />
          Report a bug
        </h3>
        <p className="text-sm text-fg-muted mb-4">
          What went wrong? This opens your email app to send it to us — your email
          address and a bit of device info come along automatically.
        </p>

        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          rows={4}
          autoFocus
          placeholder="Describe the problem, and what you were doing…"
          className="w-full resize-y rounded-lg bg-surface-2 text-fg p-3 text-sm border border-line
            placeholder:text-fg-subtle focus:outline-none focus:bg-surface focus:border-accent focus:ring-2 focus:ring-accent/25"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost btn-md">
            Cancel
          </button>
          <button onClick={send} className="btn-primary btn-md gap-1.5">
            <Send className="text-sm" />
            Send report
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
