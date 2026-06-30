import { useRef, useState } from "react";
import { Camera, FileText, Upload, Scissors, Users, Sparkles } from "./icons";

// iOS file inputs default to showing Photo Library / Take Photo / Choose Files
// even with capture="environment". The user wants the iOS path locked to the
// camera only — no gallery — to enforce shoot-the-bill-now behavior.
const isIOS =
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as Mac, distinguish with touch support
    (navigator.userAgent.includes("Mac") && "ontouchend" in document));

const STEPS_HINT = [
  { icon: Camera, label: "Snap the bill" },
  { icon: Scissors, label: "Tweak items" },
  { icon: Users, label: "Add people" },
  { icon: Sparkles, label: "Get the split" },
];

export function UploadStage({
  onUpload,
  busy,
}: {
  onUpload: (file: File) => void;
  busy: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    onUpload(files[0]);
  }

  return (
    <div className="py-1 sm:py-6">
      <div className="max-w-xl mx-auto text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft text-accent px-3 py-1 text-xs font-medium mb-4">
          <Sparkles className="text-sm" />
          Fair splits in seconds
        </div>

        <h2 className="font-display text-[1.7rem] leading-tight sm:text-4xl font-bold tracking-tight mb-2.5 text-balance">
          {isIOS ? "Add a bill" : "Upload a restaurant bill"}
        </h2>
        <p className="text-fg-muted text-sm sm:text-base mb-6 leading-relaxed max-w-md mx-auto">
          We read the items and split them per person — alcohol VAT only on the
          drinkers, food GST only on those who ate.
        </p>

        {isIOS ? (
          /* Mobile: camera-first, gallery as fallback. */
          <div className="space-y-3 text-left">
            <label
              className={`group relative flex flex-col items-center justify-center text-center
                rounded-2xl bg-accent text-accent-fg px-6 py-8 shadow-card-lg cursor-pointer
                transition-all duration-150 active:scale-[0.99]
                ${busy ? "opacity-60 pointer-events-none" : "hover:bg-accent-hover"}`}
            >
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => handleFiles(e.target.files)}
                disabled={busy}
              />
              <Camera className="text-4xl mb-2" />
              {busy ? (
                <>
                  <div className="font-semibold text-lg">Reading the bill…</div>
                  <div className="text-sm opacity-80 mt-1">Usually 5–10 seconds.</div>
                </>
              ) : (
                <>
                  <div className="font-semibold text-lg">Take a photo</div>
                  <div className="text-sm opacity-80 mt-1">
                    Hold steady and frame the whole receipt
                  </div>
                </>
              )}
            </label>

            <label
              className={`flex items-center justify-center gap-2 w-full px-4 py-3.5 rounded-xl
                border border-line bg-surface text-fg font-medium cursor-pointer
                transition-colors duration-150
                ${busy ? "opacity-60 pointer-events-none" : "hover:bg-surface-2 hover:border-line-strong"}`}
            >
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => handleFiles(e.target.files)}
                disabled={busy}
              />
              <Upload className="text-base" />
              Upload from gallery
            </label>
          </div>
        ) : (
          /* Desktop: drag-and-drop zone. */
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={`group relative flex flex-col items-center justify-center
              cursor-pointer rounded-2xl border-2 border-dashed p-8 sm:p-14
              transition-all duration-150
              ${busy ? "opacity-60 pointer-events-none" : ""}
              ${
                dragOver
                  ? "border-accent bg-accent-soft scale-[1.01]"
                  : "border-line-strong bg-surface hover:border-accent hover:bg-accent-soft/40"
              }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => handleFiles(e.target.files)}
              disabled={busy}
            />
            <div
              className={`grid place-items-center w-16 h-16 rounded-2xl mb-4 transition-colors
                ${dragOver ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-muted group-hover:text-accent"}`}
            >
              <FileText className="text-3xl" />
            </div>
            {busy ? (
              <>
                <div className="font-semibold text-fg text-lg">Reading the bill…</div>
                <div className="text-sm text-fg-subtle mt-1">Usually 5–10 seconds.</div>
              </>
            ) : (
              <>
                <div className="font-semibold text-fg text-lg">
                  Drop a photo here, or click to choose
                </div>
                <div className="text-sm text-fg-subtle mt-1">
                  JPEG, PNG, or HEIC · up to ~2 MB works best
                </div>
              </>
            )}
          </label>
        )}

        {/* How-it-works mini rail */}
        <ol className="mt-6 grid grid-cols-4 gap-2">
          {STEPS_HINT.map(({ icon: Ico, label }, i) => (
            <li key={label} className="flex flex-col items-center gap-1.5 text-center">
              <span className="grid place-items-center w-9 h-9 rounded-lg bg-surface-2 text-fg-muted">
                <Ico className="text-base" />
              </span>
              <span className="text-[11px] leading-tight text-fg-subtle">{label}</span>
              {i < STEPS_HINT.length - 1 && <span className="sr-only">then</span>}
            </li>
          ))}
        </ol>

        <p className="mt-5 text-xs text-fg-subtle">
          Indian dine-in, takeaway, Swiggy &amp; Zomato bills are all supported.
        </p>
      </div>
    </div>
  );
}
