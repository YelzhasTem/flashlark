import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/SiteHeader";
import { LegalLinks } from "@/components/LegalLinks";
import { isNativeApp } from "@/lib/native";
import {
  Brain,
  Clock,
  Sparkles,
  BookOpen,
  Repeat,
  TrendingUp,
  ArrowRight,
  Check,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Flashlark — learn vocabulary and remember it longer" },
      {
        name: "description",
        content:
          "Flashlark is a vocabulary app with spaced repetition. Move words into long-term memory and stop forgetting them.",
      },
      { property: "og:title", content: "Flashlark — learn vocabulary for the long term" },
      {
        property: "og:description",
        content:
          "Learn vocabulary with flashcards and spaced repetition so words stick in long-term memory.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        navigate({ to: "/dashboard", replace: true });
      } else if (isNativeApp()) {
        // The marketing page is for the website; the app opens straight on sign-in.
        navigate({ to: "/auth", search: { mode: "login" }, replace: true });
      } else {
        setChecking(false);
      }
    });
  }, [navigate]);

  if (checking) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_color-mix(in_oklab,var(--primary)_18%,transparent),transparent_60%)]" />
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28 text-center">
          <p className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-accent mb-6">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
            Vocabulary that stays with you
          </p>
          <h1 className="font-display text-5xl md:text-7xl font-extrabold leading-[1.02] tracking-tight max-w-4xl mx-auto">
            Learn vocabulary <span className="text-primary">and remember them for good</span>
          </h1>
          <p className="mt-7 max-w-2xl mx-auto text-lg md:text-xl leading-relaxed text-muted-foreground">
            Flashlark uses spaced repetition to move every word into long-term memory. No cramming,
            just short reviews at the right time.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="rounded-full px-7 h-13 text-base">
              <Link to="/auth" search={{ mode: "signup" }}>
                Start learning <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-4 w-4 text-primary" /> Ad-free
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-4 w-4 text-primary" /> AI deck generation
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-4 w-4 text-primary" /> Progress syncs
            </span>
          </div>
        </div>
      </section>

      {/* Key feature: long-term memory */}
      <section id="why" className="mx-auto max-w-6xl px-6 py-12">
        <div className="rounded-3xl border border-border bg-card p-6 md:p-10 grid md:grid-cols-[1.1fr_1fr] gap-6 items-center">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-primary mb-3">
              <Brain className="h-3.5 w-3.5" /> Main feature
            </p>
            <h2 className="font-display text-2xl md:text-3xl font-bold leading-tight tracking-tight">
              Words move into long-term memory instead of vanishing the next day
            </h2>
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
              Flashlark tracks how well you know each word and chooses when to review it: after 10
              minutes, a day, a week, a month. This is
              <span className="text-foreground font-medium"> spaced repetition</span>, a proven
              memorization method.
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              {[
                "A personal review schedule for every word",
                "Hard words more often, easy words less often",
                "Reminders when it is time to review",
                "Progress: learning -> remembered -> mastered",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <span className="text-muted-foreground">{line}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: "10 min", sub: "New" },
              { label: "1 day", sub: "Learning" },
              { label: "3 days", sub: "Remembered" },
              { label: "1 week", sub: "Confident" },
              { label: "2 weeks", sub: "Mastered" },
              { label: "1 month", sub: "In memory" },
            ].map((s, i) => (
              <div
                key={s.label}
                className="rounded-2xl border border-border bg-background p-4"
                style={{ opacity: 0.55 + i * 0.075 }}
              >
                <div className="text-xl font-display font-bold text-primary">{s.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5 uppercase tracking-wider">
                  {s.sub}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-12">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
            Everything you need for vocabulary growth
          </h2>
          <p className="mt-4 text-muted-foreground">
            Flashcards, training modes, AI generation, and progress analytics in one place.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {[
            {
              icon: Clock,
              title: "Spaced repetition",
              desc: "At the heart of Flashlark is an algorithm that spaces reviews over time so words settle into long-term memory.",
            },
            {
              icon: Sparkles,
              title: "AI deck generation",
              desc: "Enter a topic, level, or article link, and AI builds a ready-to-study deck with translations in seconds.",
            },
            {
              icon: Repeat,
              title: "7 training modes",
              desc: "Flashcards, keyboard input, reverse translation, associations, speed mode, and deeper practice.",
            },
            {
              icon: BookOpen,
              title: "Your own decks",
              desc: "Create decks for your own life: travel, IELTS, work, a favorite show. No limits.",
            },
            {
              icon: TrendingUp,
              title: "Progress and streaks",
              desc: "Track retention, mastered words, and keep a daily study streak.",
            },
            {
              icon: Brain,
              title: "Smart reminders",
              desc: "Flashlark tells you when a deck is ready for review, not too early and not too late.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-border bg-card p-6 hover:border-primary/40 transition-colors"
            >
              <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="font-display text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
            How it works
          </h2>
          <p className="mt-4 text-muted-foreground">
            Four steps from your first word to confident recall.
          </p>
        </div>
        <div className="grid md:grid-cols-4 gap-4">
          {[
            { n: "01", t: "Create a deck", d: "Manually, with AI, or from an article link." },
            {
              n: "02",
              t: "Study cards",
              d: "Choose a mode that fits, from simple cards to typed recall.",
            },
            {
              n: "03",
              t: "Review on schedule",
              d: "Flashlark reminds you when to come back to the words.",
            },
            { n: "04", t: "Remember longer", d: "Words move into long-term memory." },
          ].map((s) => (
            <div key={s.n} className="rounded-2xl border border-border bg-card p-6">
              <div className="text-xs font-mono text-primary mb-3">{s.n}</div>
              <h3 className="font-display text-lg font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="rounded-3xl bg-gradient-to-br from-primary to-accent p-10 md:p-16 text-center text-primary-foreground">
          <h2 className="font-display text-3xl md:text-5xl font-bold tracking-tight">
            Start learning words that stay with you
          </h2>
          <p className="mt-5 max-w-xl mx-auto opacity-90 text-lg">
            Free. Ad-free. Sign-up takes 20 seconds.
          </p>
          <div className="mt-8">
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="rounded-full px-8 h-13 text-base"
            >
              <Link to="/auth" search={{ mode: "signup" }}>
                Create account <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-primary to-accent grid place-items-center text-primary-foreground font-display font-bold text-xs">
              M
            </div>
            <span>© {new Date().getFullYear()} Flashlark. Learn words for good.</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-5">
            <LegalLinks />
            <Link
              to="/auth"
              search={{ mode: "login" }}
              className="hover:text-foreground transition-colors"
            >
              Sign in
            </Link>
            <Link
              to="/auth"
              search={{ mode: "signup" }}
              className="hover:text-foreground transition-colors"
            >
              Sign up
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
