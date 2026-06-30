import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactCrop, { type Crop, centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { ArrowLeft, ArrowRight, Crop as CropIcon, RotateCcw, RotateCw, X } from "./icons";

/**
 * Crop the uploaded photo to just the bill area before sending to extraction.
 *
 * Presented as a FULLSCREEN modal (fixed inset-0) so the image gets the entire
 * screen — none of it is lost to the app header, footer, stepper, or page
 * padding. The body is a flex column: a slim top bar, a flex-1 image area, and
 * a bottom action bar. Because the image area is a flex column with a definite
 * height, ReactCrop (flex-1) also gets a definite height, which lets the image's
 * `max-height: 100%` actually resolve — so the WHOLE receipt is visible the
 * instant it loads, letterboxed to fit (see the .ReactCrop overrides in
 * index.css). Heights use dvh-derived flex sizing, so iOS Safari's collapsing
 * chrome never clips the action bar.
 */
export function CropStage({
  imageSrc,
  fileName,
  onConfirm,
  onSkip,
  onCancel,
  busy,
}: {
  imageSrc: string;
  fileName: string;
  onConfirm: (file: File) => void;
  onSkip: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop | undefined>();
  const [imageLoaded, setImageLoaded] = useState(false);

  // Rotation support. Phones are often turned sideways to shoot a long receipt,
  // so the bill ends up rotated within an upright photo (no EXIF tag to fix it).
  // We rotate the *pixels* of the original into a fresh source that ReactCrop
  // sees as a normal upright image — so the crop selection always aligns and the
  // exported crop is already correctly oriented.
  const [rotation, setRotation] = useState(0); // 0 | 90 | 180 | 270 (clockwise)
  const [displaySrc, setDisplaySrc] = useState(imageSrc);
  const blobUrlRef = useRef<string | null>(null);

  const rotateBy = (delta: number) =>
    setRotation((r) => (((r + delta) % 360) + 360) % 360);

  // Regenerate the displayed (rotated) source whenever the rotation changes.
  // Always rotates the *original* by the cumulative angle — no compounding
  // quality loss from repeated 90° turns.
  useEffect(() => {
    if (rotation === 0) {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      setDisplaySrc(imageSrc);
      return;
    }
    let cancelled = false;
    setImageLoaded(false);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const swap = rotation === 90 || rotation === 270;
      const canvas = document.createElement("canvas");
      canvas.width = swap ? img.naturalHeight : img.naturalWidth;
      canvas.height = swap ? img.naturalWidth : img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      canvas.toBlob(
        (blob) => {
          if (cancelled || !blob) return;
          if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
          const url = URL.createObjectURL(blob);
          blobUrlRef.current = url;
          setDisplaySrc(url);
        },
        "image/jpeg",
        0.92
      );
    };
    img.src = imageSrc;
    return () => {
      cancelled = true;
    };
  }, [rotation, imageSrc]);

  // Revoke any rotated blob URL on unmount.
  useEffect(
    () => () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    },
    []
  );

  // Lock background scroll + wire Escape-to-cancel while the modal is open.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [busy, onCancel]);

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    const initial = centerCrop(
      makeAspectCrop(
        { unit: "%", width: 90 },
        naturalWidth / naturalHeight,
        naturalWidth,
        naturalHeight
      ),
      naturalWidth,
      naturalHeight
    );
    setCrop(initial);
    setImageLoaded(true);
  }

  // "Use full photo" — skip cropping. If the user rotated, we must bake the
  // rotation in (the parent's onSkip uses the untouched original file), so we
  // export the full rotated image instead.
  function handleUseFullPhoto() {
    if (rotation === 0 || !imgRef.current) {
      onSkip();
      return;
    }
    const image = imgRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      onSkip();
      return;
    }
    ctx.drawImage(image, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          onSkip();
          return;
        }
        onConfirm(
          new File([blob], `rotated-${fileName.replace(/\.[^.]+$/, "")}.jpg`, {
            type: "image/jpeg",
          })
        );
      },
      "image/jpeg",
      0.92
    );
  }

  function handleConfirm() {
    if (!imgRef.current || !crop || !crop.width || !crop.height) {
      onSkip();
      return;
    }
    const image = imgRef.current;
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;

    const cropPx = crop.unit === "%"
      ? {
          x: (crop.x * image.width) / 100,
          y: (crop.y * image.height) / 100,
          width: (crop.width * image.width) / 100,
          height: (crop.height * image.height) / 100,
        }
      : { x: crop.x, y: crop.y, width: crop.width, height: crop.height };

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cropPx.width * scaleX);
    canvas.height = Math.round(cropPx.height * scaleY);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      onSkip();
      return;
    }
    ctx.drawImage(
      image,
      cropPx.x * scaleX,
      cropPx.y * scaleY,
      cropPx.width * scaleX,
      cropPx.height * scaleY,
      0,
      0,
      canvas.width,
      canvas.height
    );
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          onSkip();
          return;
        }
        const cropped = new File([blob], `cropped-${fileName.replace(/\.[^.]+$/, "")}.jpg`, {
          type: "image/jpeg",
        });
        onConfirm(cropped);
      },
      "image/jpeg",
      0.92
    );
  }

  // Render through a portal to <body> so the modal escapes the app's animated
  // stage wrapper — an opacity animation there creates a stacking context that
  // would otherwise trap this fixed overlay beneath the sticky header.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crop the bill"
      className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white animate-fade-in"
    >
      {/* Top bar */}
      <div
        className="flex-shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-white/10"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0px))" }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-accent text-accent-fg shrink-0">
            <CropIcon className="text-lg" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display font-bold text-base sm:text-lg leading-tight">
              Crop to the bill
            </h2>
            <p className="text-xs text-white/55 leading-tight hidden sm:block">
              Drag the corners so only the receipt is selected
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => rotateBy(-90)}
            disabled={busy || !imageLoaded}
            aria-label="Rotate left"
            title="Rotate left"
            className="grid place-items-center w-10 h-10 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition disabled:opacity-40"
          >
            <RotateCcw className="text-lg" />
          </button>
          <button
            onClick={() => rotateBy(90)}
            disabled={busy || !imageLoaded}
            aria-label="Rotate right"
            title="Rotate right"
            className="grid place-items-center w-10 h-10 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition disabled:opacity-40"
          >
            <RotateCw className="text-lg" />
          </button>
          <span className="w-px h-5 bg-white/15 mx-0.5" aria-hidden />
          <button
            onClick={onCancel}
            disabled={busy}
            aria-label="Close and choose a different photo"
            className="grid place-items-center w-10 h-10 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition disabled:opacity-50"
          >
            <X className="text-xl" />
          </button>
        </div>
      </div>

      {/* Mobile-only instruction (top bar hides the subtitle below sm) */}
      <p className="sm:hidden text-center text-xs text-white/55 px-4 pt-2 flex-shrink-0">
        Drag the corners so only the receipt is selected.
      </p>

      {/* Image area — centers ReactCrop, which shrink-wraps the image so the
          crop overlay stays aligned. The image is constrained via max-height on
          ReactCrop (inherited down to the <img>), letterboxing tall receipts to
          fit while keeping the whole bill visible. The max-height subtracts the
          modal chrome (top bar + instruction + bottom bar + safe areas). */}
      <div className="flex-1 min-h-0 w-full flex items-center justify-center p-3 sm:p-6 overflow-hidden">
        <ReactCrop
          crop={crop}
          onChange={(_pixel, percent) => setCrop(percent)}
          minWidth={20}
          minHeight={20}
          ruleOfThirds
          keepSelection
          style={{
            maxWidth: "100%",
            maxHeight:
              "calc(100dvh - 200px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))",
          }}
        >
          <img
            ref={imgRef}
            src={displaySrc}
            onLoad={onImageLoad}
            alt="bill to crop"
            className="block"
          />
        </ReactCrop>
        {!imageLoaded && (
          <div className="absolute text-center text-sm text-white/55">Loading image…</div>
        )}
      </div>

      {/* Bottom action bar */}
      <div
        className="flex-shrink-0 grid grid-cols-1 sm:grid-cols-[auto,1fr,auto] gap-2 items-center px-4 sm:px-6 py-3 border-t border-white/10"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <button
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/10 transition order-3 sm:order-1 justify-self-start disabled:opacity-50"
        >
          <ArrowLeft className="text-sm" />
          Choose different photo
        </button>
        <div className="hidden sm:block" />
        <div className="flex flex-col-reverse sm:flex-row gap-2 order-1 sm:order-3">
          <button
            onClick={handleUseFullPhoto}
            disabled={busy}
            className="inline-flex items-center justify-center px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium bg-white/10 text-white border border-white/20 hover:bg-white/20 transition disabled:opacity-50"
          >
            Use full photo
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy || !imageLoaded}
            className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 min-h-[44px] rounded-lg text-sm font-semibold bg-accent text-accent-fg hover:bg-accent-hover transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
          >
            {busy ? "Extracting…" : "Extract this region"}
            {!busy && <ArrowRight className="text-sm" />}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
