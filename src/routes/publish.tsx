import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, FolderOpen, Globe2, Save } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCollections } from "@/lib/collections";
import { useDecks } from "@/lib/decks";
import { DECK_CATEGORIES, updateDeckPublishing } from "@/lib/community.functions";
import { OFFLINE_SAVE_MESSAGE, useOnlineStatus } from "@/lib/online-status";

type PublishType = "deck" | "collection";
type PublishingVisibility = "private" | "unlisted" | "public";

export const Route = createFileRoute("/publish")({
  component: PublishPage,
});

function parseKeywords(value: string) {
  return value
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function readPublishTarget(search: unknown): { type: PublishType; id: string } | null {
  if (!search) return null;
  const params =
    typeof search === "string"
      ? Object.fromEntries(new URLSearchParams(search))
      : typeof search === "object"
        ? (search as Record<string, unknown>)
        : {};
  const type = params.type;
  const id = typeof params.id === "string" ? params.id : "";
  if ((type === "deck" || type === "collection") && id) return { type, id };
  return null;
}

// A private item opened here is being published, so preselect Public; an item
// that is already published keeps its current setting.
function nextVisibility(current: string): PublishingVisibility {
  return current === "unlisted" ? "unlisted" : "public";
}

function PublishPage() {
  const location = useLocation();
  const isOnline = useOnlineStatus();
  const target = useMemo(() => readPublishTarget(location.search), [location.search]);
  const type = target?.type ?? "deck";
  const targetId = target?.id ?? "";

  const { decks, isLoading: decksLoading } = useDecks();
  const {
    collections,
    isLoading: collectionsLoading,
    updateCollectionPublishing,
  } = useCollections();
  const updateDeck = useServerFn(updateDeckPublishing);
  const queryClient = useQueryClient();

  const selectedDeck = type === "deck" ? decks.find((deck) => deck.id === targetId) : undefined;
  const selectedCollection =
    type === "collection"
      ? collections.find((collection) => collection.id === targetId)
      : undefined;
  const selectedItem = selectedDeck ?? selectedCollection;
  const isLoading = type === "deck" ? decksLoading : collectionsLoading;

  const [visibility, setVisibility] = useState<PublishingVisibility>("public");
  const [keywords, setKeywords] = useState("");
  const [saving, setSaving] = useState(false);

  // Fill the form once per item. Refetches after saving (or on tab focus) must not
  // overwrite it: after unpublishing, the item is private again and the preset
  // would flip the form back to Public, so saving again would republish it.
  const initializedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedItem || initializedForRef.current === selectedItem.id) return;
    initializedForRef.current = selectedItem.id;
    setVisibility(nextVisibility(selectedItem.visibility));
    setKeywords(selectedItem.keywords.join(", "));
  }, [selectedItem]);

  const handleSave = async () => {
    if (!selectedItem) return;
    if (!isOnline) {
      toast.error(OFFLINE_SAVE_MESSAGE);
      return;
    }
    setSaving(true);
    try {
      if (type === "deck") {
        const category =
          selectedDeck && DECK_CATEGORIES.includes(selectedDeck.category as never)
            ? selectedDeck.category
            : "General English";
        await updateDeck({
          data: {
            deckId: selectedItem.id,
            visibility,
            category,
            keywords: parseKeywords(keywords),
          },
        });
        await queryClient.invalidateQueries({ queryKey: ["my-decks"] });
      } else {
        await updateCollectionPublishing(selectedItem.id, visibility, parseKeywords(keywords));
      }
      toast.success(
        visibility === "public"
          ? "Published to Community."
          : visibility === "private"
            ? "Removed from Community. Only you can see it now."
            : "Publishing settings saved.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save publishing settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        {type === "deck" && selectedDeck ? (
          <Link
            to="/deck/$deckId"
            params={{ deckId: selectedDeck.id }}
            className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        ) : (
          <Link
            to="/collections"
            className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        )}

        <section className="mb-8">
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-primary">Publishing</p>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">
            Publish {type === "deck" ? "deck" : "collection"}
          </h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Choose whether this {type} appears in Community or opens only by direct link.
          </p>
        </section>

        {isLoading ? (
          <section className="rounded-3xl border border-border bg-card p-6">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="mt-5 h-24 w-full" />
            <Skeleton className="mt-5 h-10 w-36 rounded-full" />
          </section>
        ) : !target || !selectedItem ? (
          <section className="rounded-3xl border border-dashed border-border bg-card p-10 text-center">
            <Globe2 className="mx-auto h-9 w-9 text-muted-foreground" />
            <h2 className="mt-4 font-display text-2xl font-semibold">Nothing selected</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Open publishing from a specific deck or collection so Flashlark knows what to publish.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button asChild variant="outline">
                <Link to="/decks">Go to decks</Link>
              </Button>
              <Button asChild>
                <Link to="/collections">Go to collections</Link>
              </Button>
            </div>
          </section>
        ) : (
          <section className="rounded-3xl border border-border bg-card p-6">
            {!isOnline && (
              <div
                role="alert"
                className="mb-5 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {OFFLINE_SAVE_MESSAGE}
              </div>
            )}
            <div className="mb-6 flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                {type === "deck" ? (
                  <BookOpen className="h-5 w-5" />
                ) : (
                  <FolderOpen className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {type === "deck" ? "Deck" : "Collection"}
                </p>
                <h2 className="truncate font-display text-2xl font-semibold">
                  {selectedItem.name}
                </h2>
                {selectedItem.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {selectedItem.description}
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Visibility</span>
                <Select
                  value={visibility}
                  onValueChange={(value) => setVisibility(value as PublishingVisibility)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="unlisted">Unlisted</SelectItem>
                    <SelectItem value="private">Private (not published)</SelectItem>
                  </SelectContent>
                </Select>
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Keywords</span>
                <Input
                  value={keywords}
                  onChange={(event) => setKeywords(event.target.value)}
                  placeholder="IELTS, business, travel"
                />
              </label>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-border bg-background px-4 py-3">
                <p className="text-xs text-muted-foreground">Current status</p>
                <p className="font-semibold capitalize">{selectedItem.visibility}</p>
              </div>
              <div className="rounded-2xl border border-border bg-background px-4 py-3">
                <p className="text-xs text-muted-foreground">Learners</p>
                <p className="font-semibold">{selectedItem.totalLearners}</p>
              </div>
              <div className="rounded-2xl border border-border bg-background px-4 py-3">
                <p className="text-xs text-muted-foreground">Likes</p>
                <p className="font-semibold">{selectedItem.likes}</p>
              </div>
              <div className="rounded-2xl border border-border bg-background px-4 py-3">
                <p className="text-xs text-muted-foreground">Rating</p>
                <p className="font-semibold">{selectedItem.rating || "New"}</p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
              <p className="text-sm text-muted-foreground">
                {visibility === "public"
                  ? "Public items can appear in Community."
                  : visibility === "unlisted"
                    ? "Unlisted items open only by direct link."
                    : "Private items are hidden from Community and direct links."}
              </p>
              <Button className="rounded-full" onClick={handleSave} disabled={!isOnline || saving}>
                {saving ? (
                  <>
                    <Globe2 className="h-4 w-4 animate-spin" /> Saving
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" /> Save publishing
                  </>
                )}
              </Button>
            </div>
          </section>
        )}

        {selectedDeck && selectedDeck.visibility !== "private" && (
          <div className="mt-4 text-right">
            <Link
              to="/community/$deckId"
              params={{ deckId: selectedDeck.id }}
              className="text-sm font-medium text-primary hover:underline"
            >
              Open public deck link
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
