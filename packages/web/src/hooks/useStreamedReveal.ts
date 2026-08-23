import { useEffect, useRef, useState } from "react";

const BASE_CHARS_PER_SECOND = 55;
const MAX_CATCHUP_MS = 900;

/**
 * Reveals `fullText` gradually instead of snapping to each raw SSE delta, so
 * streamed answers read like a smooth typewriter instead of jumpy bursts.
 * Only animates messages that were live-streamed in this session — a message
 * loaded already-completed from history renders instantly, no animation.
 */
export function useStreamedReveal(fullText: string, isStreaming: boolean): string {
  const [revealed, setRevealed] = useState(() => (isStreaming ? 0 : fullText.length));
  const revealedRef = useRef(revealed);
  const startedRef = useRef(isStreaming);
  const rafRef = useRef<number | undefined>(undefined);
  const lastTsRef = useRef<number | null>(null);

  useEffect(() => {
    revealedRef.current = revealed;
  }, [revealed]);

  useEffect(() => {
    if (isStreaming) startedRef.current = true;
  }, [isStreaming]);

  useEffect(() => {
    if (!startedRef.current) {
      setRevealed(fullText.length);
      return;
    }
    if (revealedRef.current >= fullText.length) return;

    function tick(ts: number) {
      const last = lastTsRef.current ?? ts;
      const dt = ts - last;
      lastTsRef.current = ts;
      const backlog = fullText.length - revealedRef.current;
      if (backlog <= 0) {
        lastTsRef.current = null;
        return;
      }
      // Speed scales with backlog so a big burst still catches up quickly,
      // while small steady deltas keep a deliberate, readable typing pace.
      const speed = Math.max(BASE_CHARS_PER_SECOND, backlog / (MAX_CATCHUP_MS / 1000));
      const next = Math.min(fullText.length, revealedRef.current + Math.ceil((speed * dt) / 1000));
      revealedRef.current = next;
      setRevealed(next);
      if (next < fullText.length) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        lastTsRef.current = null;
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = null;
    };
  }, [fullText]);

  return fullText.slice(0, revealed);
}
