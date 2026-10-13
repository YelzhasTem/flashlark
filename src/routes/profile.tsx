import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { Session } from "@supabase/supabase-js";
import { ArrowLeft, Camera, Loader2, Save, Trash2, Upload, UserRound } from "lucide-react";
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AuthGate } from "@/components/AuthGate";
import { SiteHeader } from "@/components/SiteHeader";
import { BlockedUsersCard } from "@/components/BlockedUsersCard";
import { deleteMyAccount } from "@/lib/account.functions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { getUserErrorMessage } from "@/lib/user-errors";
import { shrinkImageToFit } from "@/lib/image-resize";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile - Flashlark" },
      { name: "description", content: "Update your Flashlark profile." },
    ],
  }),
  component: ProfileRoute,
});

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const AVATAR_BUCKET = "avatars";

type ProfileRow = {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
};

function ProfileRoute() {
  return (
    <AuthGate requireAuth>
      <ProfilePage />
    </AuthGate>
  );
}

function fileExtension(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext && /^[a-z0-9]+$/.test(ext)) return ext;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return "jpg";
}

function ProfilePage() {
  const navigate = useNavigate();
  const deleteAccountFn = useServerFn(deleteMyAccount);
  const [session, setSession] = useState<Session | null>(null);
  const [initialProfile, setInitialProfile] = useState<ProfileRow | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const previewUrl = useMemo(() => {
    if (!avatarFile) return null;
    return URL.createObjectURL(avatarFile);
  }, [avatarFile]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    let mounted = true;

    const loadProfile = async () => {
      setLoading(true);

      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        const nextSession = sessionData.session;
        if (!mounted) return;
        setSession(nextSession);

        if (!nextSession) {
          await navigate({ to: "/auth", search: { mode: "login" }, replace: true });
          return;
        }

        const { data, error } = await supabase
          .from("profiles")
          .select("username, display_name, avatar_url")
          .eq("user_id", nextSession.user.id)
          .maybeSingle();

        if (error) throw error;

        const metadataUsername =
          typeof nextSession.user.user_metadata?.username === "string"
            ? nextSession.user.user_metadata.username
            : "";
        const fallbackUsername =
          metadataUsername || nextSession.user.email?.split("@")[0] || "user";
        const profile = {
          username: data?.username ?? fallbackUsername,
          display_name: data?.display_name ?? null,
          avatar_url: data?.avatar_url ?? null,
        };

        if (!mounted) return;
        setInitialProfile(profile);
        setUsername(profile.username);
        setDisplayName(profile.display_name ?? "");
        setAvatarUrl(profile.avatar_url);
      } catch (error) {
        toast.error(getUserErrorMessage(error, "Could not load your profile."));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadProfile();

    return () => {
      mounted = false;
    };
  }, [navigate]);

  const avatarFallback = (username || displayName || "ME").slice(0, 2).toUpperCase();

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file.");
      return;
    }

    // Large photos (most iPhone camera shots) are resized instead of rejected.
    const image = await shrinkImageToFit(file, MAX_AVATAR_SIZE, 1024);
    if (!image) {
      toast.error("Avatar image must be 2 MB or smaller.");
      return;
    }

    setAvatarFile(image);
  };

  const uploadAvatar = async (userId: string) => {
    if (!avatarFile) return avatarUrl;

    const path = `${userId}/avatar-${Date.now()}.${fileExtension(avatarFile)}`;
    const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, avatarFile, {
      cacheControl: "3600",
      upsert: true,
    });

    if (error) throw error;

    const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session) return;

    const normalizedUsername = username.trim().toLowerCase();
    const cleanDisplayName = displayName.trim();

    if (!USERNAME_RE.test(normalizedUsername)) {
      toast.error("Use 3-24 lowercase letters, numbers, or underscores for username.");
      return;
    }

    setSaving(true);

    try {
      if (normalizedUsername !== initialProfile?.username) {
        const { data: usernameAvailable, error: usernameCheckError } = await supabase.rpc(
          "is_username_available",
          { _username: normalizedUsername },
        );

        if (usernameCheckError) throw usernameCheckError;
        if (!usernameAvailable) {
          toast.error("This username is already taken. Try another one.");
          return;
        }
      }

      const nextAvatarUrl = await uploadAvatar(session.user.id);
      const nextProfile = {
        user_id: session.user.id,
        username: normalizedUsername,
        display_name: cleanDisplayName || null,
        avatar_url: nextAvatarUrl,
      };

      const { data: updatedProfile, error } = await supabase
        .from("profiles")
        .update({
          username: nextProfile.username,
          display_name: nextProfile.display_name,
          avatar_url: nextProfile.avatar_url,
        })
        .eq("user_id", session.user.id)
        .select("user_id")
        .maybeSingle();

      if (error) throw error;

      if (!updatedProfile) {
        const { error: insertError } = await supabase.from("profiles").insert(nextProfile);
        if (insertError) throw insertError;
      }

      const { error: authUpdateError } = await supabase.auth.updateUser({
        data: {
          username: normalizedUsername,
          display_name: cleanDisplayName || normalizedUsername,
          avatar_url: nextAvatarUrl,
        },
      });

      if (authUpdateError) throw authUpdateError;

      setInitialProfile({
        username: normalizedUsername,
        display_name: cleanDisplayName || null,
        avatar_url: nextAvatarUrl,
      });
      setUsername(normalizedUsername);
      setAvatarUrl(nextAvatarUrl);
      setAvatarFile(null);

      window.dispatchEvent(
        new CustomEvent("flashlark:username-updated", { detail: normalizedUsername }),
      );
      window.dispatchEvent(
        new CustomEvent("flashlark:profile-updated", {
          detail: {
            username: normalizedUsername,
            displayName: cleanDisplayName || null,
            avatarUrl: nextAvatarUrl,
          },
        }),
      );

      toast.success("Profile updated.");
    } catch (error) {
      toast.error(getUserErrorMessage(error, "Could not update your profile."));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);

    try {
      await deleteAccountFn();
      setDeleteDialogOpen(false);
      window.dispatchEvent(new CustomEvent("flashlark:username-updated", { detail: "" }));
      window.dispatchEvent(
        new CustomEvent("flashlark:profile-updated", {
          detail: { username: "", displayName: null, avatarUrl: null },
        }),
      );
      await supabase.auth.signOut();
      toast.success("Account deleted.");
      await navigate({ to: "/auth", search: { mode: "login" }, replace: true });
    } catch (error) {
      toast.error(getUserErrorMessage(error, "Could not delete your account."));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link
          to="/dashboard"
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-primary">Profile</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
            Manage your account
          </h1>
          <p className="mt-3 text-muted-foreground">
            Update the name, username, and avatar people see in Flashlark.
          </p>
        </div>

        <section className="rounded-2xl border border-border bg-card p-6">
          {loading ? (
            <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
              Loading profile...
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <Avatar className="h-24 w-24 border border-border">
                  <AvatarImage src={previewUrl ?? avatarUrl ?? undefined} alt="" />
                  <AvatarFallback className="text-xl font-semibold">
                    {avatarFallback}
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-3">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold">
                      <Camera className="h-5 w-5 text-accent" />
                      Avatar
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Use a PNG, JPG, WEBP, or GIF image up to 2 MB.
                    </p>
                  </div>
                  <Label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">
                    <Upload className="h-4 w-4" />
                    Choose image
                    <Input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="sr-only"
                      onChange={handleAvatarChange}
                    />
                  </Label>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="profile-username">Username</Label>
                  <Input
                    id="profile-username"
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value.toLowerCase())}
                    placeholder="ielts_master"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    3-24 lowercase letters, numbers, or underscores.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="profile-name">Name</Label>
                  <Input
                    id="profile-name"
                    autoComplete="name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Your name"
                  />
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate({ to: "/settings" })}
                >
                  <UserRound className="h-4 w-4" />
                  App settings
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save profile
                </Button>
              </div>
            </form>
          )}
        </section>

        <BlockedUsersCard />

        <section className="mt-6 rounded-2xl border border-destructive/30 bg-card p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-destructive">Delete account</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Permanently remove your account, decks, collections, progress, friends, and avatar.
              </p>
            </div>
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" disabled={loading || deleting}>
                  <Trash2 className="h-4 w-4" />
                  Delete account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes your Flashlark account and learning data. This action
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={deleting}
                    onClick={(event) => {
                      event.preventDefault();
                      void handleDeleteAccount();
                    }}
                  >
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Delete account
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </section>
      </main>
    </div>
  );
}
