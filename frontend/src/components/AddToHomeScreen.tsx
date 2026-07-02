import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  getInstallPrompt,
  isAndroid,
  isIOS,
  isStandalone,
  onInstallAvailabilityChange,
  triggerInstall,
} from "../pwa";
import { track } from "../analytics";
import { Download, ShareIOS, X } from "./icons";

const DISMISS_KEY = "billsplit-a2hs-dismissed";
const SHOW_DELAY_MS = 2500; // let the page settle before nudging

/**
 * A dismissible bottom banner nudging mobile users to install the app to their
 * Home Screen "for the best experience" (full-screen, no browser chrome, an app
 * icon they can tap). Renders nothing when:
 *   - already installed (running standalone),
 *   - on desktop,
 *   - previously dismissed,
 *   - or (on Android) the browser hasn't offered an install prompt.
 * On iOS there's no programmatic install, so we show the Share → Add-to-Home
 * instruction; on Android we replay the captured native install prompt.
 */
export function AddToHomeScreen() {
  const [visible, setVisible] = useState(false);
  const [hasAndroidPrompt, setHasAndroidPrompt] = useState(!!getInstallPrompt());

  const ios = isIOS();
  const android = isAndroid();

  useEffect(() => {
    // Never nudge if installed, not mobile, or already dismissed.
    if (isStandalone() || (!ios && !android)) return;
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      /* ignore */
    }
    const unsub = onInstallAvailabilityChange(() =>
      setHasAndroidPrompt(!!getInstallPrompt())
    );
    const t = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => {
      clearTimeout(t);
      unsub();
    };
  }, [ios, android]);

  // On Android we can only nudge once the browser has actually offered a prompt.
  const shouldRender = visible && (ios || (android && hasAndroidPrompt));

  useEffect(() => {
    if (shouldRender) track("a2hs_shown", { platform: ios ? "ios" : "android" });
  }, [shouldRender, ios]);

  if (!shouldRender) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    track("a2hs_dismissed", { platform: ios ? "ios" : "android" });
    setVisible(false);
  }

  async function install() {
    const outcome = await triggerInstall();
    track("a2hs_install_clicked", { outcome });
    if (outcome === "accepted") setVisible(false);
  }

  return createPortal(
    <div
      className="fixed inset-x-0 bottom-0 z-40 px-3 pointer-events-none"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
    >
      <div
        role="dialog"
        aria-label="Add BillSplit to your Home Screen"
        className="pointer-events-auto mx-auto max-w-md card shadow-pop p-3.5 flex items-center gap-3 animate-slide-up"
      >
        <img
          src="/icons/icon-192.png"
          alt=""
          className="w-11 h-11 rounded-xl shrink-0 shadow-card"
          width={44}
          height={44}
        />
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold text-sm leading-tight">
            Add BillSplit to your Home Screen
          </p>
          {ios ? (
            <p className="text-xs text-fg-muted mt-0.5 leading-snug">
              Tap{" "}
              <ShareIOS className="inline-block align-[-2px] text-sm text-accent" />{" "}
              Share, then{" "}
              <span className="font-medium text-fg">“Add to Home Screen”</span> —
              opens full-screen, like an app.
            </p>
          ) : (
            <p className="text-xs text-fg-muted mt-0.5 leading-snug">
              Install for a faster, full-screen experience.
            </p>
          )}
        </div>

        {android && (
          <button
            onClick={install}
            className="btn-primary btn-sm gap-1.5 shrink-0"
          >
            <Download className="text-sm" />
            Install
          </button>
        )}
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="grid place-items-center w-8 h-8 rounded-lg text-fg-subtle hover:text-fg hover:bg-surface-2 transition shrink-0"
        >
          <X className="text-base" />
        </button>
      </div>
    </div>,
    document.body
  );
}
