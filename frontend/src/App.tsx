import { useEffect, useMemo, useState } from "react";
import type {
  Assignment, Bill, BillItem, Person, SplitOptions, SplitResponse,
} from "./types";
import { extractBill, pingSession, splitBill } from "./api";
import { UploadStage } from "./components/UploadStage";
import { CropStage } from "./components/CropStage";
import { ReviewStage } from "./components/ReviewStage";
import { PeopleStage } from "./components/PeopleStage";
import { AssignStage } from "./components/AssignStage";
import { SummaryStage } from "./components/SummaryStage";
import { ShareStage } from "./components/ShareStage";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { Stepper } from "./components/Stepper";
import { useTheme } from "./theme";
import { useAuth } from "./auth";
import { SignInModal } from "./components/SignInModal";
import { BugReportModal } from "./components/BugReportModal";
import { AddToHomeScreen } from "./components/AddToHomeScreen";
import { identify, track, trackStage } from "./analytics";
import { AlertTriangle, Bug, LogOut, Moon, Receipt, RotateCcw, Sun } from "./components/icons";

type Stage = "upload" | "crop" | "review" | "people" | "assign" | "summary" | "share";

// Vibrant, high-contrast per-person palette tuned to read on both light and dark.
const PERSON_COLORS = [
  "#10b981", "#6366f1", "#f43f5e", "#f59e0b",
  "#06b6d4", "#a855f7", "#ec4899", "#84cc16",
];

// Maps a stage to its index in the 6-step progress rail (crop folds into Capture).
const STAGE_STEP: Record<Stage, number> = {
  upload: 0, crop: 0, review: 1, people: 2, assign: 3, summary: 4, share: 5,
};

const DEFAULT_OPTIONS: SplitOptions = {
  skip_service_charge: false,
  service_charge_excludes_alcohol: false,
  skip_voluntary_charges: false,
};

/**
 * Combine a restaurant receipt extraction with a platform-summary extraction
 * (Swiggy Dineout / Zomato / District). The restaurant receipt is the source
 * of truth for *items and printed taxes*; the platform summary is the source
 * of truth for *discounts, platform charges (convenience fee + its GST),
 * pre-payments (cover charge), and the actual amount paid*.
 *
 * Round-off is derived so reconciliation lands automatically — the user sees
 * a balanced bill in the review screen and can spot-check.
 */
function mergePlatformBill(restaurant: Bill, platform: Bill): Bill {
  // Avoid duplicating taxes the restaurant already has (rare, but possible
  // if the platform happens to repeat a CGST/SGST line).
  const existingTaxLabels = new Set(restaurant.taxes.map((t) => t.label.toLowerCase()));
  const platformOnlyTaxes = platform.taxes.filter(
    (t) => !existingTaxLabels.has(t.label.toLowerCase())
  );

  const sectionsTotal = restaurant.sections.reduce((s, x) => s + x.subtotal, 0);
  const taxesTotal =
    restaurant.taxes.reduce((s, t) => s + t.amount, 0) +
    platformOnlyTaxes.reduce((s, t) => s + t.amount, 0);
  const chargesTotal =
    restaurant.bill_level_charges.reduce((s, c) => s + c.amount, 0) +
    platform.bill_level_charges.reduce((s, c) => s + c.amount, 0);
  const discountsTotal = platform.discounts.reduce((s, d) => s + d.amount, 0);

  const expected = sectionsTotal + taxesTotal + chargesTotal - discountsTotal;
  const derivedRoundOff = +(platform.grand_total - expected).toFixed(2);

  const merged: Bill = {
    ...restaurant,
    // Restaurant's items + taxes win
    sections: restaurant.sections,
    taxes: [...restaurant.taxes, ...platformOnlyTaxes],
    // Platform's charges and discounts get merged in
    bill_level_charges: [
      ...restaurant.bill_level_charges,
      ...platform.bill_level_charges,
    ],
    discounts: platform.discounts,
    // Platform's grand_total is the actual paid amount
    grand_total: platform.grand_total,
    round_off: derivedRoundOff,
    meta: {
      ...restaurant.meta,
      platform: platform.meta.platform !== "unknown"
        ? platform.meta.platform
        : restaurant.meta.platform,
    },
    reconciliation: {
      ...restaurant.reconciliation,
      computed_total: +(expected + derivedRoundOff).toFixed(2),
      delta: 0,
      notes: [
        ...(restaurant.reconciliation.notes ?? []),
        `Merged platform summary: ${platform.discounts.length} discount(s), ` +
        `${platform.bill_level_charges.length} platform charge(s), ` +
        `restaurant total ₹${restaurant.grand_total.toFixed(2)} → final paid ₹${platform.grand_total.toFixed(2)}.`,
      ],
    },
  };
  return merged;
}

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const { user, getToken, signOut } = useAuth();
  const [stage, setStage] = useState<Stage>("upload");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Optional override for the LoadingOverlay's title — set when busy work
  // is something other than "extract" (e.g. HEIC conversion).
  const [busyLabel, setBusyLabel] = useState<string | null>(null);

  const [bill, setBill] = useState<Bill | null>(null);
  // Best-effort local preview while the backend processes (JPEG/PNG only — browsers
  // can't render HEIC blobs). Backend returns a guaranteed-renderable preview later.
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  // The pending file picked by the user, parked while they crop it.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);

  const imagePreview = bill?.preview_image_base64
    ? `data:image/jpeg;base64,${bill.preview_image_base64}`
    : localPreview;

  const [people, setPeople] = useState<Person[]>([]);
  const [assignments, setAssignments] = useState<Record<string, Assignment[]>>({});
  const [options, setOptions] = useState<SplitOptions>(DEFAULT_OPTIONS);
  const [split, setSplit] = useState<SplitResponse | null>(null);

  // Sign-in is required to READ a bill (not to land on the app). A file the user
  // tried to extract while signed out is parked here until they sign in.
  const [pendingExtractFile, setPendingExtractFile] = useState<File | null>(null);
  const [signInOpen, setSignInOpen] = useState(false); // proactive (header button)
  const [bugOpen, setBugOpen] = useState(false);

  const parentItems: BillItem[] = useMemo(
    () =>
      bill
        ? bill.sections.flatMap((s) =>
            s.items.filter((i) => i.parent_id === null && !i.is_complimentary)
          )
        : [],
    [bill]
  );

  // --- on sign-in: identify in GA4, log the sign-in, and resume a parked extract ---
  useEffect(() => {
    if (!user) return;
    // user_id lets GA4 dedupe a person across sessions/devices → real DAU/MAU.
    identify(user.sub);
    // GA4's recommended `login` event = an explicit, countable sign-in signal.
    track("login", { method: "Google" });
    // Record WHO signed in (email) in the backend logs.
    pingSession(getToken());
    // Close any sign-in prompt now that we're in.
    setSignInOpen(false);
    // Resume an extraction the user started before signing in.
    if (pendingExtractFile) {
      const f = pendingExtractFile;
      setPendingExtractFile(null);
      void handleExtract(f);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  useEffect(() => {
    trackStage(stage);
  }, [stage]);

  /**
   * User picked a file — route to crop stage if the browser can render it,
   * otherwise try converting HEIC client-side, otherwise skip straight to
   * extraction (where the backend has its own HEIC fallback).
   *
   * Why bother with client-side HEIC conversion?
   * iPhones shoot HEIC by default. Safari can render HEIC in <img>, but
   * Chrome/Firefox/Edge cannot. Without conversion, desktop browsers + HEIC
   * upload would skip the crop UI (less control), AND the cropped JPEG that
   * we *would* have sent to the backend has to be reproduced via sips on the
   * server — adds latency. Converting to JPEG in the browser fixes both.
   */
  function handlePickFile(file: File) {
    setError(null);
    const url = URL.createObjectURL(file);

    const test = new Image();
    test.onload = () => {
      setPendingFile(file);
      setPendingPreviewUrl(url);
      setStage("crop");
    };
    test.onerror = async () => {
      URL.revokeObjectURL(url);

      // Try HEIC → JPEG client-side. heic2any uses libheif via WebAssembly,
      // so it works even where the browser can't natively decode HEIC.
      const isHeic =
        /\.hei[cf]$/i.test(file.name) ||
        file.type === "image/heic" ||
        file.type === "image/heif";
      if (isHeic) {
        try {
          setBusy(true);
          setBusyLabel("Converting HEIC photo");
          // Dynamic import — heic2any is ~600KB, only loaded when needed.
          const { default: heic2any } = await import("heic2any");
          const blob = (await heic2any({
            blob: file,
            toType: "image/jpeg",
            quality: 0.9,
          })) as Blob;
          const converted = new File(
            [blob],
            file.name.replace(/\.hei[cf]$/i, ".jpg"),
            { type: "image/jpeg" }
          );
          const convUrl = URL.createObjectURL(converted);
          setPendingFile(converted);
          setPendingPreviewUrl(convUrl);
          setStage("crop");
          return;
        } catch (e: any) {
          // Conversion failed — fall through to direct extraction.
          console.warn("heic2any conversion failed:", e);
        } finally {
          setBusy(false);
          setBusyLabel(null);
        }
      }

      // Last resort: skip crop, let the backend handle the format.
      handleExtract(file);
    };
    test.src = url;
  }

  async function handleExtract(file: File) {
    // Sign-in wall lives HERE (at the value moment), not on the whole app: the
    // user has already uploaded/cropped — now ask them to sign in to proceed.
    if (!user) {
      setPendingExtractFile(file);
      return;
    }
    setBusy(true);
    setError(null);
    const isHeic = /\.hei[cf]$/i.test(file.name);
    // Use the cropped/uploaded file's data URL as the local preview.
    setLocalPreview(isHeic ? null : URL.createObjectURL(file));
    track("extract_started");
    try {
      const b = await extractBill(file, getToken());
      setBill(b);
      setStage("review");
      track("extract_success", {
        platform: b.meta.platform,
        total: Math.round(b.grand_total),
        reconciled: Math.abs(b.reconciliation.delta) <= 0.5,
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setStage("upload");
      track("extract_failed", { message: String(e?.message ?? e).slice(0, 120) });
    } finally {
      setBusy(false);
      setPendingFile(null);
      if (pendingPreviewUrl) {
        URL.revokeObjectURL(pendingPreviewUrl);
        setPendingPreviewUrl(null);
      }
    }
  }

  // Backwards-compat name used by UploadStage
  const handleUpload = handlePickFile;

  /**
   * Upload a Swiggy / Zomato / District platform-summary screenshot AFTER the
   * restaurant receipt. Merge: keep items+taxes from receipt, replace
   * discounts+platform-charges+grand_total with values from the platform summary.
   * The platform's grand_total is what was actually paid, so it wins.
   */
  async function handleAddPlatformSummary(file: File) {
    if (!bill) return;
    setBusy(true);
    setError(null);
    try {
      const platform = await extractBill(file, getToken());
      const merged = mergePlatformBill(bill, platform);
      setBill(merged);
      track("platform_summary_added", { platform: platform.meta.platform });
    } catch (e: any) {
      setError(`Couldn't read platform summary: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  function handleAddPerson(name: string) {
    if (!name.trim()) return;
    const id = `p${people.length}`;
    const color = PERSON_COLORS[people.length % PERSON_COLORS.length];
    setPeople((ps) => [...ps, { id, name: name.trim(), color }]);
  }

  function handleRemovePerson(id: string) {
    setPeople((ps) => ps.filter((p) => p.id !== id));
    setAssignments((all) => {
      const out: Record<string, Assignment[]> = {};
      for (const [k, v] of Object.entries(all)) {
        out[k] = v.filter((a) => a.person_id !== id);
      }
      return out;
    });
    // Also clear any pre-payment attributions that pointed at this person.
    setBill((b) =>
      b
        ? {
            ...b,
            discounts: b.discounts.map((d) =>
              d.paid_by_person_id === id ? { ...d, paid_by_person_id: null } : d
            ),
          }
        : b
    );
  }

  function handlePrePaymentChange(discountId: string, personId: string | null) {
    setBill((b) =>
      b
        ? {
            ...b,
            discounts: b.discounts.map((d) =>
              d.id === discountId ? { ...d, paid_by_person_id: personId } : d
            ),
          }
        : b
    );
  }

  /**
   * Bulk: assign every parent item (or every still-unassigned one) to all people
   * with equal share, OR clear all assignments back to nothing.
   *  - "all":       overwrite every item with everyone-shares
   *  - "remaining": fill in only items that have no claimants yet
   *  - "clear":     wipe every item's claimants — start over
   */
  function handleBulkAssign(mode: "all" | "remaining" | "clear") {
    if (!bill) return;
    setAssignments((current) => {
      if (mode === "clear") return {};
      if (people.length === 0) return current;
      const next: Record<string, Assignment[]> = { ...current };
      for (const s of bill.sections) {
        for (const i of s.items) {
          if (i.parent_id !== null || i.is_complimentary) continue;
          const alreadyAssigned = (next[i.id] ?? []).length > 0;
          if (mode === "remaining" && alreadyAssigned) continue;
          next[i.id] = people.map((p) => ({
            person_id: p.id,
            share: 1 / people.length,
          }));
        }
      }
      return next;
    });
  }

  function togglePersonOnItem(itemId: string, personId: string) {
    setAssignments((all) => {
      const cur = all[itemId] ?? [];
      const has = cur.some((a) => a.person_id === personId);
      const next = has
        ? cur.filter((a) => a.person_id !== personId)
        : [...cur, { person_id: personId, share: 1 }];
      // Re-balance to equal shares
      const balanced = next.length
        ? next.map((a) => ({ ...a, share: 1 / next.length }))
        : [];
      return { ...all, [itemId]: balanced };
    });
  }

  async function handleSubmitAssignments() {
    if (!bill) return;
    // Validate: every parent item must have at least one assignment
    const unassigned = parentItems.filter(
      (i) => !assignments[i.id] || assignments[i.id].length === 0
    );
    if (unassigned.length) {
      setError(`${unassigned.length} item${unassigned.length === 1 ? "" : "s"} unassigned`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await splitBill(bill, assignments, options, getToken());
      setSplit(res);
      setStage("summary");
      track("split_computed", { people: people.length, items: parentItems.length });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    setStage("upload");
    setBill(null);
    setLocalPreview(null);
    setPeople([]);
    setAssignments({});
    setOptions(DEFAULT_OPTIONS);
    setSplit(null);
    setError(null);
  }

  function handleRetake() {
    // Keep people if they've already been added (saves typing if user retakes mid-flow).
    setBill(null);
    setLocalPreview(null);
    setAssignments({});
    setSplit(null);
    setError(null);
    setStage("upload");
  }

  const canContinueReview = bill && Math.abs(bill.reconciliation.delta) <= 0.5;
  // The progress rail is noise on the entry/crop screens — show it once a bill
  // exists and the user is moving through the actual flow.
  const showStepper = stage !== "upload" && stage !== "crop";

  return (
    <div className="min-h-[100dvh] flex flex-col">
      {/* When installed as a PWA (apple-mobile-web-app-status-bar-style is
          black-translucent), the web view extends under the status bar, so we
          pad the header down by the top safe-area inset — otherwise the logo
          overlaps the clock/battery. In a normal browser this inset is 0. */}
      <header
        className="border-b border-line bg-surface/85 backdrop-blur-lg sticky top-0 z-30"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-accent text-accent-fg grid place-items-center shadow-card shrink-0">
              <Receipt className="text-xl" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display font-bold text-base sm:text-lg leading-none tracking-tight">
                BillSplit
              </h1>
              <p className="text-xs text-fg-subtle leading-tight hidden sm:block mt-0.5">
                Pay only for what you ate
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={toggleTheme}
              className="btn-ghost btn w-10 h-10 rounded-lg text-lg"
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </button>
            {bill && (
              <button onClick={handleReset} className="btn-ghost btn-sm gap-1.5">
                <RotateCcw className="text-sm" />
                <span className="hidden sm:inline">Start over</span>
              </button>
            )}

            {/* User menu (signed in) or Sign-in button (signed out) */}
            {user ? (
              <details className="relative">
                <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer">
                  <span className="block w-9 h-9 rounded-full overflow-hidden bg-surface-2 ring-1 ring-line grid place-items-center hover:ring-line-strong transition">
                    {user.picture ? (
                      <img
                        src={user.picture}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-sm font-semibold text-fg-muted">
                        {(user.name ?? user.email ?? "?")[0]?.toUpperCase()}
                      </span>
                    )}
                  </span>
                </summary>
                <div className="absolute right-0 mt-2 w-56 card shadow-pop p-2 z-40 animate-scale-in">
                  <div className="px-2 py-1.5">
                    <div className="font-medium text-sm truncate">{user.name ?? "Signed in"}</div>
                    {user.email && (
                      <div className="text-xs text-fg-subtle truncate">{user.email}</div>
                    )}
                  </div>
                  <button
                    onClick={signOut}
                    className="btn-ghost btn-sm w-full justify-start gap-2 mt-1"
                  >
                    <LogOut className="text-sm" />
                    Sign out
                  </button>
                </div>
              </details>
            ) : (
              <button onClick={() => setSignInOpen(true)} className="btn-secondary btn-sm">
                Sign in
              </button>
            )}
          </div>
        </div>

        {showStepper && (
          <div className="border-t border-line/70 bg-surface/60">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 sm:py-3">
              <Stepper current={STAGE_STEP[stage]} />
            </div>
          </div>
        )}
      </header>

      <main
        className={`
          flex-1 ${stage === "review" ? "max-w-6xl" : "max-w-4xl"} w-full mx-auto px-4 sm:px-6 py-5 sm:py-8
        `}
      >
        {error && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-2.5 rounded-xl bg-danger-soft border border-danger/30 px-4 py-3 text-sm text-danger animate-scale-in"
          >
            <AlertTriangle className="text-base mt-0.5 shrink-0" />
            <span className="min-w-0">{error}</span>
          </div>
        )}

        <div key={stage} className="animate-fade-in">
          {stage === "upload" && (
            <UploadStage onUpload={handleUpload} busy={busy} />
          )}

          {stage === "crop" && pendingPreviewUrl && pendingFile && (
            <CropStage
              imageSrc={pendingPreviewUrl}
              fileName={pendingFile.name}
              onConfirm={(cropped) => handleExtract(cropped)}
              onSkip={() => handleExtract(pendingFile)}
              onCancel={() => {
                if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
                setPendingFile(null);
                setPendingPreviewUrl(null);
                setStage("upload");
              }}
              busy={busy}
            />
          )}

          {stage === "review" && bill && (
            <ReviewStage
              bill={bill}
              onChange={setBill}
              onContinue={() => setStage("people")}
              canContinue={!!canContinueReview}
              imagePreview={imagePreview}
              onRetake={handleRetake}
              onAddPlatformSummary={handleAddPlatformSummary}
              busy={busy}
            />
          )}

          {stage === "people" && bill && (
            <PeopleStage
              bill={bill}
              people={people}
              onAdd={handleAddPerson}
              onRemove={handleRemovePerson}
              onPrePaymentChange={handlePrePaymentChange}
              onContinue={() => setStage("assign")}
              onBack={() => setStage("review")}
            />
          )}

          {stage === "assign" && bill && (
            <AssignStage
              bill={bill}
              people={people}
              assignments={assignments}
              options={options}
              onOptionsChange={setOptions}
              onToggle={togglePersonOnItem}
              onBulkAssign={handleBulkAssign}
              onContinue={handleSubmitAssignments}
              onBack={() => setStage("people")}
              busy={busy}
              unassignedCount={parentItems.filter(
                (i) => !assignments[i.id] || assignments[i.id].length === 0
              ).length}
            />
          )}

          {stage === "summary" && bill && split && (
            <SummaryStage
              bill={bill}
              people={people}
              split={split}
              onBack={() => setStage("assign")}
              onShare={() => setStage("share")}
            />
          )}

          {stage === "share" && bill && split && (
            <ShareStage
              bill={bill}
              people={people}
              split={split}
              onBack={() => setStage("summary")}
              onReset={handleReset}
            />
          )}
        </div>
      </main>

      <footer className="border-t border-line bg-bg pt-3 pb-safe text-center text-xs text-fg-subtle">
        <button
          onClick={() => setBugOpen(true)}
          className="inline-flex items-center gap-1 font-medium text-orange-500 dark:text-orange-400 hover:text-orange-600 dark:hover:text-orange-300 transition"
        >
          <Bug className="text-sm" />
          Report a bug
        </button>
        <div className="mt-1">BillSplit · INR · No data leaves this device except for OCR</div>
      </footer>

      {/* Full-screen loading overlay — mounted at root so it covers everything,
          including the sticky header. Shown whenever an extraction or split
          request is in flight. */}
      <LoadingOverlay
        show={busy && (stage === "upload" || stage === "crop" || stage === "review" || stage === "assign")}
        label={
          busyLabel
            ?? (stage === "assign" ? "Calculating split"
              : stage === "review" ? "Reading platform summary"
              : "Extracting bill")
        }
      />

      {/* Sign-in prompt — at the extraction moment (parked file) or via the
          header "Sign in" button. Auto-closes once signed in. */}
      {!user && (pendingExtractFile !== null || signInOpen) && (
        <SignInModal
          dark={theme === "dark"}
          onCancel={() => {
            setPendingExtractFile(null);
            setSignInOpen(false);
          }}
        />
      )}

      {bugOpen && (
        <BugReportModal onClose={() => setBugOpen(false)} />
      )}

      {/* "Add to Home Screen" nudge — only on the landing screen, and only for
          mobile visitors who haven't installed or dismissed it (self-gated). */}
      {stage === "upload" && <AddToHomeScreen />}
    </div>
  );
}
