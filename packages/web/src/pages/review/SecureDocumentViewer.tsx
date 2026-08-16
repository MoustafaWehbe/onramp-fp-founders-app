import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Clock, FileWarning, Loader2 } from "lucide-react";
import {
  fetchReviewerPage,
  getReviewerPageManifest,
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
}: {
  versionId: string;
  page: PageMeta;
  token: string;
  onTokenRejected: () => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  // Tracks which token the current pixels were drawn with, so a token refresh
  // does not force an already-rendered page to be fetched again.
  const drawnTokenRef = useRef<string | null>(null);

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

  useEffect(() => {
    if (!visible) return;
    if (drawnTokenRef.current === token && status === "ready") return;
    if (status === "loading") return;

    const controller = new AbortController();
    let bitmap: ImageBitmap | null = null;

    (async () => {
      setStatus("loading");
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
        // createImageBitmap consumes the blob directly, so there is no object
        // URL to revoke — releasing the bitmap is the whole cleanup.
        bitmap?.close();
      }
    })();

    return () => controller.abort();
  }, [visible, token, versionId, page.pageNumber, status, onTokenRejected]);

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

export function SecureDocumentViewer({ versionId }: { versionId: string }) {
  const manifestQuery = useQuery({
    queryKey: ["reviewer-manifest", versionId],
    queryFn: () => getReviewerPageManifest(versionId),
    // The page token inside the manifest is short-lived; refresh it before it
    // expires rather than waiting for pages to start failing.
    refetchInterval: 8 * 60 * 1000,
    retry: false,
  });

  const refreshToken = useCallback(() => {
    void manifestQuery.refetch();
  }, [manifestQuery]);

  if (manifestQuery.isPending) {
    return (
      <div className="grid h-64 place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (manifestQuery.isError) {
    const code = (manifestQuery.error as { response?: { data?: { code?: string } } })?.response
      ?.data?.code;
    const pending = code === "RENDER_PENDING";
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

  return (
    <div className="space-y-3">
      {manifest.pages.map((page) => (
        <PageCanvas
          key={page.pageNumber}
          versionId={versionId}
          page={page}
          token={manifest.pageToken}
          onTokenRejected={refreshToken}
        />
      ))}
    </div>
  );
}
