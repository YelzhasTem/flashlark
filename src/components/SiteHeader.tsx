import { Link, useNavigate } from "@tanstack/react-router";
import {
  BookOpenCheck,
  LogOut,
  Moon,
  Settings as SettingsIcon,
  ShieldCheck,
  User as UserIcon,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { useT } from "@/lib/i18n";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SiteHeader() {
  const [dark, setDark] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const navigate = useNavigate();
  const t = useT();

  useEffect(() => {
    const saved = localStorage.getItem("theme") === "dark";
    setDark(saved);
    document.documentElement.classList.toggle("dark", saved);

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setAuthReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadUsername = async () => {
      if (!session) {
        setUsername("");
        setDisplayName("");
        setAvatarUrl(null);
        setIsAdmin(false);
        return;
      }

      const metadataUsername =
        typeof session.user.user_metadata?.username === "string"
          ? session.user.user_metadata.username.trim()
          : "";
      setUsername(metadataUsername);
      setDisplayName(
        typeof session.user.user_metadata?.display_name === "string"
          ? session.user.user_metadata.display_name.trim()
          : "",
      );
      setAvatarUrl(
        typeof session.user.user_metadata?.avatar_url === "string"
          ? session.user.user_metadata.avatar_url
          : null,
      );

      const [{ data }, { data: adminRole }] = await Promise.all([
        supabase
          .from("profiles")
          .select("username, display_name, avatar_url")
          .eq("user_id", session.user.id)
          .maybeSingle(),
        // Users can read only their own roles, so this just decides whether to
        // show the moderation link; the admin page enforces access itself.
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", session.user.id)
          .eq("role", "admin")
          .maybeSingle(),
      ]);

      if (!mounted) return;
      setIsAdmin(Boolean(adminRole));
      setUsername(data?.username ?? metadataUsername);
      setDisplayName(data?.display_name ?? "");
      setAvatarUrl(data?.avatar_url ?? null);
    };

    void loadUsername();

    const handleUsernameUpdate = (event: Event) => {
      const nextUsername = (event as CustomEvent<string>).detail;
      if (typeof nextUsername === "string") setUsername(nextUsername);
    };
    const handleProfileUpdate = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          username?: string;
          displayName?: string | null;
          avatarUrl?: string | null;
        }>
      ).detail;

      if (typeof detail?.username === "string") setUsername(detail.username);
      if (detail?.displayName !== undefined) setDisplayName(detail.displayName ?? "");
      if (detail?.avatarUrl !== undefined) setAvatarUrl(detail.avatarUrl);
    };

    window.addEventListener("flashlark:username-updated", handleUsernameUpdate);
    window.addEventListener("flashlark:profile-updated", handleProfileUpdate);

    return () => {
      mounted = false;
      window.removeEventListener("flashlark:username-updated", handleUsernameUpdate);
      window.removeEventListener("flashlark:profile-updated", handleProfileUpdate);
    };
  }, [session]);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { mode: "login" } });
  };

  const accountName =
    displayName || username || session?.user.email?.split("@")[0] || "Flashlark account";
  const accountUsername = username ? `@${username}` : null;
  const accountEmail = session?.user.email ?? "";
  const avatarFallback = (displayName || username || "ME").slice(0, 2).toUpperCase();
  const isSignedIn = Boolean(session);
  const isSignedOut = authReady && !session;

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto max-w-6xl px-6 py-4 flex flex-wrap items-center gap-3 md:gap-4">
        <Link to="/" className="flex items-center gap-2.5 group">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm group-hover:scale-105 transition-transform">
            <BookOpenCheck className="h-4.5 w-4.5" strokeWidth={2.25} />
          </span>
          <span className="font-display text-[17px] font-bold tracking-tight">Flashlark</span>
        </Link>

        <nav className="ml-auto flex items-center gap-1 text-sm font-medium">
          {isSignedOut ? (
            <>
              <Link
                to="/decks"
                className="hidden px-2.5 py-2 rounded-full hover:bg-secondary transition-colors sm:px-3 md:inline-flex"
                activeProps={{
                  className:
                    "hidden px-2.5 py-2 rounded-full bg-secondary text-primary sm:px-3 md:inline-flex",
                }}
              >
                {t("nav.decks")}
              </Link>
              <Link
                to="/collections"
                className="hidden px-2.5 py-2 rounded-full hover:bg-secondary transition-colors sm:px-3 md:inline-flex"
                activeProps={{
                  className:
                    "hidden px-2.5 py-2 rounded-full bg-secondary text-primary sm:px-3 md:inline-flex",
                }}
              >
                {t("nav.collections")}
              </Link>
              <Link
                to="/community"
                className="hidden px-2.5 py-2 rounded-full hover:bg-secondary transition-colors sm:px-3 md:inline-flex"
                activeProps={{
                  className:
                    "hidden px-2.5 py-2 rounded-full bg-secondary text-primary sm:px-3 md:inline-flex",
                }}
              >
                Community
              </Link>
              <button
                onClick={toggleDark}
                aria-label={t("nav.theme")}
                className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-secondary text-muted-foreground transition-colors"
              >
                <Moon className="h-4 w-4" />
              </button>
              <Link
                to="/auth"
                search={{ mode: "login" }}
                className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {t("nav.login")}
              </Link>
            </>
          ) : null}
          {isSignedIn ? (
            <>
              <Link
                to="/decks"
                className="hidden px-2.5 py-2 rounded-full hover:bg-secondary transition-colors sm:px-3 md:inline-flex"
                activeProps={{
                  className:
                    "hidden px-2.5 py-2 rounded-full bg-secondary text-primary sm:px-3 md:inline-flex",
                }}
              >
                {t("nav.decks")}
              </Link>
              <Link
                to="/collections"
                className="hidden px-2.5 py-2 rounded-full hover:bg-secondary transition-colors sm:px-3 md:inline-flex"
                activeProps={{
                  className:
                    "hidden px-2.5 py-2 rounded-full bg-secondary text-primary sm:px-3 md:inline-flex",
                }}
              >
                {t("nav.collections")}
              </Link>
              <Link
                to="/community"
                className="hidden px-2.5 py-2 rounded-full hover:bg-secondary transition-colors sm:px-3 md:inline-flex"
                activeProps={{
                  className:
                    "hidden px-2.5 py-2 rounded-full bg-secondary text-primary sm:px-3 md:inline-flex",
                }}
              >
                Community
              </Link>
              <button
                onClick={toggleDark}
                aria-label={t("nav.theme")}
                className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-secondary text-muted-foreground transition-colors"
              >
                <Moon className="h-4 w-4" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Open account menu"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full outline-none ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Avatar className="h-9 w-9 border border-border">
                    <AvatarImage src={avatarUrl ?? undefined} alt={accountName} />
                    <AvatarFallback className="text-xs font-semibold">
                      {avatarFallback}
                    </AvatarFallback>
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[min(19rem,calc(100vw-2rem))] p-2">
                  <DropdownMenuItem asChild className="md:hidden">
                    <Link to="/decks">{t("nav.decks")}</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="md:hidden">
                    <Link to="/collections">{t("nav.collections")}</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="md:hidden">
                    <Link to="/community">Community</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="md:hidden" />
                  <DropdownMenuLabel className="flex flex-col items-center px-4 py-4 text-center font-normal">
                    <Avatar className="mb-3 h-16 w-16 border border-border">
                      <AvatarImage src={avatarUrl ?? undefined} alt={accountName} />
                      <AvatarFallback className="text-lg font-semibold">
                        {avatarFallback}
                      </AvatarFallback>
                    </Avatar>
                    <span className="max-w-full truncate text-base font-semibold text-foreground">
                      {accountName}
                    </span>
                    {accountEmail ? (
                      <span className="mt-0.5 max-w-full truncate text-xs text-muted-foreground">
                        {accountEmail}
                      </span>
                    ) : null}
                    {accountUsername ? (
                      <span className="mt-1 max-w-full truncate text-xs text-muted-foreground">
                        {accountUsername}
                      </span>
                    ) : null}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild className="px-3 py-2.5">
                    <Link to="/profile">
                      <UserIcon className="h-4 w-4" />
                      {t("nav.profile")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="px-3 py-2.5">
                    <Link to="/friends">
                      <Users className="h-4 w-4" />
                      {t("nav.friends")}
                    </Link>
                  </DropdownMenuItem>
                  {isAdmin ? (
                    <DropdownMenuItem asChild className="px-3 py-2.5">
                      <Link to="/community-admin">
                        <ShieldCheck className="h-4 w-4" />
                        {t("nav.moderation")}
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem asChild className="px-3 py-2.5">
                    <Link to="/settings">
                      <SettingsIcon className="h-4 w-4" />
                      {t("nav.settings")}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleLogout} className="px-3 py-2.5">
                    <LogOut className="h-4 w-4" />
                    {t("nav.logout")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
