import { Outlet } from "react-router-dom";
import { Link } from "react-router-dom";

export function AuthLayout() {
  return (
    <div className="min-h-screen bg-background grid lg:grid-cols-2">
      {/* Left sidebar - hidden on mobile */}
      <div className="hidden lg:flex flex-col justify-between border-r border-border bg-surface p-10 relative overflow-hidden">
        {/* Grid background */}
        <div className="absolute inset-0 grid-bg opacity-30" />
        
        {/* Glow effect */}
        <div className="absolute top-1/3 left-1/2 h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-primary/20 blur-[100px]" />
        
        {/* Logo */}
        <div className="relative">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-primary text-primary-foreground font-bold text-sm">R</div>
            <span className="font-bold text-xl">Raise</span>
          </Link>
        </div>
        
        {/* Testimonial */}
        <div className="relative">
          <blockquote className="text-2xl leading-snug font-medium">
            "We closed our seed 40% faster with Raise. The pipeline forecast alone was worth the switch."
          </blockquote>
          <div className="mt-4 text-sm text-muted-foreground">Priya S., founder of Kestrel Analytics</div>
        </div>
        
        {/* Footer */}
        <div className="relative text-xs text-muted-foreground">© 2026 Raise · SOC 2 ready</div>
      </div>

      {/* Right side - form container */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
