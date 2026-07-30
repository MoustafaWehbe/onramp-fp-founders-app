import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Header } from "../components/layout/Header";
import { Sidebar } from "../components/layout/Sidebar";

export function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileNavOpen]);

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <Sidebar
        className="fixed inset-y-0 left-0 z-40 hidden lg:flex"
      />

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
          />
          <Sidebar
            className="relative z-10 flex h-full w-[min(18rem,88vw)] shadow-2xl"
            onNavigate={() => setMobileNavOpen(false)}
            onClose={() => setMobileNavOpen(false)}
          />
        </div>
      )}

      <div className="lg:pl-64">
        <Header onMenuClick={() => setMobileNavOpen(true)} />
        <main className="min-h-[calc(100vh-3.5rem)] px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
