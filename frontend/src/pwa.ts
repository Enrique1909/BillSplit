/**
 * PWA / "Add to Home Screen" helpers.
 *
 * Two install paths exist and they work very differently:
 *   - Android/Chrome fires a `beforeinstallprompt` event we can capture and
 *     replay later to show the NATIVE install sheet. It can fire before React
 *     mounts, so we listen at module-load time (this file is imported from
 *     main.tsx) and stash the event.
 *   - iOS/Safari has NO programmatic install. The only path is the user tapping
 *     Share → "Add to Home Screen", so there we show an instructional nudge.
 */

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Stop Chrome's default mini-infobar so we can trigger the prompt from our
    // own button at a moment that makes sense.
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
}

/** The captured Android install event, or null if none is available. */
export function getInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

/** Subscribe to install-availability changes. Returns an unsubscribe fn. */
export function onInstallAvailabilityChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Trigger the native Android install sheet. Resolves to the user's choice. */
export async function triggerInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  await deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  notify();
  return outcome;
}

/** True when already running as an installed app (so we hide any nudge). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari exposes this non-standard flag when launched from the Home Screen.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as a Mac; distinguish by touch support.
    (navigator.userAgent.includes("Mac") && "ontouchend" in document)
  );
}

export function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent);
}
