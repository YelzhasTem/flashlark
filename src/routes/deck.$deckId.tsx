import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { canPlayMultipleChoice } from "@/lib/multiple-choice";
import { useEffect, useRef, useState } from "react";
import { markDeckStudied } from "@/lib/last-studied";
import { useServerFn } from "@tanstack/react-start";
import { useDeck } from "@/lib/decks";
import { useDeckStats, accuracyFor, weakCardIds } from "@/lib/stats";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DeckColorPicker } from "@/components/DeckColorPicker";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Play,
  RotateCcw,
  Palette,
  Sparkles,
  Loader2,
  Brain,
  Keyboard,
  Zap,
  Highlighter,
  Hourglass,
  Globe2,
  Download,
  Repeat,
} from "lucide-react";
import { generateStudyText } from "@/lib/ai.functions";
import { exportDeckCsv } from "@/lib/native";
import { toast } from "sonner";
import { getDefinitionLanguageFor, getLearningLanguageOption } from "@/lib/languages";
import { OFFLINE_AI_MESSAGE, OFFLINE_SAVE_MESSAGE, useOnlineStatus } from "@/lib/online-status";
import {
  useDeckDelayedRecallEnabled,
  useDeckRecallSummary,
  scheduleNewCard,
  isDelayedRecallHydrated,
} from "@/lib/delayed-recall";
import type { DeckCoverColor } from "@/lib/deck-colors";
import { createAiIdempotencyKey, executeAiRequest } from "@/lib/ai-client";

export const Route = createFileRoute("/deck/$deckId")({
  component: DeckPage,
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripBoldMarkdown(text: string) {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}

function renderReviewText(text: string, words: string[], highlightWords: boolean) {
  const cleanText = stripBoldMarkdown(text);
  if (!highlightWords) return cleanText;

  const uniqueWords = Array.from(
    new Set(words.map((word) => stripBoldMarkdown(word).trim()).filter((word) => word.length > 0)),
  ).sort((a, b) => b.length - a.length);

  if (uniqueWords.length === 0) return cleanText;

  const parts: Array<string | { highlight: string }> = [];
  const regex = new RegExp(
    `(^|[^\\p{L}\\p{N}_])(${uniqueWords.map(escapeRegExp).join("|")})(?=$|[^\\p{L}\\p{N}_])`,
    "giu",
  );
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(cleanText))) {
    const prefix = m[1] ?? "";
    const word = m[2] ?? "";
    if (!word) continue;
    if (m.index > last) parts.push(cleanText.slice(last, m.index));
    if (prefix) parts.push(prefix);
    parts.push({ highlight: word });
    last = m.index + m[0].length;
  }
  if (last < cleanText.length) parts.push(cleanText.slice(last));

  return parts.map((p, i) =>
    typeof p === "string" ? (
      <span key={i}>{p}</span>
    ) : (
      <mark key={i} className="rounded bg-accent/20 px-1 font-semibold text-foreground">
        {p.highlight}
      </mark>
    ),
  );
}

function plural(n: number, forms: [string, string, string]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

const MAX_DECK_CARDS = 100;

function DeckLoading() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          Loading deck...
        </div>

        <div className="mb-10 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-4">
            <Skeleton className="h-12 w-72 max-w-full rounded-xl" />
            <Skeleton className="h-5 w-96 max-w-full" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Skeleton className="h-10 w-28 rounded-full" />
            <Skeleton className="h-10 w-24 rounded-full" />
          </div>
        </div>

        <section className="mb-8 rounded-3xl border border-border bg-card p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div className="w-full max-w-xl space-y-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
            <Skeleton className="h-10 w-32 rounded-full" />
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-card p-6">
          <div className="mb-5 flex items-center justify-between">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-9 w-24 rounded-full" />
          </div>
          <div className="space-y-3">
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className="flex items-center justify-between rounded-2xl bg-secondary/50 px-4 py-3"
              >
                <div className="w-full max-w-md space-y-2">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-4 w-56 max-w-full" />
                </div>
                <Skeleton className="h-8 w-8 rounded-full" />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function DeckPage() {
  const { deckId } = Route.useParams();
  useEffect(() => {
    markDeckStudied(deckId);
  }, [deckId]);
  const navigate = useNavigate();
  const {
    deck,
    addCard,
    deleteCard,
    resetProgress,
    updateDeckAsync,
    isLoading,
    isFetching,
    refetchDecks,
  } = useDeck(deckId);
  const isOnline = useOnlineStatus();
  const stats = useDeckStats(deckId);
  const [didRetryLoad, setDidRetryLoad] = useState(false);
  const [term, setTerm] = useState("");
  const [def, setDef] = useState("");
  const [addError, setAddError] = useState("");
  const [coverColor, setCoverColor] = useState<DeckCoverColor | null>(null);
  const [colorSaving, setColorSaving] = useState(false);
  const [colorError, setColorError] = useState("");
  const generate = useServerFn(generateStudyText);
  const [aiText, setAiText] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string>("");
  const [aiSeed, setAiSeed] = useState(0);
  const [highlightReviewWords, setHighlightReviewWords] = useState(false);
  const [recallEnabled, setRecallEnabled] = useDeckDelayedRecallEnabled(deckId);
  const recallSummary = useDeckRecallSummary(deckId);

  const recallTogglePendingRef = useRef(false);
  const toggleRecall = (on: boolean) => {
    // Schedule only after the setting is saved: the server refuses to
    // schedule cards of a deck whose Delayed Recall is still off.
    recallTogglePendingRef.current = true;
    void setRecallEnabled(on).then(() => {
      recallTogglePendingRef.current = false;
      if (on && deck) {
        for (const c of deck.cards) scheduleNewCard(deck.id, c.id);
      }
    });
  };

  // Cards added after Delayed Recall was turned on (or while scheduling was
  // broken) are scheduled when the deck page opens. Already scheduled cards
  // are skipped, and the server ignores duplicates.
  const recallCardIds = deck?.cards.map((c) => c.id).join(",") ?? "";
  useEffect(() => {
    if (!deck || !recallEnabled || recallTogglePendingRef.current) return;
    if (!isDelayedRecallHydrated()) return;
    for (const c of deck.cards) scheduleNewCard(deck.id, c.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck?.id, recallEnabled, recallCardIds, recallSummary]);

  const runGenerate = async (nextSeed: number) => {
    if (!deck || deck.cards.length === 0 || aiLoading) return;
    if (!isOnline) {
      setAiError(OFFLINE_AI_MESSAGE);
      return;
    }
    setAiLoading(true);
    setAiError("");
    const idempotencyKey = createAiIdempotencyKey();
    try {
      const { text } = await executeAiRequest(
        () =>
          generate({
            data: {
              idempotencyKey,
              words: deck.cards.map((c) => c.term),
              deckName: deck.name,
              seed: nextSeed,
              targetLanguage: deck.targetLanguage,
              definitionLanguage: deck.definitionLanguage,
            },
          }),
        "Could not generate the review text.",
      );
      setAiText(text);
      setAiSeed(nextSeed);
      setHighlightReviewWords(false);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Could not generate text");
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    setDidRetryLoad(false);
  }, [deckId]);

  useEffect(() => {
    setCoverColor(deck?.coverColor ?? null);
  }, [deck?.coverColor]);

  useEffect(() => {
    if (!isLoading && !isFetching && !deck && !didRetryLoad) {
      setDidRetryLoad(true);
      void refetchDecks();
    }
  }, [deck, didRetryLoad, isFetching, isLoading, refetchDecks]);

  const handleCoverColorChange = async (nextCoverColor: DeckCoverColor | null) => {
    if (!deck || nextCoverColor === coverColor || colorSaving) return;
    if (!isOnline) {
      setColorError(OFFLINE_SAVE_MESSAGE);
      return;
    }

    const previousCoverColor = coverColor;
    setCoverColor(nextCoverColor);
    setColorError("");
    setColorSaving(true);

    try {
      await updateDeckAsync(deck.id, deck.name, deck.description, nextCoverColor);
    } catch {
      setCoverColor(previousCoverColor);
      setColorError("Could not save deck color. Please try again.");
    } finally {
      setColorSaving(false);
    }
  };

  // Only show the skeleton while there is no deck to show yet. A background
  // refetch (after adding a card, on window focus) keeps the page mounted.
  if (!deck && (isLoading || isFetching || !didRetryLoad)) return <DeckLoading />;

  if (!deck) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h1 className="font-display text-3xl">Deck not found</h1>
          <Link to="/" className="mt-6 inline-block text-accent underline">
            Home
          </Link>
        </main>
      </div>
    );
  }

  const learningLanguage = getLearningLanguageOption(deck.targetLanguage);
  const definitionLanguage = getDefinitionLanguageFor(deck.targetLanguage, deck.definitionLanguage);

  const handleAdd = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!term.trim() || !def.trim() || deck.cards.length >= MAX_DECK_CARDS) return;
    if (!isOnline) {
      setAddError(OFFLINE_SAVE_MESSAGE);
      return;
    }
    setAddError("");
    addCard(deck.id, term.trim(), def.trim());
    setTerm("");
    setDef("");
  };

  const total = deck.cards.length;
  const known = deck.cards.filter((c) => c.known).length;
  const canAddCard = deck.cards.length < MAX_DECK_CARDS;
  const canSaveCard = isOnline && canAddCard;

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="mx-auto max-w-4xl px-6 py-10">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8"
        >
          <ArrowLeft className="h-4 w-4" /> All decks
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4 mb-10">
          <div>
            <h1 className="font-display text-5xl font-semibold tracking-tight">{deck.name}</h1>
            {deck.description && (
              <p className="mt-3 text-muted-foreground max-w-xl">{deck.description}</p>
            )}
            <p className="mt-4 text-sm text-muted-foreground">
              {total} {plural(total, ["card", "cards", "cards"])} · {known}{" "}
              {plural(known, ["learned", "learned", "learned"])}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="rounded-full">
                  <Palette className="h-4 w-4" /> Color
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72">
                <DeckColorPicker value={coverColor} onChange={handleCoverColorChange} />
                {colorSaving && (
                  <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Saving color...
                  </p>
                )}
                {!isOnline && (
                  <p className="mt-3 text-xs text-destructive">{OFFLINE_SAVE_MESSAGE}</p>
                )}
                {colorError && <p className="mt-3 text-xs text-destructive">{colorError}</p>}
              </PopoverContent>
            </Popover>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => resetProgress(deck.id)}
              disabled={!deck.cards.length}
            >
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => {
                exportDeckCsv(deck).catch(() => toast.error("Could not export the deck."));
              }}
              disabled={!deck.cards.length}
            >
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button
              className="rounded-full"
              onClick={() => navigate({ to: "/study/$deckId", params: { deckId: deck.id } })}
              disabled={!deck.cards.length}
            >
              <Play className="h-4 w-4" /> Study
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link to="/publish" search={{ type: "deck", id: deck.id }}>
                <Globe2 className="h-4 w-4" /> Publish
              </Link>
            </Button>
          </div>
        </div>

        {/* Delayed Recall */}
        <section className="mb-8 rounded-3xl border border-border bg-card p-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
            <div className="flex-1">
              <h2 className="font-display text-xl flex items-center gap-2">
                <Hourglass className="h-5 w-5 text-accent" /> Delayed Recall
              </h2>
              <p className="mt-1 text-sm text-muted-foreground max-w-xl">
                Improve long-term memory for this deck by reviewing its words at growing intervals
                (10 min · 1 d · 3 d · 7 d · 14 d · 30 d), instead of cramming them all at once.
              </p>
            </div>
            <label className="flex items-center gap-3 shrink-0 cursor-pointer">
              <span className="text-sm font-medium">{recallEnabled ? "ON" : "OFF"}</span>
              <Switch checked={recallEnabled} onCheckedChange={toggleRecall} />
            </label>
          </div>

          {recallEnabled && (
            <div className="animate-in fade-in slide-in-from-top-1 duration-300">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="rounded-2xl bg-background border border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">To review</p>
                  <p className="font-display text-2xl">{recallSummary.ready}</p>
                </div>
                <div className="rounded-2xl bg-background border border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">Upcoming</p>
                  <p className="font-display text-2xl">{recallSummary.upcoming}</p>
                </div>
                <div className="rounded-2xl bg-background border border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">Retention</p>
                  <p className="font-display text-2xl">
                    {recallSummary.retention !== null ? `${recallSummary.retention}%` : "—"}
                  </p>
                </div>
                <div className="rounded-2xl bg-background border border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">Mastered</p>
                  <p className="font-display text-2xl">{recallSummary.mastered}</p>
                </div>
              </div>
              {recallSummary.ready > 0 && (
                <div className="rounded-2xl bg-accent/10 text-foreground px-4 py-3 text-sm mb-4 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-accent" />
                  {recallSummary.ready} {recallSummary.ready === 1 ? "word ready" : "words ready"}{" "}
                  for recall — a session is waiting.
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  className="rounded-full"
                  onClick={() => navigate({ to: "/recall/$deckId", params: { deckId: deck.id } })}
                  disabled={recallSummary.ready === 0}
                >
                  <Hourglass className="h-4 w-4" /> Start session
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* Mode launcher */}
        {deck.cards.length > 0 && (
          <section className="mb-8 rounded-3xl border border-border bg-card p-6">
            <h2 className="font-display text-xl mb-4 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-accent" /> Study modes
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                {
                  to: "/type/$deckId",
                  icon: Keyboard,
                  title: "Typed translation",
                  desc: "Active recall with fuzzy matching.",
                },
                {
                  to: "/speed/$deckId",
                  icon: Zap,
                  title: "Speed challenge",
                  desc: "30/60/120 sec. Combos and records.",
                },
                {
                  to: "/reverse/$deckId",
                  icon: Repeat,
                  title: "Both directions",
                  desc: "Word to translation and back, weakest side first.",
                },
                {
                  to: "/deep/$deckId",
                  icon: Brain,
                  title: "Multiple Choice",
                  desc: "Choose the correct translation.",
                },
              ].map((m) => {
                const disabled = m.to === "/deep/$deckId" && !canPlayMultipleChoice(deck.cards);
                return (
                  <button
                    key={m.to}
                    disabled={disabled}
                    onClick={() => navigate({ to: m.to, params: { deckId: deck.id } } as never)}
                    className="text-left rounded-2xl border border-border bg-background hover:border-accent hover:bg-accent/5 px-4 py-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <m.icon className="h-5 w-5 text-accent mb-2" />
                    <p className="font-semibold">{m.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{m.desc}</p>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Performance analytics */}
        {deck.cards.length > 0 &&
          (() => {
            const weak = weakCardIds(deck.id).slice(0, 5);
            const answered = Object.values(stats);
            const totalCorrect = answered.reduce((s, x) => s + x.correct, 0);
            const totalWrong = answered.reduce((s, x) => s + x.wrong, 0);
            const acc =
              totalCorrect + totalWrong > 0
                ? Math.round((totalCorrect / (totalCorrect + totalWrong)) * 100)
                : null;
            const mastered = answered.filter((x) => x.mastery >= 0.75).length;
            return (
              <section className="mb-8 rounded-3xl border border-border bg-card p-6">
                <h2 className="font-display text-xl mb-4">Stats</h2>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="rounded-2xl bg-background border border-border px-4 py-3">
                    <p className="text-xs text-muted-foreground">Answers</p>
                    <p className="font-display text-2xl">{totalCorrect + totalWrong}</p>
                  </div>
                  <div className="rounded-2xl bg-background border border-border px-4 py-3">
                    <p className="text-xs text-muted-foreground">Accuracy</p>
                    <p className="font-display text-2xl">{acc !== null ? `${acc}%` : "—"}</p>
                  </div>
                  <div className="rounded-2xl bg-background border border-border px-4 py-3">
                    <p className="text-xs text-muted-foreground">Mastered</p>
                    <p className="font-display text-2xl">
                      {mastered}
                      <span className="text-base text-muted-foreground">
                        {" "}
                        / {deck.cards.length}
                      </span>
                    </p>
                  </div>
                </div>
                {weak.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold mb-2">Weak words</p>
                    <div className="flex flex-wrap gap-2">
                      {weak.map((id) => {
                        const c = deck.cards.find((x) => x.id === id);
                        if (!c) return null;
                        const a = accuracyFor(stats[id]);
                        return (
                          <span
                            key={id}
                            className="px-3 py-1 rounded-full bg-destructive/10 text-destructive text-xs"
                          >
                            {c.term}
                            {a !== null ? ` · ${a}%` : ""}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            );
          })()}

        {/* Add card */}
        <form onSubmit={handleAdd} className="rounded-3xl border border-border bg-card p-6 mb-10">
          <h2 className="font-display text-xl mb-4">Add card</h2>
          <div className="grid md:grid-cols-[1fr_1.4fr_auto] gap-3">
            <Input
              placeholder={`${learningLanguage.label} word`}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              disabled={!canSaveCard}
            />
            <Input
              placeholder={`${definitionLanguage.label} translation or definition`}
              value={def}
              onChange={(e) => setDef(e.target.value)}
              disabled={!canSaveCard}
            />
            <Button type="submit" className="rounded-full" disabled={!canSaveCard}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
          {!isOnline && <p className="mt-3 text-sm text-destructive">{OFFLINE_SAVE_MESSAGE}</p>}
          {addError && <p className="mt-3 text-sm text-destructive">{addError}</p>}
          {!canAddCard && (
            <p className="mt-3 text-sm text-muted-foreground">
              This deck already has the maximum of {MAX_DECK_CARDS} cards.
            </p>
          )}
        </form>

        {/* Cards list */}
        <div className="space-y-3">
          {deck.cards.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border p-12 text-center text-muted-foreground">
              Add your first card above to start studying.
            </div>
          ) : (
            deck.cards.map((card) => (
              <div
                key={card.id}
                className="rounded-2xl border border-border bg-card px-5 py-4 flex items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-display text-lg font-semibold truncate">{card.term}</p>
                  <p className="text-sm text-muted-foreground truncate">{card.definition}</p>
                </div>
                {card.known && (
                  <span className="text-xs px-2 py-1 rounded-full bg-[color:var(--success)]/15 text-[color:var(--success)] font-medium">
                    Learned
                  </span>
                )}
                <button
                  onClick={() => deleteCard(deck.id, card.id)}
                  className="h-9 w-9 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  aria-label="Delete card"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* AI text generator */}
        <section className="mt-12 rounded-3xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="font-display text-2xl flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-accent" /> Text for active review
              </h2>
              <p className="mt-1 text-sm text-muted-foreground max-w-xl">
                AI will write a short {learningLanguage.label} text using all words in the deck —
                read it and meet the words in living context.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                className="rounded-full"
                onClick={() => runGenerate(aiText ? aiSeed + 1 : 0)}
                disabled={!isOnline || aiLoading || deck.cards.length === 0}
              >
                {aiLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {aiText ? "Generate again" : "Generate"}
              </Button>
            </div>
          </div>

          {deck.cards.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Add at least one card to generate a text.
            </p>
          )}

          {!isOnline && (
            <div className="rounded-2xl bg-destructive/10 text-destructive px-4 py-3 text-sm">
              {OFFLINE_AI_MESSAGE}
            </div>
          )}

          {aiError && (
            <div className="rounded-2xl bg-destructive/10 text-destructive px-4 py-3 text-sm">
              {aiError}
            </div>
          )}

          {aiLoading && !aiText && (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
              Preparing text...
            </div>
          )}

          {aiText && (
            <div className="space-y-4">
              <article className="prose-like whitespace-pre-wrap font-body text-[15px] leading-relaxed text-foreground/90">
                {renderReviewText(
                  aiText,
                  deck.cards.map((card) => card.term),
                  highlightReviewWords,
                )}
              </article>
              <Button
                type="button"
                variant={highlightReviewWords ? "default" : "outline"}
                className="rounded-full"
                onClick={() => setHighlightReviewWords((enabled) => !enabled)}
              >
                <Highlighter className="h-4 w-4" />
                {highlightReviewWords ? "Hide deck words" : "Highlight deck words"}
              </Button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
