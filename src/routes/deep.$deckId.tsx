import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { canPlayMultipleChoice } from "@/lib/multiple-choice";
import { useDeck, type Card } from "@/lib/decks";
import { recordStreakToday } from "@/lib/streak";
import { recordMultipleChoiceAnswer } from "@/lib/stats";
import {
  beginStudySession,
  issueStudyQuestion,
  prepareStudySession,
  studyContentVersion,
  type IssuedStudyQuestion,
  type StudyDirection,
} from "@/lib/study-session";
import { playCorrectSound, playWrongSound } from "@/lib/sounds";
import { useDeckShuffleEnabled } from "@/lib/shuffle-settings";
import { SiteHeader } from "@/components/SiteHeader";
import { StudyDeckFallback } from "@/components/StudyDeckFallback";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Brain, Check, RotateCcw, X, Repeat, Shuffle } from "lucide-react";

export const Route = createFileRoute("/deep/$deckId")({
  component: DeepPage,
});

type Question = {
  card: Card;
  key: string;
  direction: StudyDirection;
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQuestions(
  cards: Card[],
  reverseSides: boolean,
  shuffleQuestions: boolean,
): Question[] {
  const orderedCards = shuffleQuestions ? shuffle(cards) : cards;
  return orderedCards.map((card) => ({
    card,
    key: crypto.randomUUID(),
    direction: reverseSides ? "definition_to_term" : "term_to_definition",
  }));
}

function DeepPage() {
  const { deckId } = Route.useParams();
  const { deck, isLoading, isFetching, isError, refetchDecks } = useDeck(deckId);
  const [shuffleEnabled, setShuffleEnabled] = useDeckShuffleEnabled(deckId);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [correctOptionId, setCorrectOptionId] = useState<string | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [reverseSides, setReverseSides] = useState(false);
  const [issued, setIssued] = useState<Record<string, IssuedStudyQuestion>>({});
  const [answerPending, setAnswerPending] = useState(false);
  const [questionError, setQuestionError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const loadingQuestionKeys = useRef(new Set<string>());

  const canPlay = useMemo(() => !!deck && canPlayMultipleChoice(deck.cards), [deck]);

  useEffect(() => {
    if (deck && canPlay) {
      void prepareStudySession(deck.id, "deep", undefined, studyContentVersion(deck.cards)).catch(
        (error: unknown) =>
          setQuestionError(error instanceof Error ? error.message : "Could not start this session"),
      );
      setQuestions(buildQuestions(deck.cards, reverseSides, shuffleEnabled));
      setIdx(0);
      setPicked(null);
      setCorrectOptionId(null);
      setIssued({});
      setCorrectCount(0);
      setWrongCount(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, deck?.cards.length, canPlay]);

  useEffect(() => {
    if (!deck || !canPlay || correctCount > 0 || wrongCount > 0 || picked !== null) return;
    setQuestions(buildQuestions(deck.cards, reverseSides, shuffleEnabled));
    setIdx(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shuffleEnabled]);

  useEffect(() => {
    for (const question of questions.slice(idx, idx + 2)) {
      if (issued[question.key] || loadingQuestionKeys.current.has(question.key)) continue;
      loadingQuestionKeys.current.add(question.key);
      void issueStudyQuestion({
        deckId,
        cardId: question.card.id,
        mode: "deep",
        direction: question.direction,
        questionKey: question.key,
      })
        .then((serverQuestion) => {
          setIssued((current) => ({ ...current, [question.key]: serverQuestion }));
          setQuestionError("");
        })
        .catch((error: unknown) =>
          setQuestionError(error instanceof Error ? error.message : "Could not load this question"),
        )
        .finally(() => loadingQuestionKeys.current.delete(question.key));
    }
  }, [deckId, idx, issued, questions, retryNonce]);

  if (!deck) {
    return (
      <StudyDeckFallback
        loading={isLoading || (isFetching && !isError)}
        error={isError}
        onRetry={() => void refetchDecks()}
      />
    );
  }

  const restart = async () => {
    setQuestionError("");
    try {
      await beginStudySession(deck.id, "deep");
      setQuestions(buildQuestions(deck.cards, reverseSides, shuffleEnabled));
      setIdx(0);
      setPicked(null);
      setCorrectOptionId(null);
      setIssued({});
      loadingQuestionKeys.current.clear();
      setCorrectCount(0);
      setWrongCount(0);
    } catch (error) {
      setQuestionError(error instanceof Error ? error.message : "Could not restart this session");
    }
  };

  const toggleShuffle = () => {
    const nextShuffleEnabled = !shuffleEnabled;
    setShuffleEnabled(nextShuffleEnabled);
    setQuestions((currentQuestions) => {
      const answered = currentQuestions.slice(0, idx);
      const remainingCards = currentQuestions.slice(idx).map((question) => question.card);
      return [...answered, ...buildQuestions(remainingCards, reverseSides, nextShuffleEnabled)];
    });
    setPicked(null);
    setCorrectOptionId(null);
  };

  const toggleReverseSides = () => {
    const nextReverseSides = !reverseSides;
    setReverseSides(nextReverseSides);
    setQuestions((currentQuestions) => {
      const answered = currentQuestions.slice(0, idx);
      const remainingCards = currentQuestions.slice(idx).map((question) => question.card);
      return [...answered, ...buildQuestions(remainingCards, nextReverseSides, shuffleEnabled)];
    });
    setPicked(null);
    setCorrectOptionId(null);
  };

  const currentSeed = questions[idx];
  const current = currentSeed ? issued[currentSeed.key] : undefined;

  const handlePick = async (selectedOptionId: string) => {
    if (!current || picked !== null || answerPending) return;
    setAnswerPending(true);
    setQuestionError("");
    try {
      const result = await recordMultipleChoiceAnswer({
        deckId: deck.id,
        mode: "deep",
        question: current,
        selectedOptionId,
      });
      setPicked(selectedOptionId);
      setCorrectOptionId(result.correct_option_id);
      if (result.correct) {
        playCorrectSound();
        setCorrectCount((count) => count + 1);
      } else {
        playWrongSound();
        setWrongCount((count) => count + 1);
      }
      recordStreakToday();
    } catch (error) {
      setQuestionError(error instanceof Error ? error.message : "Could not check this answer");
    } finally {
      setAnswerPending(false);
    }
  };

  const next = () => {
    setPicked(null);
    setCorrectOptionId(null);
    setQuestionError("");
    setIdx((i) => i + 1);
  };

  const finished = questions.length > 0 && idx >= questions.length;
  const total = questions.length;

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
            <span className="inline-flex items-center gap-1.5 text-sm text-accent font-medium">
              <Brain className="h-4 w-4" /> Multiple Choice
            </span>
            <Button
              type="button"
              aria-pressed={shuffleEnabled}
              variant={shuffleEnabled ? "secondary" : "ghost"}
              size="sm"
              className={`rounded-full ${shuffleEnabled ? "border border-accent bg-accent/10 text-accent hover:bg-accent/15" : ""}`}
              onClick={toggleShuffle}
              disabled={picked !== null || answerPending}
            >
              <Shuffle className="h-4 w-4" /> Shuffle
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={toggleReverseSides}
              disabled={picked !== null || answerPending}
            >
              <Repeat className="h-4 w-4" /> Reverse sides
            </Button>
          </div>
        </div>

        {!canPlay ? (
          <div className="rounded-3xl border border-dashed border-border p-12 text-center text-muted-foreground">
            This mode needs at least 4 cards with different answers.
          </div>
        ) : finished ? (
          <div className="rounded-3xl border border-border bg-card p-12 text-center">
            <p className="text-5xl mb-4">🧠</p>
            <h2 className="font-display text-3xl font-semibold">Round complete</h2>
            <p className="mt-3 text-muted-foreground">
              Correct: {correctCount} of {total}
            </p>
            <div className="mt-8 flex justify-center gap-3">
              <Button asChild variant="outline" className="rounded-full">
                <Link to="/deck/$deckId" params={{ deckId: deck.id }}>
                  Back to deck
                </Link>
              </Button>
              <Button className="rounded-full" onClick={restart}>
                <RotateCcw className="h-4 w-4" /> Try again
              </Button>
            </div>
          </div>
        ) : current ? (
          <>
            <div className="mb-8">
              <div className="flex justify-between text-xs text-muted-foreground mb-2">
                <span>
                  {idx + 1} / {total}
                </span>
                <span>
                  <span className="text-[color:var(--success)]">✓ {correctCount}</span> ·{" "}
                  <span className="text-destructive">✗ {wrongCount}</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${(idx / total) * 100}%` }}
                />
              </div>
            </div>

            <div className="rounded-3xl bg-card border border-border/70 shadow-[var(--shadow-card)] p-10 text-center mb-6">
              <span className="text-xs uppercase tracking-[0.2em] text-accent font-semibold">
                {reverseSides ? "Choose the word" : "Choose the translation"}
              </span>
              <p className="mt-6 font-display text-5xl md:text-6xl font-extrabold leading-tight tracking-tight wrap-anywhere">
                {current.prompt}
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              {current.options.map((option, i) => {
                const isCorrect = option.id === correctOptionId;
                const isPicked = picked === option.id;
                const showState = picked !== null;
                const stateClass = !showState
                  ? "border-border bg-card hover:border-accent hover:bg-accent/5"
                  : isCorrect
                    ? "border-[color:var(--success)] bg-[color:var(--success)]/10 text-foreground"
                    : isPicked
                      ? "border-destructive bg-destructive/10 text-foreground"
                      : "border-border bg-card opacity-60";
                return (
                  <button
                    key={option.id}
                    onClick={() => handlePick(option.id)}
                    disabled={picked !== null || answerPending}
                    className={`text-left rounded-2xl border-2 px-5 py-4 transition-all flex items-center gap-3 ${stateClass}`}
                  >
                    <span className="h-7 w-7 shrink-0 rounded-full bg-secondary text-xs font-semibold inline-flex items-center justify-center">
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span className="flex-1 font-body text-[15px]">{option.text}</span>
                    {showState && isCorrect && (
                      <Check className="h-5 w-5 text-[color:var(--success)]" />
                    )}
                    {showState && isPicked && !isCorrect && (
                      <X className="h-5 w-5 text-destructive" />
                    )}
                  </button>
                );
              })}
            </div>

            {questionError && <p className="mt-4 text-sm text-destructive">{questionError}</p>}

            {picked !== null && (
              <div className="mt-6 flex justify-end">
                <Button className="rounded-full" onClick={next}>
                  {idx + 1 < total ? "Next" : "Finish"}
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="py-16 text-center text-sm text-muted-foreground">
            {questionError ? (
              <>
                <p className="text-destructive">{questionError}</p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 rounded-full"
                  onClick={() => {
                    setQuestionError("");
                    setRetryNonce((value) => value + 1);
                  }}
                >
                  Try again
                </Button>
              </>
            ) : (
              "Loading question..."
            )}
          </div>
        )}
      </main>
    </div>
  );
}
