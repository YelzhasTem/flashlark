import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isUuid } from "@/lib/uuid";
import { accountLearningDb } from "@/lib/account-learning-db";
import { fetchAllPages } from "@/lib/paged-query";
import {
  completeStudySession,
  submitMultipleChoiceStudyAnswer,
  submitSelfReportedStudyAnswer,
  submitTextStudyAnswer,
  type IssuedStudyQuestion,
  type MultipleChoiceStudyMode,
  type SelfReportedStudyMode,
  type StudyAnswerResult,
  type StudyDirection,
  type TextStudyMode,
} from "@/lib/study-session";

export type CardStat = {
  correct: number;
  wrong: number;
  lastSeen: number;
  mastery: number;
  stage?: number;
  due?: number;
  avgMs?: number;
  totalMs?: number;
  samples?: number;
  slowMisses?: number;
};

export type DeckStats = Record<string, CardStat>;

const LEGACY_ASSOC_KEY = "lingocards.assoc.v1";
const MIGRATION_KEY = "lingocards.accountLearningMigrated.v1";

const statsCache: Record<string, DeckStats> = {};
let sessionCache: SessionAnswer[] = [];
let speedCache: SpeedRecord[] = [];
let assocCache: AssocMap = {};
let migrationStarted = false;

export const STAGE_NAMES = ["New", "Learning", "Reviewing", "Confident", "Mastered"] as const;

function dispatch(name: "stats:changed" | "speed:changed" | "assoc:changed" | "session:changed") {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(name));
}

function msFromIso(value?: string | null) {
  return value ? new Date(value).getTime() : undefined;
}

async function getUserId() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

function safeJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}

function rowToStat(row: {
  correct_count?: number;
  wrong_count?: number;
  last_seen_at?: string | null;
  mastery?: number | string;
  stage?: number;
  due_at?: string | null;
  avg_ms?: number | null;
  total_ms?: number | null;
  samples?: number | null;
  slow_misses?: number | null;
}): CardStat {
  return {
    correct: row.correct_count ?? 0,
    wrong: row.wrong_count ?? 0,
    lastSeen: msFromIso(row.last_seen_at) ?? 0,
    mastery: Number(row.mastery ?? 0),
    stage: row.stage ?? 0,
    due: msFromIso(row.due_at),
    avgMs: row.avg_ms ?? undefined,
    totalMs: row.total_ms ?? undefined,
    samples: row.samples ?? undefined,
    slowMisses: row.slow_misses ?? 0,
  };
}

async function migrateLegacyLearningData(userId: string) {
  if (typeof window === "undefined" || migrationStarted) return;
  if (localStorage.getItem(MIGRATION_KEY) === userId) return;
  migrationStarted = true;

  try {
    // Trusted progress can no longer be reconstructed from mutable browser data.
    // User-authored associations remain safe to import because they are subjective content.
    const legacyAssocs = safeJson<AssocMap>(LEGACY_ASSOC_KEY, {});
    const assocRows = Object.entries(legacyAssocs).flatMap(([cardId, list]) =>
      isUuid(cardId)
        ? list.map((assoc) => ({
            user_id: userId,
            card_id: cardId,
            text: assoc.text,
            source: assoc.source,
            favorite: assoc.favorite ?? false,
            created_at: new Date(assoc.at).toISOString(),
          }))
        : [],
    );
    if (assocRows.length > 0) {
      const { error } = await accountLearningDb().from("card_associations").insert(assocRows);
      if (error) throw new Error(error.message);
    }

    localStorage.setItem(MIGRATION_KEY, userId);
  } finally {
    migrationStarted = false;
  }
}

async function ensureMigrated() {
  const userId = await getUserId();
  if (!userId) return null;
  try {
    await migrateLegacyLearningData(userId);
  } catch (error) {
    console.warn("[Learning] Legacy migration skipped:", error);
  }
  return userId;
}

export async function hydrateDeckStats(deckId: string) {
  const userId = await ensureMigrated();
  if (!userId) {
    statsCache[deckId] = {};
    dispatch("stats:changed");
    return;
  }
  const { data, error } = await accountLearningDb()
    .from("card_progress")
    .select(
      "card_key, correct_count, wrong_count, last_seen_at, mastery, stage, due_at, avg_ms, total_ms, samples, slow_misses",
    )
    .eq("user_id", userId)
    .eq("deck_id", deckId);
  if (error) {
    console.warn("[Learning] Could not load progress:", error.message);
    return;
  }
  statsCache[deckId] = {};
  for (const row of data ?? []) {
    statsCache[deckId][row.card_key] = rowToStat(row);
  }
  dispatch("stats:changed");
}

function applyStudyAnswer(
  deckId: string,
  progressKey: string,
  responseMs?: number,
  result?: StudyAnswerResult,
) {
  if (!result) throw new Error("The server returned no study result");
  const event: SessionAnswer = {
    deckId,
    cardId: progressKey,
    correct: result.correct,
    ms: responseMs,
    at: Date.now(),
  };
  sessionCache = [...sessionCache, event].slice(-500);
  dispatch("session:changed");

  const deck = statsCache[deckId] ?? {};
  deck[progressKey] = {
    correct: result.correct_count,
    wrong: result.wrong_count,
    lastSeen: event.at,
    mastery: Number(result.mastery),
    stage: result.stage,
    due: msFromIso(result.due_at),
    avgMs: result.avg_ms ?? undefined,
    totalMs: result.total_ms ?? undefined,
    samples: result.samples ?? undefined,
    slowMisses: result.slow_misses,
  };
  statsCache[deckId] = deck;
  dispatch("stats:changed");
}

export async function recordTextAnswer(input: {
  deckId: string;
  cardId: string;
  mode: TextStudyMode;
  direction: StudyDirection;
  submittedAnswer: string;
  responseMs?: number;
}) {
  const result = await submitTextStudyAnswer(input);
  applyStudyAnswer(input.deckId, input.cardId, input.responseMs, result);
  return result;
}

export async function recordMultipleChoiceAnswer(input: {
  deckId: string;
  mode: MultipleChoiceStudyMode;
  question: IssuedStudyQuestion;
  selectedOptionId: string;
  responseMs?: number;
}) {
  const result = await submitMultipleChoiceStudyAnswer(input);
  applyStudyAnswer(input.deckId, input.question.cardId, input.responseMs, result);
  return result;
}

export async function recordSelfReportedAnswer(input: {
  deckId: string;
  cardId: string;
  mode: SelfReportedStudyMode;
  direction: StudyDirection;
  selfReportedResult: boolean;
  responseMs?: number;
}) {
  const result = await submitSelfReportedStudyAnswer(input);
  const progressKey =
    input.mode === "reverse" && input.direction === "definition_to_term"
      ? `${input.cardId}:rev`
      : input.cardId;
  applyStudyAnswer(input.deckId, progressKey, input.responseMs, result);
  return result;
}

export function getDeckStats(deckId: string): DeckStats {
  return statsCache[deckId] ?? {};
}

export function useDeckStats(deckId: string) {
  const [stats, setStats] = useState<DeckStats>({});
  useEffect(() => {
    const reload = () => setStats({ ...getDeckStats(deckId) });
    setStats({});
    void hydrateDeckStats(deckId);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void hydrateDeckStats(deckId);
      }
    });
    window.addEventListener("stats:changed", reload);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("stats:changed", reload);
    };
  }, [deckId]);
  return stats;
}

export function accuracyFor(stat?: CardStat) {
  if (!stat) return null;
  const total = stat.correct + stat.wrong;
  if (!total) return null;
  return Math.round((stat.correct / total) * 100);
}

export function weakCardIds(deckId: string): string[] {
  const stats = getDeckStats(deckId);
  return Object.entries(stats)
    .filter(([, s]) => (s.wrong > 0 || (s.slowMisses ?? 0) > 1) && s.mastery < 0.6)
    .sort((a, b) => a[1].mastery - b[1].mastery)
    .map(([id]) => id);
}

export function dueCardIds<T extends { id: string }>(deckId: string, cards: T[]): string[] {
  const stats = getDeckStats(deckId);
  const now = Date.now();
  const due: { id: string; score: number }[] = [];
  for (const c of cards) {
    const s = stats[c.id];
    if (!s) due.push({ id: c.id, score: -1 });
    else if ((s.due ?? 0) <= now) due.push({ id: c.id, score: s.mastery + (s.due ?? 0) / 1e13 });
  }
  return due.sort((a, b) => a.score - b.score).map((x) => x.id);
}

export function prioritise<T extends { id: string }>(deckId: string, cards: T[]): T[] {
  const stats = getDeckStats(deckId);
  return [...cards].sort((a, b) => {
    const ma = stats[a.id]?.mastery ?? 0.5;
    const mb = stats[b.id]?.mastery ?? 0.5;
    return ma - mb;
  });
}

export type SessionAnswer = {
  deckId: string;
  cardId: string;
  correct: boolean;
  ms?: number;
  at: number;
};

export async function hydrateSessionLog(deckId?: string, sinceMs = 1000 * 60 * 60 * 24) {
  const userId = await ensureMigrated();
  if (!userId) {
    sessionCache = [];
    dispatch("session:changed");
    return;
  }
  const cutoff = new Date(Date.now() - sinceMs).toISOString();
  // A busy day (several Speed runs) can pass the 1000 rows one request returns, and with an
  // ascending order the newest answers were the ones cut off, so events are paged.
  const { data, error } = await fetchAllPages((from, to) => {
    let query = accountLearningDb()
      .from("study_events")
      .select("id, deck_id, card_key, correct, response_ms, answered_at")
      .eq("user_id", userId)
      .gte("answered_at", cutoff);
    if (deckId) query = query.eq("deck_id", deckId);
    return query
      .order("answered_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
  });
  if (error) {
    console.warn("[Learning] Could not load study events:", error.message);
    return;
  }
  sessionCache = (data ?? []).map(
    (row: {
      deck_id: string;
      card_key: string;
      correct: boolean;
      response_ms?: number | null;
      answered_at: string;
    }) => ({
      deckId: row.deck_id,
      cardId: row.card_key,
      correct: row.correct,
      ms: row.response_ms ?? undefined,
      at: new Date(row.answered_at).getTime(),
    }),
  );
  dispatch("session:changed");
}

export function getSessionLog(deckId?: string, sinceMs = 1000 * 60 * 60 * 24): SessionAnswer[] {
  const cutoff = Date.now() - sinceMs;
  return sessionCache.filter((x) => x.at >= cutoff && (!deckId || x.deckId === deckId));
}

export function useSessionLog(deckId?: string, sinceMs = 1000 * 60 * 60 * 24) {
  const [list, setList] = useState<SessionAnswer[]>([]);
  useEffect(() => {
    const reload = () => setList(getSessionLog(deckId, sinceMs));
    setList([]);
    void hydrateSessionLog(deckId, sinceMs);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void hydrateSessionLog(deckId, sinceMs);
      }
    });
    window.addEventListener("session:changed", reload);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("session:changed", reload);
    };
  }, [deckId, sinceMs]);
  return list;
}

export type SpeedRecord = {
  deckId: string;
  duration: number;
  score: number;
  accuracy: number;
  at: number;
};

export function recordSpeedRun(deckId: string) {
  if (typeof window === "undefined") return;
  void completeStudySession(deckId, "speed")
    .then(() => hydrateSpeedRecords(deckId))
    .catch((error: unknown) => console.warn("[Learning] Could not complete speed run:", error));
}

export async function hydrateSpeedRecords(deckId?: string) {
  const userId = await ensureMigrated();
  if (!userId) {
    speedCache = [];
    dispatch("speed:changed");
    return;
  }
  let query = accountLearningDb()
    .from("speed_runs")
    .select("deck_id, duration, score, accuracy, created_at")
    .eq("user_id", userId)
    .order("score", { ascending: false })
    .limit(50);
  if (deckId) query = query.eq("deck_id", deckId);
  const { data, error } = await query;
  if (error) {
    console.warn("[Learning] Could not load speed records:", error.message);
    return;
  }
  speedCache = (data ?? []).map(
    (row: {
      deck_id: string;
      duration: number;
      score: number;
      accuracy: number;
      created_at: string;
    }) => ({
      deckId: row.deck_id,
      duration: row.duration,
      score: row.score,
      accuracy: row.accuracy,
      at: new Date(row.created_at).getTime(),
    }),
  );
  dispatch("speed:changed");
}

export function getSpeedRecords(deckId?: string): SpeedRecord[] {
  return deckId ? speedCache.filter((r) => r.deckId === deckId) : speedCache;
}

export function useSpeedRecords(deckId?: string) {
  const [records, setRecords] = useState<SpeedRecord[]>([]);
  useEffect(() => {
    const reload = () => setRecords(getSpeedRecords(deckId));
    setRecords([]);
    void hydrateSpeedRecords(deckId);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void hydrateSpeedRecords(deckId);
      }
    });
    window.addEventListener("speed:changed", reload);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("speed:changed", reload);
    };
  }, [deckId]);
  return records;
}

export type Assoc = { text: string; source: "ai" | "user"; favorite?: boolean; at: number };
type AssocMap = Record<string, Assoc[]>;

export async function hydrateAssocs(cardId: string) {
  if (!cardId || !isUuid(cardId)) return;
  const userId = await ensureMigrated();
  if (!userId) {
    assocCache = { ...assocCache, [cardId]: [] };
    dispatch("assoc:changed");
    return;
  }
  const { data, error } = await accountLearningDb()
    .from("card_associations")
    .select("text, source, favorite, created_at")
    .eq("user_id", userId)
    .eq("card_id", cardId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    console.warn("[Learning] Could not load associations:", error.message);
    return;
  }
  assocCache = {
    ...assocCache,
    [cardId]: (data ?? []).map((row) => ({
      text: row.text,
      source: row.source === "ai" ? "ai" : "user",
      favorite: row.favorite,
      at: new Date(row.created_at).getTime(),
    })),
  };
  dispatch("assoc:changed");
}

export function getAssocs(cardId: string): Assoc[] {
  return assocCache[cardId] ?? [];
}

export function addAssoc(cardId: string, a: Assoc) {
  assocCache = {
    ...assocCache,
    [cardId]: [a, ...(assocCache[cardId] ?? [])].slice(0, 10),
  };
  dispatch("assoc:changed");

  void (async () => {
    if (!isUuid(cardId)) return;
    const userId = await ensureMigrated();
    if (!userId) return;
    const { error } = await accountLearningDb()
      .from("card_associations")
      .insert({
        user_id: userId,
        card_id: cardId,
        text: a.text,
        source: a.source,
        favorite: a.favorite ?? false,
        created_at: new Date(a.at).toISOString(),
      });
    if (error) console.warn("[Learning] Could not save association:", error.message);
  })();
}

export function toggleFavoriteAssoc(cardId: string, idx: number) {
  const list = [...(assocCache[cardId] ?? [])];
  if (!list[idx]) return;
  list[idx] = { ...list[idx], favorite: !list[idx].favorite };
  assocCache = { ...assocCache, [cardId]: list };
  dispatch("assoc:changed");

  void (async () => {
    if (!isUuid(cardId)) return;
    const userId = await ensureMigrated();
    if (!userId) return;
    const target = list[idx];
    const { error } = await accountLearningDb()
      .from("card_associations")
      .update({ favorite: target.favorite ?? false })
      .eq("user_id", userId)
      .eq("card_id", cardId)
      .eq("text", target.text);
    if (error) console.warn("[Learning] Could not update association:", error.message);
  })();
}

export function removeAssoc(cardId: string, idx: number) {
  const list = [...(assocCache[cardId] ?? [])];
  const [removed] = list.splice(idx, 1);
  assocCache = { ...assocCache, [cardId]: list };
  dispatch("assoc:changed");

  void (async () => {
    if (!removed || !isUuid(cardId)) return;
    const userId = await ensureMigrated();
    if (!userId) return;
    const { error } = await accountLearningDb()
      .from("card_associations")
      .delete()
      .eq("user_id", userId)
      .eq("card_id", cardId)
      .eq("text", removed.text);
    if (error) console.warn("[Learning] Could not delete association:", error.message);
  })();
}

export function useAssocs(cardId: string) {
  const [list, setList] = useState<Assoc[]>([]);
  useEffect(() => {
    const reload = () => setList(getAssocs(cardId));
    setList([]);
    void hydrateAssocs(cardId);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void hydrateAssocs(cardId);
      }
    });
    window.addEventListener("assoc:changed", reload);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("assoc:changed", reload);
    };
  }, [cardId]);
  return list;
}
