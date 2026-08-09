import { useState } from "react";
import { Outlet } from "react-router-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Header } from "../components/layout/Header";
import { Sidebar } from "../components/layout/Sidebar";
import { useNotificationStream } from "../hooks/useNotificationStream";

export function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // One connection for the whole signed-in app, held for as long as the shell
  // is mounted.
  useNotificationStream();

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <Sidebar className="fixed inset-y-0 left-0 z-40 hidden lg:flex" />

      {/* Radix supplies the modal semantics a hand-rolled overlay was missing:
          role="dialog", aria-modal, focus trap and restore, Escape to dismiss,
          inert background content, and body scroll lock. */}
      <DialogPrimitive.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm lg:hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex h-full w-[min(18rem,88vw)] shadow-2xl duration-200 lg:hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left"
          >
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <Sidebar
              className="flex h-full w-full"
              onNavigate={() => setMobileNavOpen(false)}
              onClose={() => setMobileNavOpen(false)}
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="lg:pl-64">
        <Header onMenuClick={() => setMobileNavOpen(true)} />
        <main className="min-h-[calc(100vh-3.5rem)] px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
