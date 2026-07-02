/**
 * Full-screen loading overlay shown during extraction. Important on mobile
 * because Gemini extraction takes 5–10s and the user has no idea anything is
 * happening otherwise — they tap Extract and the app appears frozen.
 *
 * Features:
 *   - Animated dots so the user can see *progress* (not just a static spinner)
 *   - Estimated time so they don't think it's broken
 *   - Step-by-step status messages that change as time passes
 *   - Backdrop blur so it's clearly distinct from the underlying content
 */
import { useEffect, useState } from "react";

const DEFAULT_STEPS = [
  "Uploading photo to the server…",
  "Reading the bill…",
  "Identifying line items and taxes…",
  "Verifying totals add up…",
  "Almost done…",
];

const HEIC_STEPS = [
  "Loading the HEIC decoder…",
  "Decompressing the photo…",
  "Converting to JPEG…",
  "Almost done…",
];

const SPLIT_STEPS = [
  "Validating assignments…",
  "Computing per-person totals…",
  "Distributing taxes by tax-class…",
  "Rounding to rupees…",
];

export function LoadingOverlay({
  show,
  label = "Extracting bill",
}: {
  show: boolean;
  label?: string;
}) {
  // Pick step messages that match the label so users see something coherent.
  const STEPS = /HEIC/i.test(label)
    ? HEIC_STEPS
    : /split/i.test(label)
    ? SPLIT_STEPS
    : DEFAULT_STEPS;
  const [stepIdx, setStepIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!show) {
      setStepIdx(0);
      setElapsed(0);
      setProgress(0);
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(() => {
      const ms = Date.now() - startedAt;
      const seconds = Math.floor(ms / 1000);
      setElapsed(seconds);
      setStepIdx(Math.min(STEPS.length - 1, Math.floor(seconds / 2)));
      // Determinate-looking bar that eases toward ~92% and never falsely
      // "completes" — it decelerates the longer things take, which reads as
      // steady progress rather than a frozen spinner. It snaps to 100% only
      // when `show` flips false (the request actually finished).
      setProgress(92 * (1 - Math.exp(-ms / 9000)));
    }, 200);
    return () => clearInterval(id);
    // STEPS is derived from `label`, so when the label changes mid-flight we
    // restart the cycle from step 0 of the new step list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, label]);

  if (!show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[80] bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in"
    >
      <div className="card shadow-pop p-6 sm:p-8 max-w-sm w-full text-center animate-scale-in">
        {/* Animated spinner */}
        <div className="mb-4 flex justify-center">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 rounded-full border-4 border-line" />
            <div className="absolute inset-0 rounded-full border-4 border-accent border-t-transparent animate-spin" />
          </div>
        </div>

        <h3 className="font-display font-semibold text-lg mb-1">{label}</h3>

        {/* Current step + animated dots */}
        <p className="text-sm text-fg-muted min-h-[2.5em]">
          {STEPS[stepIdx]}
          <span className="inline-block w-6 text-left">
            <DotsAnim />
          </span>
        </p>

        {/* Progress bar — a moving fill gives clearer "it's working" feedback
            than the spinner alone. It eases toward ~92% (see effect above). */}
        <div
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Elapsed counter — calming evidence the app isn't frozen. The message
            escalates so a cold-start (server waking up) doesn't feel broken. */}
        <p className="text-xs text-fg-subtle mt-3">
          <span className="tabular-nums">{elapsed}s</span>{" "}
          {elapsed < 12
            ? "· usually 5–10 seconds"
            : elapsed < 25
            ? "· hang tight, almost there…"
            : "· the server may be waking up — the first request can take up to a minute"}
        </p>
      </div>
    </div>
  );
}

function DotsAnim() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setN((x) => (x % 3) + 1), 400);
    return () => clearInterval(id);
  }, []);
  return <>{".".repeat(n)}</>;
}
