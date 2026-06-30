import { useEffect } from "react";
import { createPortal } from "react-dom";
import { GoogleSignInButton, useAuth } from "../auth";
import { Lock, X } from "./icons";

/**
 * Sign-in prompt shown at the moment a user tries to read a bill (not as a
 * full-app wall). Anyone can upload + crop; this asks them to sign in to
 * proceed — a lighter, higher-intent gate. Closes itself once signed in
 * (the parent stops rendering it when `user` becomes set).
 */
export function SignInModal({
  onCancel,
  dark,
}: {
  onCancel: () => void;
  dark?: boolean;
}) {
  const { configured } = useAuth();

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
      className="fixed inset-0 z-[60] bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in"
      onClick={onCancel}
    >
      <div
        className="card shadow-pop p-6 sm:p-8 max-w-sm w-full text-center animate-scale-in relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onCancel}
          aria-label="Close"
          className="absolute top-2.5 right-2.5 grid place-items-center w-9 h-9 rounded-lg text-fg-subtle hover:text-fg hover:bg-surface-2 transition"
        >
          <X className="text-base" />
        </button>

        <div className="grid place-items-center w-12 h-12 rounded-2xl bg-accent-soft text-accent mx-auto mb-3">
          <Lock className="text-2xl" />
        </div>
        <h3 className="font-display font-bold text-lg mb-1">Sign in to read your bill</h3>
        <p className="text-sm text-fg-muted mb-5 leading-relaxed">
          One tap with Google to continue — it keeps BillSplit fair and free for
          everyone. Your bill isn't stored on our servers.
        </p>

        {configured ? (
          <div className="flex justify-center">
            <GoogleSignInButton dark={dark} />
          </div>
        ) : (
          <div className="text-xs text-fg-subtle leading-relaxed text-left rounded-lg border border-dashed border-line-strong bg-surface-2/50 p-3">
            <p className="font-medium text-fg-muted mb-1">Google Sign-In isn't configured.</p>
            Set <code className="text-accent">VITE_GOOGLE_CLIENT_ID</code> in{" "}
            <code className="text-accent">frontend/.env</code> and restart the dev server.
          </div>
        )}

        <button onClick={onCancel} className="btn-ghost btn-sm mt-4">
          Maybe later
        </button>
      </div>
    </div>,
    document.body
  );
}
