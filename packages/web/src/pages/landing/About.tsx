import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { SiteFooter, SiteHeader } from "../../components/layout/SiteHeaderFooter";

export function AboutPage() {
  useEffect(() => {
    (async () => {
      const AOSModule = await import("aos");
      const AOS = AOSModule && (AOSModule.default || AOSModule);
      await import("aos/dist/aos.css");

      const gsapModule = await import("gsap");
      const gsap = gsapModule && (gsapModule.gsap || gsapModule.default || gsapModule);
      const scrollTriggerModule = await import("gsap/ScrollTrigger");
      const ScrollTrigger = scrollTriggerModule && (scrollTriggerModule.ScrollTrigger || scrollTriggerModule.default);

      if (gsap && ScrollTrigger) gsap.registerPlugin(ScrollTrigger);
      if (AOS && typeof AOS.refresh === "function") AOS.refresh();

      if (gsap) {
        gsap.fromTo(
          ".about-hero",
          { y: 24, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.8, ease: "power3.out" }
        );

        gsap.fromTo(
          ".about-card",
          { y: 24, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.75,
            stagger: 0.1,
            ease: "power3.out",
            delay: 0.15,
          }
        );
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <section className="border-b border-border bg-background py-20">
        <div className="mx-auto max-w-5xl flex flex-col gap-8 px-6">
          <div className="about-hero max-w-3xl">
            <p className="text-sm font-medium uppercase tracking-[0.32em] text-primary">About Raise</p>
            <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">Built for founders who want their fundraising process to feel calm, fast, and measurable.</h1>
            <p className="mt-4 text-lg text-muted-foreground">Raise brings investor tracking, document sharing, and AI-powered guidance into one workstation so your team can spend less time managing chaos and more time building momentum.</p>
          </div>

          <div className="rounded-xl border border-border bg-surface p-8">
          <h2 className="font-display text-2xl font-semibold">Why founders choose Raise</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="about-card rounded-lg border border-border bg-background p-5">
              <h3 className="font-semibold">Fewer tools</h3>
              <p className="mt-2 text-sm text-muted-foreground">Replace scattered spreadsheets and documents with one dedicated workspace.</p>
            </div>
            <div className="about-card rounded-lg border border-border bg-background p-5">
              <h3 className="font-semibold">Clearer execution</h3>
              <p className="mt-2 text-sm text-muted-foreground">Move investors through a defined process with real visibility and fast follow-up.</p>
            </div>
            <div className="about-card rounded-lg border border-border bg-background p-5">
              <h3 className="font-semibold">Smarter feedback</h3>
              <p className="mt-2 text-sm text-muted-foreground">Use AI to challenge your story, tighten your pitch, and spot weak points earlier.</p>
            </div>
            <div className="about-card rounded-lg border border-border bg-background p-5">
              <h3 className="font-semibold">Built for trust</h3>
              <p className="mt-2 text-sm text-muted-foreground">Secure access controls, reviewer links, and process logging keep your data organized.</p>
            </div>
          </div>
          <Button asChild className="mt-8">
            <Link to="/auth/register">Join the waitlist</Link>
          </Button>
        </div>
      </div>
      </section>
      <SiteFooter />
    </div>
  );
}

export default AboutPage;
