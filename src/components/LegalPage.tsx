import { Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { LegalLinks } from "@/components/LegalLinks";
import { LEGAL_LAST_UPDATED } from "@/lib/legal";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-6 py-10">
        <button
          type="button"
          onClick={() => {
            if (window.history.length > 1) router.history.back();
            else void router.navigate({ to: "/" });
          }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <h1 className="mt-6 text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {LEGAL_LAST_UPDATED}</p>
        <div className="legal-content mt-8 space-y-6 text-[15px] leading-relaxed text-foreground/90">
          {children}
        </div>
        <footer className="mt-12 border-t border-border/60 pt-6 text-muted-foreground">
          <LegalLinks />
          <p className="mt-4 text-sm">
            <Link to="/" className="hover:text-foreground">
              Flashlark
            </Link>
          </p>
        </footer>
      </main>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      {children}
    </section>
  );
}
