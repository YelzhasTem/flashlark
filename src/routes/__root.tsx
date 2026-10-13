import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useLocation,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { RecallNotifier } from "@/components/RecallNotifier";
import { LanguageProvider } from "@/lib/i18n";
import { AuthGate } from "@/components/AuthGate";
import { playButtonSound } from "@/lib/sounds";
import { OfflineBanner } from "@/components/OfflineBanner";
import { AiConsentDialog } from "@/components/AiConsentDialog";
import { supabase } from "@/integrations/supabase/client";

const PUBLIC_PATHS = new Set(["/", "/auth", "/reset-password", "/privacy", "/terms", "/support"]);

function isPublicPath(pathname: string) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PUBLIC_PATHS.has(normalized);
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Memora" },
      { name: "description", content: "A calm flashcard app for learning vocabulary." },
      { property: "og:title", content: "Memora" },
      {
        property: "og:description",
        content: "A calm flashcard app for learning vocabulary.",
      },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "en_US" },

      { name: "twitter:title", content: "Memora" },
      {
        name: "twitter:description",
        content: "A calm flashcard app for learning vocabulary.",
      },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const location = useLocation();
  const requireAuth = !isPublicPath(location.pathname);

  // Cached queries (decks, collections, friends) are not keyed by user. Drop
  // them when the account changes so the next person on a shared browser
  // never sees the previous account's data while their own loads.
  useEffect(() => {
    let currentUserId: string | null | undefined;
    void supabase.auth.getSession().then(({ data }) => {
      if (currentUserId === undefined) currentUserId = data.session?.user.id ?? null;
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user.id ?? null;
      const accountChanged =
        event === "SIGNED_OUT" ||
        (currentUserId !== undefined && currentUserId !== null && nextUserId !== currentUserId);
      if (accountChanged) queryClient.clear();
      currentUserId = nextUserId;
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  useEffect(() => {
    const handlePointerUp = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const control = target.closest("button, a, [role='button']");
      if (!control) return;
      if (
        control instanceof HTMLButtonElement &&
        (control.disabled || control.getAttribute("aria-disabled") === "true")
      ) {
        return;
      }
      playButtonSound();
    };

    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <AuthGate requireAuth={requireAuth}>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <div key={location.pathname} className="route-transition">
            <Outlet />
          </div>
        </AuthGate>
        <OfflineBanner />
        <RecallNotifier />
        <AiConsentDialog />
        <Toaster />
      </LanguageProvider>
    </QueryClientProvider>
  );
}
