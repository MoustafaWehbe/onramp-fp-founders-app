import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { Button } from "../../components/ui/button";
import { SiteFooter, SiteHeader } from "../../components/layout/SiteHeaderFooter";

const TIERS = [
  { name: "Solo", price: "$0", desc: "For founders getting started.", cta: "Start free", features: ["1 startup workspace", "Up to 25 investors", "Basic pipeline", "1 data room document", "Community support"] },
  { name: "Team", price: "$49", suffix: "/mo", desc: "For founders raising a round.", cta: "Start 14-day trial", featured: true, features: ["Unlimited investors", "Full CRM + pipeline", "Unlimited data room + versioning", "AI deck analysis (10 / mo)", "Reviewer portal", "Up to 5 teammates"] },
  { name: "Growth", price: "$149", suffix: "/mo", desc: "For teams closing multi-round raises.", cta: "Contact sales", features: ["Everything in Team", "Unlimited AI analysis", "SSO + audit log", "Custom roles", "Priority support", "Unlimited teammates"] },
];

export default function PricingPage() {
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
          ".pricing-hero",
          { y: 24, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.8, ease: "power3.out" }
        );

        gsap.fromTo(
          ".pricing-card",
          { y: 30, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.8,
            stagger: 0.12,
            ease: "power3.out",
            delay: 0.12,
            scrollTrigger: {
              trigger: ".pricing-card",
              start: "top 90%",
              toggleActions: "play none none none",
            },
          }
        );
      }
    })();
  }, []);
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <section className="border-b border-border py-20">
        <div className="mx-auto max-w-3xl px-6">
          <p className="text-sm font-medium uppercase tracking-[0.32em] text-primary"> pricing</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">Simple pricing, built for founders</h1>
          <p className="mt-4 text-muted-foreground">Start free. Upgrade when you have real investor momentum. Cancel anytime.</p>
        </div>
      </section>

      <section className="border-b border-border py-16">
        <div className="mx-auto grid max-w-6xl gap-6 px-6 md:grid-cols-3">
          {TIERS.map((t) => (
            <div key={t.name} className={`pricing-card reveal relative rounded-xl border p-8 ${t.featured ? "border-primary/50 bg-surface glow-orange" : "border-border bg-surface"}`}>
              {t.featured && <div className="absolute -top-3 left-6 rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">Most popular</div>}
              <h3 className="font-display text-lg font-semibold">{t.name}</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="font-display text-4xl font-semibold">{t.price}</span>
                {t.suffix && <span className="text-sm text-muted-foreground">{t.suffix}</span>}
              </div>
              <p className="mt-2 text-sm text-muted-foreground text-left">{t.desc}</p>
              <Button asChild className="mt-6 w-full" variant={t.featured ? "default" : "outline"}>
                <Link to="/auth/register">{t.cta}</Link>
              </Button>
              <ul className="mt-8 space-y-3 text-sm">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 flex-none text-primary" /><span>{f}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
