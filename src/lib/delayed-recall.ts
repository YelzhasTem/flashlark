import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isUuid } from "@/lib/uuid";
import { accountLearningDb } from "@/lib/account-learning-db";
import { fetchAllPages } from "@/lib/paged-query";
import { submitTextStudyAnswer, type StudyDirection } from "@/lib/study-session";

// ===== Deck-level settings =====
const LEGACY_ENABLED_DECKS_KEY = "lingocards.delayedRecall.enabledDecks.v1";
const MIGRATION_KEY = "lingocards.accountDelayedRecallMigrated.v1";

const enabledDeckIds = new Set<string>();
let recallState: State = {};
let hydrated = false;
let hydrationStarted = false;
let migrationStarted = false;

function dispatchChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("delayedRecall:changed"));
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

async function migrateLegacyRecallData(userId: string) {
  if (typeof window === "undefined" || migrationStarted) return;
  if (localStorage.getItem(MIGRATION_KEY) === userId) return;
  migrationStarted = true;

  try {
    const legacyEnabled = safeJson<string[]>(LEGACY_ENABLED_DECKS_KEY, []);
    const settingsRows = legacyEnabled
      .filter((deckId) => typeof deckId === "string" && isUuid(deckId))
      .map((deckId) => ({
        user_id: userId,
        deck_id: deckId,
        delayed_recall_enabled: true,
        updated_at: new Date().toISOString(),
      }));

    if (settingsRows.length > 0) {
      const { error } = await accountLearningDb()
        .from("deck_learning_settings")
        .upsert(settingsRows, {
          onConflict: "user_id,deck_id",
        });
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
    await migrateLegacyRecallData(userId);
  } catch (error) {
    console.warn("[Delayed Recall] Legacy migration skipped:", error);
  }
  return userId;
}

export async function hydrateDelayedRecallState() {
  if (hydrationStarted) return;
  hydrationStarted = true;
  const userId = await ensureMigrated();
  if (!userId) {
    enabledDeckIds.clear();
    recallState = {};
    hydrated = true;
    hydrationStarted = false;
    dispatchChanged();
    return;
  }

  const [{ data: settings, error: settingsError }, { data: entries, error: entriesError }] =
    await Promise.all([
      accountLearningDb()
        .from("deck_learning_settings")
        .select("deck_id, delayed_recall_enabled")
        .eq("user_id", userId)
        .eq("delayed_recall_enabled", true),
      // Every card ever scheduled across all decks: can pass the 1000-row page limit.
      fetchAllPages((from, to) =>
        accountLearningDb()
          .from("delayed_recall_entries")
          .select(
            "deck_id, card_id, score, stage_idx, interval_idx, due_at, correct_count, wrong_count, created_at, last_review_at",
          )
          .eq("user_id", userId)
          .order("deck_id", { ascending: true })
          .order("card_id", { ascending: true })
          .range(from, to),
      ),
    ]);

  if (settingsError || entriesError) {
    // Keep the last known state rather than making every deck look switched
    // off or empty after one failed request; the next hydration retries.
    console.warn(
      "[Delayed Recall] Could not load recall state:",
      (settingsError ?? entriesError)?.message,
    );
    hydrationStarted = false;
    if (!hydrated) {
      hydrated = true;
      dispatchChanged();
    }
    return;
  }

  enabledDeckIds.clear();
  for (const row of settings ?? []) {
    if (row.delayed_recall_enabled) enabledDeckIds.add(row.deck_id);
  }

  recallState = {};
  for (const row of entries ?? []) {
    const entry = rowToEntry(row);
    recallState[k(entry.deckId, entry.cardId)] = entry;
  }

  hydrated = true;
  hydrationStarted = false;
  dispatchChanged();
}

export function isDeckDelayedRecallEnabled(deckId: string): boolean {
  return enabledDeckIds.has(deckId);
}

/**
 * Resolves once the setting is saved, so callers can schedule cards after the
 * server knows the deck has Delayed Recall on (schedule_recall_card refuses
 * cards of decks where it is off).
 */
export function setDeckDelayedRecallEnabled(deckId: string, on: boolean): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (on) enabledDeckIds.add(deckId);
  else enabledDeckIds.delete(deckId);
  dispatchChanged();

  return (async () => {
    const userId = await ensureMigrated();
    if (!userId) return;
    const { error } = await accountLearningDb().from("deck_learning_settings").upsert(
      {
        user_id: userId,
        deck_id: deckId,
        delayed_recall_enabled: on,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,deck_id" },
    );
    if (error) console.warn("[Delayed Recall] Could not save setting:", error.message);
  })();
}

export function useDeckDelayedRecallEnabled(
  deckId: string,
): [boolean, (v: boolean) => Promise<void>, boolean] {
  const [on, setOn] = useState<boolean>(false);
  // False until the account's settings have loaded, so pages can tell
  // "turned off" apart from "not known yet".
  const [ready, setReady] = useState<boolean>(false);
  useEffect(() => {
    const sync = () => {
      setOn(isDeckDelayedRecallEnabled(deckId));
      setReady(hydrated);
    };
    sync();
    void hydrateDelayedRecallState();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        hydrated = false;
        void hydrateDelayedRecallState();
      }
    });
    window.addEventListener("delayedRecall:changed", sync);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("delayedRecall:changed", sync);
    };
  }, [deckId]);
  return [on, (v: boolean) => setDeckDelayedRecallEnabled(deckId, v), ready];
}

// ===== Schedule + memory model =====
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Configurable intervals (in ms) for stages 0..5
export const RECALL_INTERVALS = [10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY];

export const RECALL_STAGES = ["New", "Learning", "Remembered", "Confident", "Mastered"] as const;
export type RecallStageIdx = 0 | 1 | 2 | 3 | 4;

export type RecallEntry = {
  cardId: string;
  deckId: string;
  score: number; // 0..100
  stageIdx: RecallStageIdx;
  intervalIdx: number; // index into RECALL_INTERVALS
  due: number; // ms timestamp
  correct: number;
  wrong: number;
  createdAt: number;
  lastReview?: number;
};

type State = Record<string, RecallEntry>; // key = `${deckId}:${cardId}`

const k = (d: string, c: string) => `${d}:${c}`;

function stageFromScore(score: number): RecallStageIdx {
  if (score >= 90) return 4;
  if (score >= 70) return 3;
  if (score >= 45) return 2;
  if (score > 0) return 1;
  return 0;
}

function rowToEntry(row: {
  deck_id: string;
  card_id: string;
  score?: number | null;
  stage_idx?: number | null;
  interval_idx?: number | null;
  due_at?: string | null;
  correct_count?: number | null;
  wrong_count?: number | null;
  created_at?: string | null;
  last_review_at?: string | null;
}): RecallEntry {
  const score = row.score ?? 0;
  return {
    deckId: row.deck_id,
    cardId: row.card_id,
    score,
    stageIdx: Math.min(4, Math.max(0, row.stage_idx ?? stageFromScore(score))) as RecallStageIdx,
    intervalIdx: Math.min(RECALL_INTERVALS.length - 1, Math.max(0, row.interval_idx ?? 0)),
    due: msFromIso(row.due_at) ?? Date.now(),
    correct: row.correct_count ?? 0,
    wrong: row.wrong_count ?? 0,
    createdAt: msFromIso(row.created_at) ?? Date.now(),
    lastReview: msFromIso(row.last_review_at),
  };
}

const schedulingKeys = new Set<string>();

export function isDelayedRecallHydrated() {
  return hydrated;
}

export function scheduleNewCard(deckId: string, cardId: string) {
  if (!isDeckDelayedRecallEnabled(deckId) || !isUuid(cardId)) return;
  const key = k(deckId, cardId);
  if (recallState[key] || schedulingKeys.has(key)) return;
  schedulingKeys.add(key);
  void (async () => {
    try {
      const { error } = await supabase.rpc("schedule_recall_card", { p_card_id: cardId });
      if (error) throw new Error(error.message);
      await hydrateDelayedRecallState();
    } catch (error) {
      console.warn("[Delayed Recall] Could not schedule card:", error);
    } finally {
      schedulingKeys.delete(key);
    }
  })();
}

export async function recordRecallAnswer(
  deckId: string,
  cardId: string,
  submittedAnswer: string,
  direction: StudyDirection,
) {
  if (!isDeckDelayedRecallEnabled(deckId) || !isUuid(cardId)) {
    throw new Error("Delayed Recall is not available for this card");
  }
  const key = k(deckId, cardId);
  try {
    const result = await submitTextStudyAnswer({
      deckId,
      cardId,
      mode: "recall",
      direction,
      submittedAnswer,
    });
    if (
      result.recall_score === null ||
      result.recall_stage_idx === null ||
      result.recall_interval_idx === null ||
      result.recall_due_at === null ||
      result.recall_correct_count === null ||
      result.recall_wrong_count === null
    ) {
      throw new Error("Trusted recall result was incomplete");
    }
    const previous = recallState[key];
    const now = Date.now();
    recallState[key] = {
      cardId,
      deckId,
      score: result.recall_score,
      stageIdx: Math.min(4, Math.max(0, result.recall_stage_idx)) as RecallStageIdx,
      intervalIdx: result.recall_interval_idx,
      due: new Date(result.recall_due_at).getTime(),
      correct: result.recall_correct_count,
      wrong: result.recall_wrong_count,
      createdAt: previous?.createdAt ?? now,
      lastReview: now,
    };
    dispatchChanged();
    return result;
  } catch (error) {
    void hydrateDelayedRecallState();
    throw error;
  }
}

export function getDeckRecall(deckId: string): RecallEntry[] {
  if (!isDeckDelayedRecallEnabled(deckId)) return [];
  return Object.values(recallState).filter((e) => e.deckId === deckId);
}

export function dueRecallEntries(deckId: string): RecallEntry[] {
  const now = Date.now();
  return getDeckRecall(deckId).filter((e) => e.due <= now);
}

export function upcomingRecallEntries(deckId: string): RecallEntry[] {
  const now = Date.now();
  return getDeckRecall(deckId)
    .filter((e) => e.due > now)
    .sort((a, b) => a.due - b.due);
}

export type RecallSummary = {
  ready: number;
  upcoming: number;
  mastered: number;
  retention: number | null; // percent or null
  total: number;
};

export function summariseRecall(deckId: string): RecallSummary {
  const entries = getDeckRecall(deckId);
  const now = Date.now();
  const ready = entries.filter((e) => e.due <= now).length;
  const upcoming = entries.filter((e) => e.due > now).length;
  const mastered = entries.filter((e) => e.stageIdx === 4).length;
  const totalAns = entries.reduce((s, e) => s + e.correct + e.wrong, 0);
  const totalCorrect = entries.reduce((s, e) => s + e.correct, 0);
  const retention = totalAns > 0 ? Math.round((totalCorrect / totalAns) * 100) : null;
  return { ready, upcoming, mastered, retention, total: entries.length };
}

export function summariseAllRecall(): RecallSummary & { nextDue: number | null } {
  const entries = Object.values(recallState).filter((e) => enabledDeckIds.has(e.deckId));
  const now = Date.now();
  const ready = entries.filter((e) => e.due <= now).length;
  const upcoming = entries.filter((e) => e.due > now).length;
  const mastered = entries.filter((e) => e.stageIdx === 4).length;
  const totalAns = entries.reduce((s, e) => s + e.correct + e.wrong, 0);
  const totalCorrect = entries.reduce((s, e) => s + e.correct, 0);
  const retention = totalAns > 0 ? Math.round((totalCorrect / totalAns) * 100) : null;
  const upcomingEntries = entries.filter((e) => e.due > now);
  const nextDue = upcomingEntries.length ? Math.min(...upcomingEntries.map((e) => e.due)) : null;
  return { ready, upcoming, mastered, retention, total: entries.length, nextDue };
}

export function decksWithReadyRecall(): { deckId: string; count: number; firstDue: number }[] {
  const entries = Object.values(recallState).filter((e) => enabledDeckIds.has(e.deckId));
  const now = Date.now();
  const map = new Map<string, { count: number; firstDue: number }>();
  entries.forEach((e) => {
    if (e.due > now) return;
    const current = map.get(e.deckId);
    map.set(e.deckId, {
      count: (current?.count ?? 0) + 1,
      firstDue: Math.min(current?.firstDue ?? e.due, e.due),
    });
  });
  return Array.from(map.entries())
    .map(([deckId, value]) => ({ deckId, count: value.count, firstDue: value.firstDue }))
    .sort((a, b) => a.firstDue - b.firstDue);
}

export function useDeckRecallSummary(deckId: string): RecallSummary {
  const [summary, setSummary] = useState<RecallSummary>(() => ({
    ready: 0,
    upcoming: 0,
    mastered: 0,
    retention: null,
    total: 0,
  }));
  useEffect(() => {
    const reload = () => setSummary(summariseRecall(deckId));
    reload();
    if (!hydrated) void hydrateDelayedRecallState();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        hydrated = false;
        void hydrateDelayedRecallState();
      }
    });
    const id = window.setInterval(reload, 30000);
    window.addEventListener("delayedRecall:changed", reload);
    return () => {
      sub.subscription.unsubscribe();
      clearInterval(id);
      window.removeEventListener("delayedRecall:changed", reload);
    };
  }, [deckId]);
  return summary;
}

export function useAllRecallSummary(): RecallSummary & { nextDue: number | null } {
  const [summary, setSummary] = useState<RecallSummary & { nextDue: number | null }>(() => ({
    ready: 0,
    upcoming: 0,
    mastered: 0,
    retention: null,
    total: 0,
    nextDue: null,
  }));
  useEffect(() => {
    const reload = () => setSummary(summariseAllRecall());
    reload();
    if (!hydrated) void hydrateDelayedRecallState();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        hydrated = false;
        void hydrateDelayedRecallState();
      }
    });
    const id = window.setInterval(reload, 30000);
    window.addEventListener("delayedRecall:changed", reload);
    return () => {
      sub.subscription.unsubscribe();
      clearInterval(id);
      window.removeEventListener("delayedRecall:changed", reload);
    };
  }, []);
  return summary;
}

export function formatDueIn(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return "now";
  if (diff < HOUR) return `in ${Math.max(1, Math.round(diff / MIN))} min`;
  if (diff < DAY) return `in ${Math.round(diff / HOUR)} h`;
  return `in ${Math.round(diff / DAY)} d`;
}
