import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  EyeOff,
  FileWarning,
  Loader2,
} from "lucide-react";
import {
  fetchReviewerPage,
  flushEngagement,
  getReviewerPageManifest,
  logReviewerEvent,
  type ReviewerPageManifest,
} from "../../lib/reviewer-portal-api";

/**
 * Renders a shared document as page images drawn into canvases.
 *
 * The source PDF never reaches this component — the portal only exposes
 * rendered pages. Drawing into a canvas rather than mounting an <img> means the
 * page cannot be saved via the context menu or dragged out, and the object URL
 * is revoked as soon as the bitmap is drawn so nothing in the document holds a
 * reference that reproduces it.
 */

type PageMeta = ReviewerPageManifest["pages"][number];

function PageCanvas({
  versionId,
  page,
  token,
  onTokenRejected,
  onIntersect,
}: {
  versionId: string;
  page: PageMeta;
  token: string;
  onTokenRejected: () => void;
  onIntersect: (pageNumber: number, ratio: number) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  // Tracks which token the current pixels were drawn with, so a token refresh
  // does not force an already-rendered page to be fetched again.
  const drawnTokenRef = useRef<string | null>(null);
  // Tracks whether a fetch is in flight, outside React state. Kept as a ref
  // (not the `status` state) so the effect below doesn't depend on `status`
  // and self-abort itself: setStatus("loading") would otherwise change a
  // dependency the same effect reads, causing React to tear down the
  // in-flight request it had just started before it ever resolved.
  const loadingRef = useRef(false);

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setVisible(entry.isIntersecting);
      },
      // Render a screen ahead of the scroll so pages are ready on arrival.
      { rootMargin: "150% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Separate from the prefetch observer above: that one's large rootMargin
  // marks many pages "visible" at once, which is right for prefetching but
  // wrong for "what's actually on screen" — engagement tracking needs the
  // real on-screen ratio to pick a single active page.
  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) onIntersect(page.pageNumber, entry.intersectionRatio);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      onIntersect(page.pageNumber, 0);
    };
  }, [page.pageNumber, onIntersect]);

  useEffect(() => {
    if (!visible) return;
    if (drawnTokenRef.current === token) return;
    if (loadingRef.current) return;

    const controller = new AbortController();
    let bitmap: ImageBitmap | null = null;
    loadingRef.current = true;
    setStatus("loading");

    (async () => {
      try {
        const blob = await fetchReviewerPage(
          versionId,
          page.pageNumber,
          token,
          "view",
          controller.signal,
        );
        bitmap = await createImageBitmap(blob);
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(bitmap, 0, 0);
        drawnTokenRef.current = token;
        setStatus("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        // A 403 here means the 10-minute page token aged out mid-read. Ask the
        // parent for a fresh manifest rather than surfacing an error the
        // reviewer can do nothing about.
        const responseStatus = (error as { response?: { status?: number } })?.response?.status;
        if (responseStatus === 403) {
          onTokenRejected();
          setStatus("idle");
          return;
        }
        setStatus("error");
      } finally {
        loadingRef.current = false;
        // createImageBitmap consumes the blob directly, so there is no object
        // URL to revoke — releasing the bitmap is the whole cleanup.
        bitmap?.close();
      }
    })();

    return () => {
      controller.abort();
      loadingRef.current = false;
    };
  }, [visible, token, versionId, page.pageNumber, onTokenRejected]);

  return (
    <div
      ref={wrapperRef}
      className="relative w-full overflow-hidden rounded-md border border-border bg-white shadow-sm"
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
    >
      <canvas
        ref={canvasRef}
        // Blocks "Save image as" and drag-to-desktop on the rendered page.
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
        className="h-full w-full select-none"
        aria-label={`Page ${page.pageNumber}`}
      />
      {status !== "ready" && (
        <div className="absolute inset-0 grid place-items-center bg-surface/40 text-muted-foreground">
          {status === "error" ? (
            <span className="flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4" /> Page {page.pageNumber} failed to load
            </span>
          ) : (
            <Loader2 className="h-5 w-5 animate-spin" />
          )}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white">
        {page.pageNumber}
      </div>
    </div>
  );
}

/**
 * Deterrents against copy/print/screenshot. None of these make capture
 * impossible — see the honesty table in reviewer-secure-viewer-plan.md §6 —
 * but each one is real enough to be worth the logged event it fires.
 */
function useCaptureGuards(versionId: string, screenshotGuard: boolean, allowPrint: boolean) {
  const [blanked, setBlanked] = useState(false);

  useEffect(() => {
    const blank = () => setBlanked(true);
    const unblank = () => setBlanked(false);
    const onVisibility = () => (document.hidden ? blank() : unblank());

    // Suppresses the print dialog for the keyboard path so `beforeprint`
    // (below) only fires — and only logs — for the menu/UI print path.
    // Skipped entirely when the invitation allows printing.
    const onKeyDown = (event: KeyboardEvent) => {
      if (allowPrint) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
      }
    };

    // Windows/Chromium only: PrintScreen delivers a keyup, rarely a keydown,
    // and macOS's Cmd+Shift+3/4/5 never reaches the browser at all.
    const onKeyUp = (event: KeyboardEvent) => {
      if (!screenshotGuard) return;
      if (event.key !== "PrintScreen") return;
      blank();
      window.setTimeout(unblank, 1500);
      navigator.clipboard?.writeText("").catch(() => {});
      void logReviewerEvent("screenshot_attempt", { documentVersionId: versionId });
    };

    const onBeforePrint = () => {
      if (allowPrint) return;
      blank();
      void logReviewerEvent("print_attempt", { documentVersionId: versionId });
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", unblank);
    if (screenshotGuard) {
      window.addEventListener("blur", blank);
      window.addEventListener("focus", unblank);
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", unblank);
      window.removeEventListener("blur", blank);
      window.removeEventListener("focus", unblank);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [versionId, screenshotGuard, allowPrint]);

  const blockClipboard = useCallback(
    (event: React.ClipboardEvent) => {
      if (!screenshotGuard) return;
      event.preventDefault();
      void logReviewerEvent("copy_attempt", { documentVersionId: versionId });
    },
    [versionId, screenshotGuard],
  );

  return { blanked, blockClipboard };
}

/**
 * Tracks which page is actually on screen, accumulates active-ms against it
 * while the tab is visible and focused, and flushes to the server. Paused
 * whenever the tab is hidden or unfocused so "left it open overnight" never
 * reads as engagement — that distinction is the whole point of doing this
 * server-side rather than trusting a naive "time on page" number.
 */
function useEngagementHeartbeat(versionId: string) {
  const ratiosRef = useRef<Map<number, number>>(new Map());
  const accumRef = useRef<Map<number, number>>(new Map());
  const lastTickRef = useRef(Date.now());

  const reportIntersection = useCallback((pageNumber: number, ratio: number) => {
    if (ratio > 0) ratiosRef.current.set(pageNumber, ratio);
    else ratiosRef.current.delete(pageNumber);
  }, []);

  useEffect(() => {
    const flush = () => {
      const pages = Array.from(accumRef.current.entries())
        .filter(([, activeMs]) => activeMs > 0)
        .map(([pageNumber, activeMs]) => ({ documentVersionId: versionId, pageNumber, activeMs }));
      if (pages.length > 0) flushEngagement({ pages });
      accumRef.current.clear();
    };

    const tick = () => {
      const now = Date.now();
      const elapsed = now - lastTickRef.current;
      lastTickRef.current = now;

      if (document.visibilityState !== "visible" || !document.hasFocus()) return;

      let activePage: number | null = null;
      let bestRatio = 0;
      for (const [pageNumber, ratio] of ratiosRef.current) {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          activePage = pageNumber;
        }
      }
      if (activePage === null) return;

      accumRef.current.set(activePage, (accumRef.current.get(activePage) ?? 0) + elapsed);
    };

    const onVisibilityChange = () => {
      if (document.hidden) flush();
    };

    lastTickRef.current = Date.now();
    const tickId = window.setInterval(tick, 1000);
    const flushId = window.setInterval(flush, 10_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flush);

    return () => {
      window.clearInterval(tickId);
      window.clearInterval(flushId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [versionId]);

  return { reportIntersection };
}

/**
 * Cosmetic, live, and trivially removable in devtools — that's the point.
 * It makes the reviewer *aware* they're identified; the tiled watermark
 * baked into the page pixels server-side is the layer that actually
 * survives a capture.
 */
function WatermarkOverlay({ email }: { email: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-50 rounded bg-black/60 px-2.5 py-1 text-[11px] text-white/90 shadow-sm">
      {email} · {now.toLocaleString()}
    </div>
  );
}

function getManifestErrorCode(error: unknown): string | undefined {
  return (error as { response?: { data?: { code?: string } } } | null)?.response?.data?.code;
}

export function SecureDocumentViewer({
  versionId,
  reviewerEmail,
  allowPrint,
  screenshotGuard,
}: {
  versionId: string;
  reviewerEmail: string;
  allowPrint: boolean;
  screenshotGuard: boolean;
}) {
  const manifestQuery = useQuery({
    queryKey: ["reviewer-manifest", versionId],
    queryFn: () => getReviewerPageManifest(versionId),
    // The page token inside the manifest is short-lived; refresh it before it
    // expires rather than waiting for pages to start failing. While the
    // document is still rendering server-side, poll quickly instead — a
    // reviewer who opens the link mid-render shouldn't be stuck on a stale
    // "still preparing" placeholder for up to 8 minutes.
    refetchInterval: (query) =>
      getManifestErrorCode(query.state.error) === "RENDER_PENDING" ? 5_000 : 8 * 60 * 1000,
    retry: false,
  });

  const refreshToken = useCallback(() => {
    void manifestQuery.refetch();
  }, [manifestQuery]);

  const { blanked, blockClipboard } = useCaptureGuards(versionId, screenshotGuard, allowPrint);
  const { reportIntersection } = useEngagementHeartbeat(versionId);
  const [pageIndex, setPageIndex] = useState(0);

  // A version switch (or a document swapped out from under the same
  // component instance) should always land back on page one.
  useEffect(() => {
    setPageIndex(0);
  }, [versionId]);

  if (manifestQuery.isPending) {
    return (
      <div className="grid h-64 place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (manifestQuery.isError) {
    const pending = getManifestErrorCode(manifestQuery.error) === "RENDER_PENDING";
    return (
      <div className="grid h-64 place-items-center rounded-md border border-border bg-surface/40 px-6 text-center">
        <div className="space-y-2 text-sm text-muted-foreground">
          {pending ? (
            <Clock className="mx-auto h-6 w-6" />
          ) : (
            <FileWarning className="mx-auto h-6 w-6" />
          )}
          <p className="font-medium text-foreground">
            {pending ? "This document is still being prepared" : "This document cannot be displayed"}
          </p>
          <p>
            {pending
              ? "Large documents take a moment to render. Check back shortly."
              : "Ask the sender to re-share this document."}
          </p>
        </div>
      </div>
    );
  }

  const manifest = manifestQuery.data;
  const totalPages = manifest.pages.length;
  const currentIndex = Math.min(pageIndex, totalPages - 1);
  const currentPage = manifest.pages[currentIndex];

  return (
    <div className="relative" onCopy={blockClipboard} onCut={blockClipboard}>
      {!allowPrint && (
        <style>{"@media print { .reviewer-secure-pages { display: none !important; } }"}</style>
      )}
      <div className="reviewer-secure-pages space-y-3">
        {currentPage && (
          <PageCanvas
            key={currentPage.pageNumber}
            versionId={versionId}
            page={currentPage}
            token={manifest.pageToken}
            onTokenRejected={refreshToken}
            onIntersect={reportIntersection}
          />
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
              disabled={currentIndex === 0}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-40 hover:bg-surface/60"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
            <span className="text-sm text-muted-foreground">
              Page {currentIndex + 1} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPageIndex((index) => Math.min(totalPages - 1, index + 1))}
              disabled={currentIndex === totalPages - 1}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-40 hover:bg-surface/60"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      {blanked && (
        <div className="absolute inset-0 z-40 grid place-items-center rounded-md bg-background/95 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <EyeOff className="h-6 w-6" />
            <span>Content hidden</span>
          </div>
        </div>
      )}
      <WatermarkOverlay email={reviewerEmail} />
    </div>
  );
}
