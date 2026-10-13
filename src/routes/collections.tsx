import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, FolderOpen, Check, Globe2, Settings2 } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { useCollections } from "@/lib/collections";
import { useDecks } from "@/lib/decks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useT } from "@/lib/i18n";
import { OFFLINE_SAVE_MESSAGE, useOnlineStatus } from "@/lib/online-status";

export const Route = createFileRoute("/collections")({
  component: CollectionsPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive">
      Error: {error instanceof Error ? error.message : String(error)}
    </div>
  ),
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

function CollectionsPage() {
  const { collections, createCollection, deleteCollection, setCollectionDecks, updateCollection } =
    useCollections();
  const { decks } = useDecks();
  const t = useT();
  const isOnline = useOnlineStatus();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createError, setCreateError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  const [deleteColId, setDeleteColId] = useState<string | null>(null);
  const [editColId, setEditColId] = useState<string | null>(null);
  const [editColName, setEditColName] = useState("");
  const [editColDescription, setEditColDescription] = useState("");
  const colToDelete = collections.find((c) => c.id === deleteColId);
  const colToEdit = editColId ? collections.find((c) => c.id === editColId) : undefined;

  useEffect(() => {
    if (!colToEdit) return;
    setEditColName(colToEdit.name);
    setEditColDescription(colToEdit.description);
    // Fill the form once per opened collection; a background refetch must not
    // overwrite what the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editColId, Boolean(colToEdit)]);

  const openPicker = (collectionId: string, current: string[]) => {
    setPickerFor(collectionId);
    setPickerSelected(new Set(current));
  };

  const toggleDeck = (deckId: string) => {
    setPickerSelected((prev) => {
      const next = new Set(prev);
      if (next.has(deckId)) next.delete(deckId);
      else next.add(deckId);
      return next;
    });
  };

  const savePicker = () => {
    if (!pickerFor) return;
    if (!isOnline) return;
    setCollectionDecks(pickerFor, Array.from(pickerSelected));
    setPickerFor(null);
  };

  const handleCreate = () => {
    if (!name.trim()) return;
    if (!isOnline) {
      setCreateError(OFFLINE_SAVE_MESSAGE);
      return;
    }
    setCreateError("");
    createCollection(name.trim(), description.trim());
    setName("");
    setDescription("");
    setCreateOpen(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">{t("col.title")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("col.subtitle")}</p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                {t("col.new")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("col.create")}</DialogTitle>
              </DialogHeader>
              {!isOnline && (
                <div
                  role="alert"
                  className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  {OFFLINE_SAVE_MESSAGE}
                </div>
              )}
              <div className="space-y-3">
                <Input
                  placeholder={t("col.name")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Textarea
                  placeholder={t("col.descPh")}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              {createError && <p className="text-sm text-destructive">{createError}</p>}
              <DialogFooter>
                <Button onClick={handleCreate} disabled={!isOnline || !name.trim()}>
                  {t("col.confirm")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {collections.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center">
            <FolderOpen className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">{t("col.empty")}</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {collections.map((c) => {
              const collectionDecks = decks.filter((d) => c.deckIds.includes(d.id));
              return (
                <div
                  key={c.id}
                  className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold truncate">{c.name}</h3>
                      {c.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {c.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditColId(c.id)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={t("col.settings")}
                      >
                        <Settings2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteColId(c.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        aria-label={t("col.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    {collectionDecks.length} {t("col.decksCount")} · {c.visibility}
                    {c.rating ? ` · ${c.rating} ★` : ""}
                    {c.totalLearners ? ` · ${c.totalLearners} learners` : ""}
                  </div>

                  {collectionDecks.length > 0 && (
                    <ul className="space-y-1">
                      {collectionDecks.slice(0, 4).map((d) => (
                        <li key={d.id} className="text-sm">
                          <Link
                            to="/deck/$deckId"
                            params={{ deckId: d.id }}
                            className="hover:text-primary transition-colors truncate block"
                          >
                            · {d.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-auto grid grid-cols-2 gap-2">
                    <Button asChild size="sm">
                      <Link to="/collections/$collectionId" params={{ collectionId: c.id }}>
                        Open
                      </Link>
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openPicker(c.id, c.deckIds)}
                      disabled={!isOnline}
                    >
                      {t("col.pickDecks")}
                    </Button>
                    <Button asChild variant="outline" size="sm" className="col-span-2">
                      <Link to="/publish" search={{ type: "collection", id: c.id }}>
                        <Globe2 className="h-4 w-4" /> Publish
                      </Link>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Dialog open={pickerFor !== null} onOpenChange={(o) => !o && setPickerFor(null)}>
          <DialogContent className="max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>{t("col.pickerTitle")}</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto space-y-1 py-2">
              {decks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">{t("col.noDecks")}</p>
              ) : (
                decks.map((d) => {
                  const checked = pickerSelected.has(d.id);
                  return (
                    <label
                      key={d.id}
                      className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary cursor-pointer"
                    >
                      <Checkbox checked={checked} onCheckedChange={() => toggleDeck(d.id)} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{d.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {d.cards.length} {t("col.cards")}
                        </div>
                      </div>
                      {checked && <Check className="h-4 w-4 text-primary" />}
                    </label>
                  );
                })
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPickerFor(null)}>
                {t("col.cancel")}
              </Button>
              <Button onClick={savePicker} disabled={!isOnline}>
                {t("col.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={editColId !== null} onOpenChange={(open) => !open && setEditColId(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="font-display text-xl">{t("col.settingsTitle")}</DialogTitle>
              <DialogDescription>
                {colToEdit ? (
                  <>
                    Edit «<strong>{colToEdit.name}</strong>» details.
                  </>
                ) : (
                  t("col.settingsTitle")
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                placeholder={t("col.name")}
                value={editColName}
                onChange={(e) => setEditColName(e.target.value)}
              />
              <Textarea
                placeholder={t("col.descPh")}
                value={editColDescription}
                onChange={(e) => setEditColDescription(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditColId(null)}>
                {t("col.cancel")}
              </Button>
              <Button
                onClick={() => {
                  if (!editColId) return;
                  if (!isOnline) return;
                  updateCollection(editColId, editColName.trim(), editColDescription.trim());
                  setEditColId(null);
                }}
                disabled={!isOnline || !editColName.trim()}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={deleteColId !== null} onOpenChange={(o) => !o && setDeleteColId(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="font-display text-xl">{t("col.deleteTitle")}</DialogTitle>
              <DialogDescription>
                {colToDelete ? (
                  <>
                    «<strong>{colToDelete.name}</strong>» — {t("col.deleteDescGeneric")}
                  </>
                ) : (
                  t("col.deleteDescGeneric")
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteColId(null)}>
                {t("col.cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (!isOnline) return;
                  if (deleteColId) deleteCollection(deleteColId);
                  setDeleteColId(null);
                }}
                disabled={!isOnline}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t("col.delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
