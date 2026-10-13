import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { LegalLinks } from "@/components/LegalLinks";
import { DailyReminderCard } from "@/components/DailyReminderCard";
import { ArrowLeft, Loader2, Save, Settings, UserRound } from "lucide-react";
import { useT } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { type FormEvent, useEffect, useState } from "react";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Flashlark" },
      { name: "description", content: "Manage learning modes and app preferences." },
    ],
  }),
  component: SettingsPage,
});

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

type ProfileSettings = {
  username: string;
  display_name: string | null;
};

function getProfileErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  if (lower.includes("username") || lower.includes("duplicate")) {
    return "This username is already taken. Try another one.";
  }
  return message || "Could not save settings.";
}

function SettingsPage() {
  const t = useT();
  const [profile, setProfile] = useState<ProfileSettings | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingUsername, setSavingUsername] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadProfile = async () => {
      setLoadingProfile(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!mounted) return;

      if (!session) {
        setLoadingProfile(false);
        return;
      }

      setUserId(session.user.id);
      const { data, error } = await supabase
        .from("profiles")
        .select("username, display_name")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!mounted) return;
      if (error) {
        toast.error(getProfileErrorMessage(error));
      }

      const nextProfile = data
        ? {
            username: data.username,
            display_name: data.display_name,
          }
        : null;

      setProfile(nextProfile);
      setUsername(nextProfile?.username ?? "");
      setLoadingProfile(false);
    };

    void loadProfile();

    return () => {
      mounted = false;
    };
  }, []);

  const normalizedUsername = username.trim().toLowerCase();
  const usernameChanged = normalizedUsername !== (profile?.username ?? "");

  const handleUsernameSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId || !usernameChanged) return;

    if (!normalizedUsername) {
      toast.error("Choose a username.");
      return;
    }

    if (!USERNAME_RE.test(normalizedUsername)) {
      toast.error("Use 3-24 lowercase letters, numbers, or underscores for username.");
      return;
    }

    setSavingUsername(true);
    try {
      const { data: updatedProfile, error: updateError } = await supabase
        .from("profiles")
        .update({ username: normalizedUsername })
        .eq("user_id", userId)
        .select("username, display_name")
        .maybeSingle();

      if (updateError) throw updateError;

      let savedProfile = updatedProfile;
      if (!savedProfile) {
        const { data: insertedProfile, error: insertError } = await supabase
          .from("profiles")
          .upsert(
            {
              user_id: userId,
              username: normalizedUsername,
              display_name: profile?.display_name ?? normalizedUsername,
            },
            { onConflict: "user_id" },
          )
          .select("username, display_name")
          .single();

        if (insertError) throw insertError;
        savedProfile = insertedProfile;
      }

      setProfile({
        username: savedProfile.username,
        display_name: savedProfile.display_name,
      });
      setUsername(savedProfile.username);
      window.dispatchEvent(
        new CustomEvent("flashlark:username-updated", { detail: savedProfile.username }),
      );
      toast.success("Username updated.");
    } catch (error) {
      toast.error(getProfileErrorMessage(error));
    } finally {
      setSavingUsername(false);
    }
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8"
        >
          <ArrowLeft className="h-4 w-4" /> {t("settings.back")}
        </Link>

        <h1 className="font-display text-4xl font-semibold tracking-tight mb-2">
          {t("settings.title")}
        </h1>
        <p className="text-muted-foreground mb-10">{t("settings.desc")}</p>

        <section className="mb-6 rounded-3xl border border-border bg-card p-6">
          <h2 className="font-display text-xl flex items-center gap-2">
            <UserRound className="h-5 w-5 text-accent" /> Account
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-xl">
            Your username is public on community decks and your creator page.
          </p>

          <form onSubmit={handleUsernameSave} className="mt-5 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="settings-username">Username</Label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  id="settings-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value.toLowerCase())}
                  placeholder="ielts_master"
                  autoComplete="username"
                  disabled={loadingProfile || savingUsername}
                  className="h-11"
                />
                <Button
                  type="submit"
                  className="h-11 shrink-0 rounded-full"
                  disabled={loadingProfile || savingUsername || !usernameChanged}
                >
                  {savingUsername ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Use 3-24 lowercase letters, numbers, or underscores.
              </p>
              {loadingProfile ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading account...
                </p>
              ) : profile?.username ? (
                <p className="text-xs text-muted-foreground">
                  Current username:{" "}
                  <span className="font-medium text-foreground">@{profile.username}</span>
                </p>
              ) : null}
            </div>
          </form>
        </section>

        <section className="mb-6 rounded-3xl border border-border bg-card p-6">
          <h2 className="font-display text-xl flex items-center gap-2">
            <Settings className="h-5 w-5 text-accent" /> App settings
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-xl">
            Deck-specific study settings are managed from each deck page.
          </p>
        </section>

        <DailyReminderCard />

        <section className="rounded-3xl border border-border bg-card p-6">
          <h2 className="font-display text-xl">About</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-xl">
            Policies, help, and account deletion (in Profile).
          </p>
          <LegalLinks className="mt-4 text-muted-foreground" />
        </section>
      </main>
    </div>
  );
}
