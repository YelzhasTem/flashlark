import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DECK_COVER_COLOR_VALUES } from "@/lib/deck-colors";
import { getDeckCreationErrorMessage } from "@/lib/deck-creation-errors";
import {
  getDefinitionLanguageFor,
  LEARNING_LANGUAGE_CODES,
  normalizeDefinitionLanguage,
} from "@/lib/languages";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchAllPages } from "@/lib/paged-query";

const MIN_DECK_CARDS = 1;
const MAX_DECK_CARDS = 100;

const CardInput = z.object({
  term: z.string().trim().min(1).max(160),
  definition: z.string().trim().min(1).max(300),
});
const DeckCoverColorInput = z.enum(DECK_COVER_COLOR_VALUES).optional().nullable();
const LearningLanguageInput = z.enum(LEARNING_LANGUAGE_CODES).default("en");

export const getMyDecks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const decksRes = await supabase
      .from("decks")
      .select(
        "id, name, description, cover_color, target_language, definition_language, created_at, updated_at, visibility, category, keywords, learner_count, like_count, rating_sum, rating_count, published_at, source_deck_id",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    // A library can hold more than the 1000 rows one request returns, so cards are paged.
    const cardsRes = await fetchAllPages((from, to) =>
      supabase
        .from("cards")
        .select("id, deck_id, term, definition, known, position, created_at")
        .eq("user_id", userId)
        // Positions can tie (after a delete and an add). Without a tiebreak a refetch, which
        // happens on every app resume, may return tied cards in a new order and restart a study
        // run. The id tiebreak also keeps pages from overlapping.
        .order("position", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );

    if (decksRes.error) throw new Error(decksRes.error.message);
    if (cardsRes.error) throw new Error(cardsRes.error.message);

    return { decks: decksRes.data ?? [], cards: cardsRes.data };
  });

export const createDeckWithCardsRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(300).default(""),
        coverColor: DeckCoverColorInput,
        targetLanguage: LearningLanguageInput,
        definitionLanguage: LearningLanguageInput.optional(),
        cards: z.array(CardInput).min(MIN_DECK_CARDS).max(MAX_DECK_CARDS),
        collectionId: z.string().uuid().optional().nullable(),
        useDefaultCollection: z.boolean().default(true),
        idempotencyKey: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const targetLanguage = data.targetLanguage ?? "en";
    const definitionLanguage = data.definitionLanguage
      ? normalizeDefinitionLanguage(data.definitionLanguage, targetLanguage)
      : getDefinitionLanguageFor(targetLanguage).code;
    const { data: rows, error } = await context.supabase.rpc("create_deck_with_cards", {
      p_name: data.name,
      p_description: data.description,
      p_cover_color: data.coverColor ?? null,
      p_target_language: targetLanguage,
      p_definition_language: definitionLanguage,
      p_cards: data.cards.map((card, position) => ({ ...card, position })),
      p_collection_id: data.collectionId ?? null,
      p_use_default_collection: data.useDefaultCollection && !data.collectionId,
      p_idempotency_key: data.idempotencyKey,
    });
    const row = rows?.[0];
    if (error || !row) throw new Error(getDeckCreationErrorMessage(error));
    return {
      id: row.deck_id,
      cardIds: row.card_ids,
      collectionId: row.collection_id,
      duplicate: row.duplicate,
    };
  });

export const addCardRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        deckId: z.string().uuid(),
        term: z.string().min(1).max(160),
        definition: z.string().min(1).max(300),
        position: z.number().int().min(0).max(10000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { count, error: countError } = await supabase
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("deck_id", data.deckId)
      .eq("user_id", userId);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) >= MAX_DECK_CARDS) {
      throw new Error(`A deck can have at most ${MAX_DECK_CARDS} cards`);
    }

    const { data: card, error } = await supabase
      .from("cards")
      .insert({
        deck_id: data.deckId,
        user_id: userId,
        term: data.term,
        definition: data.definition,
        position: data.position,
      })
      .select("id")
      .single();
    if (error || !card) throw new Error(error?.message ?? "Could not add card");
    return { id: card.id };
  });

export const updateDeckRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120),
        description: z.string().max(300).default(""),
        coverColor: DeckCoverColorInput,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const update = {
      name: data.name,
      description: data.description,
      cover_color: data.coverColor ?? null,
    };
    let result = await context.supabase
      .from("decks")
      .update(update)
      .eq("id", data.id)
      .eq("user_id", context.userId);

    if (result.error?.code === "42703") {
      result = await context.supabase
        .from("decks")
        .update({ name: data.name, description: data.description })
        .eq("id", data.id)
        .eq("user_id", context.userId);
    }

    const { error } = result;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteDeckRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("decks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCardRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("cards").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markCardRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), known: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("set_card_known", {
      p_card_id: data.id,
      p_known: data.known,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetDeckProgressRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ deckId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("reset_deck_known", {
      p_deck_id: data.deckId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
