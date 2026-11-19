"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { Minus, Plus } from "lucide-react";
import { ScrollArea } from "@/components/overlay-scrollbar";
import { Skeleton } from "@/components/ui/skeleton";
import { ResumePagePlaceholder } from "@/components/resume-review/page-placeholder";
import { cn } from "@/lib/utils";

// react-pdf requires the worker to be set in the module that renders it.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

// Served from public/pdfjs (scripts/copy-pdfjs-assets.mjs).
const PDF_OPTIONS = {
  cMapUrl: "/pdfjs/cmaps/",
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  iccUrl: "/pdfjs/iccs/",
};

const MAX_FIT_WIDTH = 816; // US Letter at 96dpi
const PAGE_GUTTER = 32;
const LETTER_RATIO = 11 / 8.5;
const ZOOM_STEPS = [0.75, 1, 1.25, 1.5, 2, 2.5];

function PagePlaceholder({ width }: { width: number }) {
  return <Skeleton className="rounded-none" style={{ width, height: width * LETTER_RATIO }} />;
}

export function PdfPane({
  blob,
  renderPageOverlay,
  onFailed,
}: {
  blob: Blob;
  renderPageOverlay?: (page: number) => ReactNode;
  onFailed: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [fitWidth, setFitWidth] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(1);
  // The pages stay invisible until page 1 is painted, then fade in over the
  // placeholder, so loading shows one steady shape instead of a skeleton, a
  // blank white sheet and then the resume.
  const [painted, setPainted] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => setFitWidth(Math.min(viewport.clientWidth - PAGE_GUTTER, MAX_FIT_WIDTH));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const zoom = ZOOM_STEPS[zoomIndex];
  const width = Math.max(1, Math.round(fitWidth * zoom));

  return (
    <div className="relative h-full min-h-0 bg-foreground/[0.04]">
      {/* Behind the scroll area, and gone once the pages have faded in, so it
          never shows through while scrolling or zooming. */}
      {!settled && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <ResumePagePlaceholder />
        </div>
      )}
      <ScrollArea ref={viewportRef} orientation="both" className="h-full">
        {fitWidth > 0 && (
          <div
            className={cn("transition-opacity duration-2 ease-out-quart", painted ? "opacity-100" : "opacity-0")}
            onTransitionEnd={(e) => { if (e.target === e.currentTarget) setSettled(true); }}
          >
          {/* suspense={false}: react-pdf 11 suspends by default, and with no
              boundary of ours React hid the whole route, modal included, on
              every load step. That was the flicker on open. */}
          <Document
            file={blob}
            options={PDF_OPTIONS}
            suspense={false}
            loading={null}
            error={null}
            noData={null}
            onLoadSuccess={({ numPages }) => setPageCount(numPages)}
            onLoadError={onFailed}
            onSourceError={onFailed}
            onPassword={onFailed}
            className="flex w-max min-w-full flex-col items-center gap-4 p-4 pb-16"
          >
            {Array.from({ length: pageCount }, (_, i) => (
              <Page
                key={i + 1}
                pageNumber={i + 1}
                width={width}
                suspense={false}
                renderAnnotationLayer={false}
                renderTextLayer
                loading={<PagePlaceholder width={width} />}
                error={null}
                onRenderSuccess={i === 0 ? () => setPainted(true) : undefined}
                onRenderError={i === 0 ? onFailed : undefined}
                className="relative bg-white shadow-overlay"
              >
                {renderPageOverlay?.(i + 1)}
              </Page>
            ))}
          </Document>
          </div>
        )}
      </ScrollArea>

      <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border glass-strong p-0.5 shadow-overlay">
        <button
          type="button"
          aria-label="Zoom out"
          disabled={zoomIndex === 0}
          onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-foreground/[0.08] disabled:opacity-40"
        >
          <Minus size={14} />
        </button>
        <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={zoomIndex === ZOOM_STEPS.length - 1}
          onClick={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-foreground/[0.08] disabled:opacity-40"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
