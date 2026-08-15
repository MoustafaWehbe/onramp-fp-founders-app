import { useEffect, useRef, useState } from "react";
import { subscribeTyping } from "../lib/typing-bus";

/** How long a ping keeps someone listed as typing after their last one. */
const TYPING_TIMEOUT_MS = 4000;

/** Names currently typing in one conversation, expiring a few seconds after each ping stops arriving. */
export function useTypingUsers(conversationId: string): string[] {
  const [typing, setTyping] = useState<Map<string, { name: string; expiresAt: number }>>(new Map());
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  useEffect(() => {
    // Switching rooms must not keep showing a typing line for the old one.
    setTyping(new Map());

    return subscribeTyping((event) => {
      if (event.conversationId !== conversationIdRef.current) return;
      setTyping((prev) => {
        const next = new Map(prev);
        next.set(event.memberId, { name: event.memberName, expiresAt: Date.now() + TYPING_TIMEOUT_MS });
        return next;
      });
    });
  }, [conversationId]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        if (![...prev.values()].some((v) => v.expiresAt <= now)) return prev;
        const next = new Map(prev);
        for (const [memberId, v] of prev) {
          if (v.expiresAt <= now) next.delete(memberId);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return [...typing.values()].map((v) => v.name);
}
