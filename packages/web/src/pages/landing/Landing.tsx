import {
  ArrowRight,
  Check,
  FileText,
  LineChart,
  Shield,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { SiteFooter, SiteHeader } from "../../components/layout/SiteHeaderFooter";

const FEATURES = [
  {
    icon: Users,
    title: "Investor CRM",
    body: "8,000+ investor records, notes, ownership, and rich history searchable and shareable across your team.",
  },
  {
    icon: LineChart,
    title: "Deal Pipeline",
    body: "Kanban stages from prospect to wired. Weighted forecasts, next steps, and follow-up reminders.",
  },
  {
    icon: FileText,
    title: "Data Room",
    body: "Versioned documents, watermarking, chunk-level comments, and reviewer access with verification codes.",
  },
  {
    icon: Sparkles,
    title: "AI Deck Analysis",
    body: "Scores your deck across narrative, market, and financials. Simulates investor personas asking hard questions.",
  },
  {
    icon: Shield,
    title: "Role-based Access",
    body: "Owner, Admin, Editor, Viewer. Per-startup roles with fine-grained permissions and audit log.",
  },
  {
    icon: Zap,
    title: "Reviewer Portal",
    body: "Send a deck to an investor without an account. Time-limited access, verification code, chunk comments.",
  },
];

const WORKFLOW_STEPS = [
  {
    n: "01",
    t: "Load your investor list",
    d: "Import your CRM or start with our database of 8,000+ VCs and angels.",
  },
  {
    n: "02",
    t: "Run the pipeline",
    d: "Move investors through stages, log interactions, and forecast the round.",
  },
  {
    n: "03",
    t: "Share the deck",
    d: "Send a secure reviewer link. See when they opened it and what they commented on.",
  },
  {
    n: "04",
    t: "Iterate with AI",
    d: "Get scored feedback on your deck and simulated investor questions before the meeting.",
  },
];

const METRICS = [
  {
    value: 2.1,
    suffix: "B+",
    prefix: "$",
    label: "Tracked through Raise",
    format: (v: number) => `$${v.toFixed(1)}`,
  },
  {
    value: 8400,
    suffix: "",
    prefix: "",
    label: "Investors in the database",
    format: (v: number) => Math.round(v).toLocaleString(),
  },
  {
    value: 12,
    suffix: " min",
    prefix: "",
    label: "Median time to first pipeline",
    format: (v: number) => Math.round(v).toString(),
  },
  {
    value: 94,
    suffix: "%",
    prefix: "",
    label: "Founders close faster",
    format: (v: number) => Math.round(v).toString(),
  },
];

export function LandingPage() {
  useEffect(() => {
    (async () => {
      const AOSModule = await import("aos");
      const AOS = AOSModule && (AOSModule.default || AOSModule);
      await import("aos/dist/aos.css");

      const gsapModule = await import("gsap");
      const gsap = gsapModule && (gsapModule.gsap || gsapModule.default || gsapModule);
      const scrollTriggerModule = await import("gsap/ScrollTrigger");
      const ScrollTrigger = scrollTriggerModule && (scrollTriggerModule.ScrollTrigger || scrollTriggerModule.default);

      if (gsap && ScrollTrigger) {
        gsap.registerPlugin(ScrollTrigger);
      }

      if (AOS && typeof AOS.init === "function") {
        AOS.init({
          duration: 800,
          once: true,
          easing: "ease-out-cubic",
          offset: 80,
        });
      }

      if (gsap) {
        const heroTimeline = gsap.timeline({
          defaults: { duration: 0.8, ease: "power3.out" },
        });

        heroTimeline
          .fromTo(
            ".hero-title",
            { y: 30, opacity: 0 },
            { y: 0, opacity: 1 }
          )
          .fromTo(
            ".hero-title h1",
            { y: 20, opacity: 0 },
            { y: 0, opacity: 1 },
            "-=0.5"
          )
          .fromTo(
            ".hero-title p",
            { y: 20, opacity: 0 },
            { y: 0, opacity: 1 },
            "-=0.45"
          )
          .fromTo(
            ".hero-title .button-row",
            { y: 20, opacity: 0 },
            { y: 0, opacity: 1 },
            "-=0.4"
          );

        const reveal = gsap.utils && gsap.utils.toArray ? gsap.utils.toArray(".reveal") : [];
        reveal.forEach((element) => {
          gsap.fromTo(
            element,
            { y: 24, opacity: 0 },
            {
              y: 0,
              opacity: 1,
              duration: 0.75,
              ease: "power3.out",
              scrollTrigger: {
                trigger: element,
                start: "top 85%",
                toggleActions: "play none none none",
              },
            }
          );
        });

        gsap.utils.toArray(".metric-count").forEach((element, index) => {
          const metric = METRICS[index];
          if (!metric) return;

          const counter = { value: 0 };
          gsap.to(counter, {
            value: metric.value,
            duration: 1.6,
            ease: "power3.out",
            scrollTrigger: {
              trigger: element,
              start: "top 80%",
              toggleActions: "play none none none",
            },
            onUpdate: () => {
              const formatted = metric.format(counter.value);
              element.textContent = `${formatted}${metric.suffix}`;
            },
          });
        });
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <Hero />
      <Logos />
      <Features />
      <Workflow />
      <Metrics />
      <CtaBand />
      <SiteFooter />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div className="absolute inset-0 grid-bg opacity-40" aria-hidden />
      <div className="absolute left-1/2 top-0 h-[500px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-[120px]" aria-hidden />
      <div className="relative mx-auto max-w-7xl px-6 py-24 md:py-32">
        <div className="hero-title mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" /> New AI deck analysis with investor personas
          </div>
          <h1 className="mt-6 font-display text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
            Run your fundraise {" "}
            <span className="bg-gradient-to-r from-primary to-[oklch(0.72_0.2_25)] bg-clip-text text-transparent">
              like an engineer
            </span>
            .
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Investor CRM, deal pipeline, secure data room, and AI feedback on your deck one workspace built to feel fast and stay out of your way.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3 button-row">
            <Button asChild size="lg" className="gap-2">
              <Link to="/auth/register">
                Start free <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/app">See the app</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Free forever for solo founders · No credit card
          </p>
        </div>
        <div className="relative mx-auto mt-16 w-full max-w-5xl">
          <div className="w-full rounded-xl border border-border bg-surface p-2 shadow-glow glow-orange">
            <div className="w-full rounded-lg border border-border bg-background overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-muted" />
                  <span className="h-2.5 w-2.5 rounded-full bg-muted" />
                  <span className="h-2.5 w-2.5 rounded-full bg-muted" />
                </div>
                <div className="ml-4 text-xs text-muted-foreground font-mono">raise.app/app/crm/pipeline</div>
              </div>
              <div className="grid grid-cols-4 gap-3 p-4">
                {['Prospect', 'Contacted', 'Meeting', 'Diligence'].map((stage, index) => (
                  <div key={stage} className="rounded-md border border-border bg-surface p-3">
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="font-medium">{stage}</span>
                      <span className="text-muted-foreground">{[8, 5, 3, 2][index]}</span>
                    </div>
                    <div className="space-y-2">
                      {[0, 1].map((row) => (
                        <div key={`${stage}-${row}`} className="rounded border border-border bg-background p-2">
                          <div className="h-2 w-24 rounded bg-muted-foreground/30" />
                          <div className="mt-1.5 h-2 w-16 rounded bg-muted-foreground/15" />
                          <div className="mt-2 flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                            <span className="text-[10px] text-muted-foreground">$500k · 60%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Logos() {
  const logos = ["Sequoia", "a16z", "Index", "Accel", "Lightspeed", "Bessemer"];

  return (
    <section className="border-b border-border bg-background py-10">
      <div className="mx-auto max-w-7xl px-6">
        <p className="text-center text-xs uppercase tracking-widest text-muted-foreground">
          Founders track investors from every major firm
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
          {logos.map((logo) => (
            <span key={logo} className="font-display text-lg font-semibold text-muted-foreground/60">
              {logo}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="reveal border-b border-border bg-background py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="max-w-2xl">
          <div className="text-xs font-mono uppercase tracking-widest text-primary">// features</div>
          <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight">Everything you need to close the round</h2>
          <p className="mt-4 text-muted-foreground">
            One workspace replaces spreadsheets, Notion pages, and email threads. Built to feel fast and stay out of your way.
          </p>
        </div>
        <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;

            return (
              <div key={feature.title} className="group bg-background border border-border p-8 transition duration-300 ease-out hover:bg-primary/5 hover:border-primary/20">
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface text-primary group-hover:border-primary/40">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 font-display text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{feature.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Workflow() {
  return (
    <section className="reveal border-b border-border bg-surface/40 py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="text-xs font-mono uppercase tracking-widest text-primary">// workflow</div>
        <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight">From cold outreach to wire transfer</h2>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {WORKFLOW_STEPS.map((step) => (
            <div key={step.n} className="rounded-lg border border-border bg-background p-6 transition duration-300 ease-out transform hover:-translate-y-1 hover:bg-surface hover:shadow-lg hover:shadow-slate-900/10">
              <div className="font-mono text-xs text-primary">{step.n}</div>
              <h3 className="mt-3 font-display text-lg font-semibold">{step.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{step.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Metrics() {
  return (
    <section className="reveal border-b border-border py-16">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-6 md:grid-cols-4">
        {METRICS.map((item) => (
          <div key={item.label} className="text-center">
            <div className="metric-count font-display text-4xl font-semibold text-primary">0</div>
            <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">{item.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CtaBand() {
  return (
    <section className="reveal border-b border-border bg-background py-24">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">Your next round starts today</h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Set up your workspace in under 2 minutes. Invite your co-founder, load your first 10 investors, and get feedback on your deck tonight.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/auth/register">Create free account</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/pricing">See pricing</Link>
          </Button>
        </div>
        <div className="mt-6 flex items-center justify-center gap-6 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-primary" /> Free forever plan</span>
          <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-primary" /> SOC 2 ready</span>
          <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-primary" /> Cancel anytime</span>
        </div>
      </div>
    </section>
  );
}

export default LandingPage;
