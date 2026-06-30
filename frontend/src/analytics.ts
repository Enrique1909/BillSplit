/**
 * Google Analytics 4 (gtag) wrapper.
 *
 * No-ops cleanly when VITE_GA_MEASUREMENT_ID is unset (local dev), so the app
 * runs without analytics configured. Loads gtag.js on demand. We only ever send
 * the Google `sub` (an opaque user id) — never names/emails — so no PII reaches GA.
 */
const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;
let inited = false;

export function initAnalytics(): void {
  if (inited || !GA_ID) return;
  inited = true;

  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag("js", new Date());
  // We send page/stage views manually so SPA navigation is captured.
  window.gtag("config", GA_ID, { send_page_view: false });
}

export function track(event: string, params: Record<string, unknown> = {}): void {
  if (!GA_ID) return;
  window.gtag?.("event", event, params);
}

/** Associate subsequent events with an opaque user id (the Google `sub`). */
export function identify(userId: string): void {
  if (!GA_ID) return;
  window.gtag?.("set", { user_id: userId });
}

/** Funnel step view — call on each stage change. */
export function trackStage(stage: string): void {
  track("stage_view", { stage });
}
