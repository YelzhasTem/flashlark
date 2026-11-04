import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDeck } from "@/lib/decks";
import type { LearningLanguage } from "@/lib/languages";
import { useServerFn } from "@tanstack/react-start";
import { recordStreakToday } from "@/lib/streak";
import { recordSelfReportedAnswer } from "@/lib/stats";
import { prepareStudySession, studyContentVersion } from "@/lib/study-session";
import { playCorrectSound, playWrongSound } from "@/lib/sounds";
import { useDeckShuffleEnabled } from "@/lib/shuffle-settings";
import { SiteHeader } from "@/components/SiteHeader";
import { StudyDeckFallback } from "@/components/StudyDeckFallback";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, X, Shuffle, RotateCcw, Repeat, Star, Volume2 } from "lucide-react";
import { SpeakButton } from "@/components/SpeakButton";
import { isSpeechSupported, speakAloud, stopSpeaking, useAutoSpeak } from "@/lib/speech";
import { rateDeck } from "@/lib/community.functions";

export const Route = createFileRoute("/study/$deckId")({
  component: StudyPage,
});

function shuffleList<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function StudyPage() {
  const { deckId } = Route.useParams();
  const { deck, markCard, resetProgress, isLoading, isFetching, isError, refetchDecks } =
    useDeck(deckId);
  const rateOriginalDeck = useServerFn(rateDeck);
  const [shuffleEnabled, setShuffleEnabled] = useDeckShuffleEnabled(deckId);
  const [autoSpeak, setAutoSpeak] = useAutoSpeak();
  const [speechSupported, setSpeechSupported] = useState(false);

  const [order, setOrder] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reverseSides, setReverseSides] = useState(false);
  const [rated, setRated] = useState(false);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionWrong, setSessionWrong] = useState(0);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const pendingRef = useRef(false);

  const queueSource = useMemo(
    () => (deck ? deck.cards.filter((c) => !c.known).map((c) => c.id) : []),
    [deck],
  );
  const deckCardsKey = deck?.cards.map((card) => card.id).join("|") ?? "";

  const buildOrder = (ids: string[]) => (shuffleEnabled ? shuffleList(ids) : ids);

  useEffect(() => {
    setOrder(buildOrder(queueSource));
    setIdx(0);
    setFlipped(false);
    setSessionCorrect(0);
    setSessionWrong(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, deckCardsKey]);

  useEffect(() => {
    if (!deck) return;
    void prepareStudySession(deck.id, "study", undefined, studyContentVersion(deck.cards)).catch(
      (error: unknown) =>
        setSaveError(error instanceof Error ? error.message : "Could not start this study session"),
    );
  }, [deck]);

  useEffect(() => {
    setOrder((prev) => {
      const set = new Set(queueSource);
      const kept = prev.filter((id) => set.has(id));
      const newOnes = queueSource.filter((id) => !prev.includes(id));
      if (kept.length === 0) return buildOrder(queueSource);
      return [...kept, ...(shuffleEnabled ? shuffleList(newOnes) : newOnes)];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueSource]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Shift") {
        if (e.repeat) return;
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowRight" || e.key === "2") {
        if (!e.repeat) handleKnown();
      } else if (e.key === "ArrowLeft" || e.key === "1") {
        if (!e.repeat) handleAgain();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, order, deck]);

  useEffect(() => {
    if (sessionCorrect + sessionWrong > 0) return;
    setOrder(buildOrder(queueSource));
    setIdx(0);
    setFlipped(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shuffleEnabled]);

  useEffect(() => {
    setSpeechSupported(isSpeechSupported());
    return () => stopSpeaking();
  }, []);

  // Auto-speak reads the side that is showing: the front when a card opens, the back on flip.
  const visibleCard = deck?.cards.find((c) => c.id === order[idx]);
  const visibleSpeech =
    visibleCard && deck ? cardSideSpeech(deck, visibleCard, reverseSides, flipped) : null;
  const visibleSpeechKey = visibleSpeech
    ? `${order[idx]}|${flipped}|${reverseSides}|${visibleSpeech.text}`
    : "";
  const lastSpokenKeyRef = useRef("");
  useEffect(() => {
    if (!autoSpeak || !visibleSpeech || visibleSpeechKey === lastSpokenKeyRef.current) return;
    // A short wait skips in-between states, such as the old card turning back to its front
    // for a moment after "Know it" before the next card shows.
    const timer = setTimeout(() => {
      lastSpokenKeyRef.current = visibleSpeechKey;
      void speakAloud(visibleSpeech.text, visibleSpeech.language);
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSpeak, visibleSpeechKey]);

  if (!deck) {
    return (
      <StudyDeckFallback
        loading={isLoading || (isFetching && !isError)}
        error={isError}
        onRetry={() => void refetchDecks()}
      />
    );
  }

  const currentId = order[idx];
  const current = deck.cards.find((c) => c.id === currentId);
  const total = deck.cards.length;
  const knownCount = deck.cards.filter((c) => c.known).length;
  const sessionAnswered = sessionCorrect + sessionWrong;
  const completedBeforeSession = total > 0 && knownCount === total && sessionAnswered === 0;
  const frontLabel = reverseSides ? "Translation" : "Word";
  const backLabel = reverseSides ? "Word" : "Translation";
  const frontText = current ? (reverseSides ? current.definition : current.term) : "";
  const backText = current ? (reverseSides ? current.term : current.definition) : "";
  const frontLanguage = reverseSides ? deck.definitionLanguage : deck.targetLanguage;
  const backLanguage = reverseSides ? deck.targetLanguage : deck.definitionLanguage;

  const toggleAutoSpeak = () => {
    const next = !autoSpeak;
    setAutoSpeak(next);
    if (!next) {
      stopSpeaking();
    } else if (visibleSpeech) {
      // Speaking inside the tap also unlocks speech on iOS for the cards that follow.
      lastSpokenKeyRef.current = visibleSpeechKey;
      void speakAloud(visibleSpeech.text, visibleSpeech.language);
    }
  };

  const handleKnown = async () => {
    if (!current || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setSaveError("");
    try {
      await recordSelfReportedAnswer({
        deckId: deck.id,
        cardId: current.id,
        mode: "study",
        direction: reverseSides ? "definition_to_term" : "term_to_definition",
        selfReportedResult: true,
      });
      playCorrectSound();
      setFlipped(false);
      setSessionCorrect((count) => count + 1);
      markCard(deck.id, current.id, true);
      recordStreakToday();
      // The card automatically leaves the queue through queueSource.
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save this answer");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const handleAgain = async () => {
    if (!current || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setSaveError("");
    try {
      await recordSelfReportedAnswer({
        deckId: deck.id,
        cardId: current.id,
        mode: "study",
        direction: reverseSides ? "definition_to_term" : "term_to_definition",
        selfReportedResult: false,
      });
      playWrongSound();
      setFlipped(false);
      setSessionWrong((count) => count + 1);
      const currentIndex = order.indexOf(current.id);
      setOrder((prev) => {
        if (prev.length <= 1 || currentIndex === -1) return prev;
        const next = [...prev];
        const [cur] = next.splice(currentIndex, 1);
        next.push(cur);
        return next;
      });
      if (order.length > 1 && currentIndex !== -1) {
        setIdx(currentIndex >= order.length - 1 ? 0 : currentIndex);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save this answer");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const toggleShuffle = () => {
    const nextShuffleEnabled = !shuffleEnabled;
    setShuffleEnabled(nextShuffleEnabled);
    if (nextShuffleEnabled) {
      setOrder((prev) => {
        const answered = prev.slice(0, idx);
        const remaining = prev.slice(idx);
        return [...answered, ...shuffleList(remaining)];
      });
    }
    setFlipped(false);
  };

  const startOver = () => {
    resetProgress(deck.id);
    setOrder(buildOrder(deck.cards.map((card) => card.id)));
    setIdx(0);
    setFlipped(false);
    setSessionCorrect(0);
    setSessionWrong(0);
  };

  const finished = !current && !completedBeforeSession;

  const onRateOriginal = async (rating: number) => {
    if (!deck?.sourceDeckId) return;
    await rateOriginalDeck({ data: { deckId: deck.sourceDeckId, rating } });
    setRated(true);
  };

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <Link
            to="/deck/$deckId"
            params={{ deckId: deck.id }}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> {deck.name}
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              aria-pressed={shuffleEnabled}
              variant={shuffleEnabled ? "secondary" : "ghost"}
              size="sm"
              className={`rounded-full ${shuffleEnabled ? "border border-accent bg-accent/10 text-accent hover:bg-accent/15" : ""}`}
              onClick={toggleShuffle}
            >
              <Shuffle className="h-4 w-4" /> Shuffle
            </Button>
            {speechSupported && (
              <Button
                aria-pressed={autoSpeak}
                variant={autoSpeak ? "secondary" : "ghost"}
                size="sm"
                className={`rounded-full ${autoSpeak ? "border border-accent bg-accent/10 text-accent hover:bg-accent/15" : ""}`}
                onClick={toggleAutoSpeak}
                title="Read each card aloud when it opens"
              >
                <Volume2 className="h-4 w-4" /> Auto-speak
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => {
                setReverseSides((value) => !value);
                setFlipped(false);
              }}
            >
              <Repeat className="h-4 w-4" /> Reverse sides
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => {
                if (window.confirm("Reset learned marks for every card in this deck?")) {
                  startOver();
                }
              }}
            >
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
          </div>
        </div>

        {/* Progress */}
        <div className="mb-8">
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span>
              {finished ? total : total - order.length + (idx + 1)} / {total}
            </span>
            <span>learned {knownCount}</span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{
                width: `${total ? (knownCount / total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        {completedBeforeSession && !current ? (
          <div className="rounded-3xl border border-border bg-card p-12 text-center">
            <h2 className="font-display text-3xl font-semibold">You know every card</h2>
            <p className="mt-3 text-muted-foreground">
              All {total} cards in this deck are marked as learned. Start over to study them again;
              this clears the learned marks.
            </p>
            <div className="mt-8 flex justify-center gap-3">
              <Button asChild variant="outline" className="rounded-full">
                <Link to="/deck/$deckId" params={{ deckId: deck.id }}>
                  Back to deck
                </Link>
              </Button>
              <Button className="rounded-full" onClick={startOver}>
                <RotateCcw className="h-4 w-4" /> Start over
              </Button>
            </div>
          </div>
        ) : finished ? (
          <div className="rounded-3xl border border-border bg-card p-12 text-center">
            <p className="text-5xl mb-4">🎉</p>
            <h2 className="font-display text-3xl font-semibold">Run complete</h2>
            <p className="mt-3 text-muted-foreground">
              You know {knownCount} of {total} cards.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Correct answers:{" "}
              <span className="font-semibold text-foreground">{sessionCorrect}</span>
              {sessionAnswered > 0 ? ` of ${sessionAnswered}` : ""}
            </p>
            <div className="mt-8 flex justify-center gap-3">
              <Button asChild variant="outline" className="rounded-full">
                <Link to="/deck/$deckId" params={{ deckId: deck.id }}>
                  Back to deck
                </Link>
              </Button>
              <Button className="rounded-full" onClick={startOver}>
                <RotateCcw className="h-4 w-4" /> Study again
              </Button>
            </div>
            {deck.sourceDeckId && (
              <div className="mx-auto mt-8 max-w-md rounded-2xl border border-border bg-background p-4">
                <p className="text-sm font-medium">Rate the original community deck</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This is optional, but helps other users find useful decks.
                </p>
                {rated ? (
                  <p className="mt-3 text-sm text-primary">Thanks, your rating was saved.</p>
                ) : (
                  <div className="mt-3 flex justify-center gap-1">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        onClick={() => onRateOriginal(value)}
                        className="rounded-full p-1 text-primary hover:bg-secondary"
                        aria-label={`Rate ${value}`}
                      >
                        <Star className="h-6 w-6" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Card */}
            <div className="flip-scene h-[420px] mb-8">
              <div
                // A new key per card mounts it unflipped with no transition, so
                // the next answer is never shown on the back while turning.
                key={`${idx}:${currentId}`}
                className={`flip-card cursor-pointer ${flipped ? "is-flipped" : ""}`}
                onClick={() => setFlipped((f) => !f)}
                role="button"
                aria-label="Flip card"
                aria-pressed={flipped}
              >
                <div
                  aria-hidden={flipped}
                  className="flip-face rounded-3xl bg-card border border-border/70 shadow-[var(--shadow-card)] flex flex-col items-center justify-center p-10 text-center"
                >
                  <SpeakButton
                    text={frontText}
                    language={frontLanguage}
                    tabIndex={flipped ? -1 : 0}
                    className="absolute right-4 top-4 text-muted-foreground"
                  />
                  <span className="text-xs uppercase tracking-[0.2em] text-accent font-semibold mb-6">
                    {frontLabel}
                  </span>
                  <p className="font-display text-5xl md:text-6xl font-extrabold leading-tight tracking-tight text-foreground wrap-anywhere">
                    {frontText}
                  </p>
                  <span className="mt-8 text-xs text-muted-foreground pointer-coarse:hidden">
                    Click the card or press Space / Shift to flip
                  </span>
                  <span className="mt-8 hidden text-xs text-muted-foreground pointer-coarse:inline">
                    Tap the card to flip
                  </span>
                </div>
                <div
                  aria-hidden={!flipped}
                  className="flip-face flip-face--back rounded-3xl bg-primary text-primary-foreground shadow-[var(--shadow-card)] flex flex-col items-center justify-center p-10 text-center"
                >
                  <SpeakButton
                    text={backText}
                    language={backLanguage}
                    tabIndex={flipped ? 0 : -1}
                    className="absolute right-4 top-4 hover:bg-white/10"
                  />
                  <span className="text-xs uppercase tracking-[0.2em] opacity-70 font-semibold mb-6">
                    {backLabel}
                  </span>
                  <p className="font-display text-3xl md:text-4xl font-bold leading-snug wrap-anywhere">
                    {backText}
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                size="lg"
                className="rounded-full h-14 text-base border-border hover:bg-destructive/5 hover:text-destructive hover:border-destructive/40"
                onClick={handleAgain}
                disabled={pending}
              >
                <X className="h-5 w-5" /> Try again
              </Button>
              <Button
                size="lg"
                className="rounded-full h-14 text-base bg-success text-white hover:bg-success/90"
                onClick={handleKnown}
                disabled={pending}
              >
                <Check className="h-5 w-5" /> Know it
              </Button>
            </div>

            {saveError && <p className="mt-3 text-sm text-destructive">{saveError}</p>}

            <p className="mt-6 text-center text-xs text-muted-foreground pointer-coarse:hidden">
              <kbd className="px-1.5 py-0.5 rounded bg-secondary">Space</kbd> /{" "}
              <kbd className="px-1.5 py-0.5 rounded bg-secondary">Shift</kbd> — flip ·{" "}
              <kbd className="px-1.5 py-0.5 rounded bg-secondary">←</kbd> again ·{" "}
              <kbd className="px-1.5 py-0.5 rounded bg-secondary">→</kbd> know it
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function cardSideSpeech(
  deck: { targetLanguage: LearningLanguage; definitionLanguage: LearningLanguage },
  card: { term: string; definition: string },
  reverseSides: boolean,
  flipped: boolean,
) {
  // Without reverse the front is the word and the back its translation.
  const showsTerm = reverseSides === flipped;
  return showsTerm
    ? { text: card.term, language: deck.targetLanguage }
    : { text: card.definition, language: deck.definitionLanguage };
}
