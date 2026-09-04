import * as React from "react";

import { cn } from "../../lib/utils";

type ImageStatus = "idle" | "loading" | "loaded" | "error";

interface AvatarContextValue {
  status: ImageStatus;
  setStatus: (status: ImageStatus) => void;
}

// AvatarImage and AvatarFallback are siblings in the DOM, so the fallback has no
// way of knowing whether the image loaded. The parent owns that state and each
// child renders only when it is the one that should be visible otherwise a
// consumer using both gets a squashed image sitting next to its own fallback.
const AvatarContext = React.createContext<AvatarContextValue | null>(null);

function useAvatarContext(component: string): AvatarContextValue {
  const context = React.useContext(AvatarContext);
  if (!context) {
    throw new Error(`<${component} /> must be rendered inside an <Avatar />`);
  }
  return context;
}

const Avatar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const [status, setStatus] = React.useState<ImageStatus>("idle");
    const value = React.useMemo(() => ({ status, setStatus }), [status]);

    return (
      <AvatarContext.Provider value={value}>
        <div
          ref={ref}
          className={cn("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full", className)}
          {...props}
        />
      </AvatarContext.Provider>
    );
  },
);
Avatar.displayName = "Avatar";

// A third-party avatar URL (e.g. Google's `picture` claim) competes with the
// page's own initial-load burst and can drop a request that would have
// succeeded a moment later. One retry (a fresh <img> via `key`, since a
// browser won't re-fire load/error for an unchanged src on the same node)
// absorbs that instead of getting stuck on the initials fallback for the
// rest of the session.
const MAX_LOAD_ATTEMPTS = 2;

const AvatarImage = React.forwardRef<HTMLImageElement, React.ImgHTMLAttributes<HTMLImageElement>>(
  ({ className, src, onLoad, onError, ...props }, ref) => {
    const { status, setStatus } = useAvatarContext("AvatarImage");
    const attemptsRef = React.useRef(0);
    const [retryKey, setRetryKey] = React.useState(0);

    React.useEffect(() => {
      attemptsRef.current = 0;
      setRetryKey(0);
      setStatus(src ? "loading" : "error");
    }, [src, setStatus]);

    // Keep it mounted while loading so the load/error events can still fire.
    if (!src || status === "error") return null;

    return (
      <img
        key={retryKey}
        ref={ref}
        src={src}
        className={cn(
          "aspect-square h-full w-full",
          status === "loaded" ? undefined : "invisible",
          className,
        )}
        onLoad={(event) => {
          setStatus("loaded");
          onLoad?.(event);
        }}
        onError={(event) => {
          attemptsRef.current += 1;
          if (attemptsRef.current < MAX_LOAD_ATTEMPTS) {
            setRetryKey((key) => key + 1);
            return;
          }
          setStatus("error");
          onError?.(event);
        }}
        {...props}
      />
    );
  },
);
AvatarImage.displayName = "AvatarImage";

const AvatarFallback = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { status } = useAvatarContext("AvatarFallback");

    if (status === "loaded") return null;

    return (
      <div
        ref={ref}
        className={cn(
          "absolute inset-0 flex h-full w-full items-center justify-center rounded-full bg-muted",
          className,
        )}
        {...props}
      />
    );
  },
);
AvatarFallback.displayName = "AvatarFallback";

export { Avatar, AvatarImage, AvatarFallback };
