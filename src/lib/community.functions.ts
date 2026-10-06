import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { getDeckCreationErrorMessage } from "@/lib/deck-creation-errors";
import { getMarketplaceError } from "@/lib/marketplace-errors";
import { httpError } from "@/lib/server-http-error";
import {
  parseCollectionReportInput,
  parseDeckReportInput,
  reportDatabaseErrorMessage,
} from "@/lib/report-validation";

function failMarketplace(error: Parameters<typeof getMarketplaceError>[0]): never {
  const safe = getMarketplaceError(error);
  return httpError(safe.status, safe.code, safe.message);
}

export const DECK_CATEGORIES = [
  "General English",
  "Travel",
  "Business",
  "Academic",
  "IELTS",
  "TOEFL",
  "Technology",
  "Programming",
  "Medical",
  "Custom",
] as const;

const DeckVisibility = z.enum(["private", "unlisted", "public"]);
const DeckCategory = z.enum(DECK_CATEGORIES);

type CommunityDeckRow = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  visibility: "private" | "unlisted" | "public";
  category: (typeof DECK_CATEGORIES)[number];
  keywords: string[];
  learner_count: number;
  like_count: number;
  rating_sum: number;
  rating_count: number;
  view_count: number;
  copy_count: number;
  published_at: string | null;
  target_language?: string | null;
  definition_language?: string | null;
};

type ProfileRow = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url?: string | null;
};

type CommunityCollectionRow = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  visibility: "private" | "unlisted" | "public";
  keywords: string[];
  learner_count: number;
  like_count: number;
  rating_sum: number;
  rating_count: number;
  view_count: number;
  copy_count: number;
  published_at: string | null;
};

function ratingFor(deck: Pick<CommunityDeckRow, "rating_sum" | "rating_count">) {
  return deck.rating_count ? Number((deck.rating_sum / deck.rating_count).toFixed(1)) : 0;
}

function authorName(profile?: ProfileRow) {
  return profile?.username || profile?.display_name || "Memora creator";
}

function ratingForCollection(
  collection: Pick<CommunityCollectionRow, "rating_sum" | "rating_count">,
) {
  return collection.rating_count
    ? Number((collection.rating_sum / collection.rating_count).toFixed(1))
    : 0;
}

// Reads one public or unlisted deck by id. Table reads only return public decks
// to other users, so unlisted ones can't be listed, only opened by link.
async function getMarketplaceDeck(supabase: SupabaseClient<Database>, deckId: string) {
  const { data, error } = await supabase.rpc("get_marketplace_deck", { _deck_id: deckId });
  const deck = data?.[0];
  // No row means private, hidden, blocked or deleted: the same 404 as before.
  if (error || !deck) failMarketplace(error ?? { code: "PGRST116" });
  return deck;
}

async function attachCommunityMeta(
  supabase: SupabaseClient<Database>,
  decks: CommunityDeckRow[],
  userId: string,
) {
  if (decks.length === 0) return [];
  const deckIds = decks.map((deck) => deck.id);
  const authorIds = Array.from(new Set(decks.map((deck) => deck.user_id)));

  const [profilesRes, cardsRes, likesRes, savesRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("user_id, username, display_name, avatar_url")
      .in("user_id", authorIds),
    supabase.from("cards").select("deck_id").in("deck_id", deckIds),
    supabase.from("deck_likes").select("deck_id").eq("user_id", userId).in("deck_id", deckIds),
    supabase.from("deck_saves").select("deck_id").eq("user_id", userId).in("deck_id", deckIds),
  ]);

  if (profilesRes.error) throw new Error(profilesRes.error.message);
  if (cardsRes.error) throw new Error(cardsRes.error.message);
  if (likesRes.error) throw new Error(likesRes.error.message);
  if (savesRes.error) throw new Error(savesRes.error.message);

  const profiles = new Map<string, ProfileRow>(
    (profilesRes.data ?? []).map((p: ProfileRow) => [p.user_id, p]),
  );
  const cardCounts = new Map<string, number>();
  for (const card of cardsRes.data ?? []) {
    cardCounts.set(card.deck_id, (cardCounts.get(card.deck_id) ?? 0) + 1);
  }
  const liked = new Set<string>(
    (likesRes.data ?? []).map((row: { deck_id: string }) => row.deck_id),
  );
  const saved = new Set<string>(
    (savesRes.data ?? []).map((row: { deck_id: string }) => row.deck_id),
  );

  return decks.map((deck) => ({
    id: deck.id,
    title: deck.name,
    description: deck.description ?? "",
    authorId: deck.user_id,
    authorName: authorName(profiles.get(deck.user_id)),
    createdAt: deck.created_at,
    updatedAt: deck.updated_at,
    publishedAt: deck.published_at,
    visibility: deck.visibility,
    category: deck.category,
    keywords: deck.keywords ?? [],
    cardCount: cardCounts.get(deck.id) ?? 0,
    totalLearners: deck.learner_count,
    likes: deck.like_count,
    rating: ratingFor(deck),
    ratingCount: deck.rating_count,
    views: deck.view_count,
    copies: deck.copy_count,
    liked: liked.has(deck.id),
    saved: saved.has(deck.id),
  }));
}

async function attachCollectionMeta(
  supabase: SupabaseClient<Database>,
  collections: CommunityCollectionRow[],
  userId: string,
) {
  if (collections.length === 0) return [];
  const collectionIds = collections.map((collection) => collection.id);
  const authorIds = Array.from(new Set(collections.map((collection) => collection.user_id)));

  const [profilesRes, linksRes, likesRes, savesRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("user_id, username, display_name, avatar_url")
      .in("user_id", authorIds),
    supabase
      .from("collection_decks")
      .select("collection_id, deck_id")
      .in("collection_id", collectionIds),
    supabase
      .from("collection_likes")
      .select("collection_id")
      .eq("user_id", userId)
      .in("collection_id", collectionIds),
    supabase
      .from("collection_saves")
      .select("collection_id")
      .eq("user_id", userId)
      .in("collection_id", collectionIds),
  ]);

  if (profilesRes.error) throw new Error(profilesRes.error.message);
  if (linksRes.error) throw new Error(linksRes.error.message);
  if (likesRes.error) throw new Error(likesRes.error.message);
  if (savesRes.error) throw new Error(savesRes.error.message);

  const profiles = new Map<string, ProfileRow>(
    (profilesRes.data ?? []).map((p: ProfileRow) => [p.user_id, p]),
  );
  const deckCounts = new Map<string, number>();
  for (const link of linksRes.data ?? []) {
    deckCounts.set(link.collection_id, (deckCounts.get(link.collection_id) ?? 0) + 1);
  }
  const liked = new Set<string>(
    (likesRes.data ?? []).map((row: { collection_id: string }) => row.collection_id),
  );
  const saved = new Set<string>(
    (savesRes.data ?? []).map((row: { collection_id: string }) => row.collection_id),
  );

  return collections.map((collection) => ({
    id: collection.id,
    title: collection.name,
    description: collection.description ?? "",
    authorId: collection.user_id,
    authorName: authorName(profiles.get(collection.user_id)),
    createdAt: collection.created_at,
    updatedAt: collection.updated_at,
    publishedAt: collection.published_at,
    visibility: collection.visibility,
    keywords: collection.keywords ?? [],
    deckCount: deckCounts.get(collection.id) ?? 0,
    totalLearners: collection.learner_count,
    likes: collection.like_count,
    rating: ratingForCollection(collection),
    ratingCount: collection.rating_count,
    views: collection.view_count,
    copies: collection.copy_count,
    liked: liked.has(collection.id),
    saved: saved.has(collection.id),
  }));
}

export const searchPublicDecks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        query: z.string().max(120).default(""),
        category: DeckCategory.optional().nullable(),
        sort: z
          .enum(["popular", "rating", "learners", "newest", "updated", "likes"])
          .default("popular"),
        author: z.string().max(80).default(""),
        savedOnly: z.boolean().default(false),
        followingOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(48).default(24),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    let deckIdsFilter: string[] | null = null;
    if (data.savedOnly) {
      const { data: saves, error } = await supabase
        .from("deck_saves")
        .select("deck_id")
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      deckIdsFilter = (saves ?? []).map((row: { deck_id: string }) => row.deck_id);
      if (deckIdsFilter.length === 0) return { decks: [] };
    }

    if (data.followingOnly) {
      const { data: follows, error } = await supabase
        .from("creator_follows")
        .select("creator_id")
        .eq("follower_id", userId);
      if (error) throw new Error(error.message);
      const creatorIds = (follows ?? []).map((row: { creator_id: string }) => row.creator_id);
      if (creatorIds.length === 0) return { decks: [] };
      const { data: followedDecks, error: deckErr } = await supabase
        .from("decks")
        .select("id")
        .in("user_id", creatorIds)
        .eq("visibility", "public")
        .is("hidden_at", null);
      if (deckErr) throw new Error(deckErr.message);
      const followedIds = (followedDecks ?? []).map((row: { id: string }) => row.id);
      deckIdsFilter = deckIdsFilter
        ? deckIdsFilter.filter((id) => followedIds.includes(id))
        : followedIds;
      if (deckIdsFilter.length === 0) return { decks: [] };
    }

    let query = supabase
      .from("decks")
      .select(
        "id, user_id, name, description, target_language, definition_language, created_at, updated_at, visibility, category, keywords, learner_count, like_count, rating_sum, rating_count, view_count, copy_count, published_at",
      )
      .eq("visibility", "public")
      .is("hidden_at", null)
      .limit(data.limit);

    if (data.category) query = query.eq("category", data.category);
    if (deckIdsFilter) query = query.in("id", deckIdsFilter);

    const search = data.query.trim();
    if (search) {
      const safe = search.replace(/[%_,]/g, " ");
      const keywordClause = safe.includes(" ") ? "" : `,keywords.cs.{${safe}}`;
      query = query.or(`name.ilike.%${safe}%,description.ilike.%${safe}%${keywordClause}`);
    }

    if (data.author.trim()) {
      const safeAuthor = data.author.trim().replace(/[%_,]/g, " ");
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("user_id")
        .or(`username.ilike.%${safeAuthor}%,display_name.ilike.%${safeAuthor}%`);
      if (error) throw new Error(error.message);
      const ids = (profiles ?? []).map((p: { user_id: string }) => p.user_id);
      if (ids.length === 0) return { decks: [] };
      query = query.in("user_id", ids);
    }

    if (data.sort === "rating") query = query.order("rating_sum", { ascending: false });
    else if (data.sort === "learners") query = query.order("learner_count", { ascending: false });
    else if (data.sort === "newest")
      query = query.order("published_at", { ascending: false, nullsFirst: false });
    else if (data.sort === "updated") query = query.order("updated_at", { ascending: false });
    else if (data.sort === "likes") query = query.order("like_count", { ascending: false });
    else
      query = query
        .order("learner_count", { ascending: false })
        .order("like_count", { ascending: false });

    const { data: decks, error } = await query;
    if (error) throw new Error(error.message);

    return { decks: await attachCommunityMeta(supabase, decks ?? [], userId) };
  });

export const searchPublicCollections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        query: z.string().max(120).default(""),
        sort: z
          .enum(["popular", "rating", "learners", "newest", "updated", "likes"])
          .default("popular"),
        savedOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(48).default(24),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    let collectionIdsFilter: string[] | null = null;
    if (data.savedOnly) {
      const { data: saves, error } = await supabase
        .from("collection_saves")
        .select("collection_id")
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      collectionIdsFilter = (saves ?? []).map(
        (row: { collection_id: string }) => row.collection_id,
      );
      if (collectionIdsFilter.length === 0) return { collections: [] };
    }

    let query = supabase
      .from("collections")
      .select(
        "id, user_id, name, description, created_at, updated_at, visibility, keywords, learner_count, like_count, rating_sum, rating_count, view_count, copy_count, published_at",
      )
      .eq("visibility", "public")
      .is("hidden_at", null)
      .limit(data.limit);

    if (collectionIdsFilter) query = query.in("id", collectionIdsFilter);

    const search = data.query.trim();
    if (search) {
      const safe = search.replace(/[%_,]/g, " ");
      const keywordClause = safe.includes(" ") ? "" : `,keywords.cs.{${safe}}`;
      query = query.or(`name.ilike.%${safe}%,description.ilike.%${safe}%${keywordClause}`);
    }

    if (data.sort === "rating") query = query.order("rating_sum", { ascending: false });
    else if (data.sort === "learners") query = query.order("learner_count", { ascending: false });
    else if (data.sort === "newest")
      query = query.order("published_at", { ascending: false, nullsFirst: false });
    else if (data.sort === "updated") query = query.order("updated_at", { ascending: false });
    else if (data.sort === "likes") query = query.order("like_count", { ascending: false });
    else
      query = query
        .order("learner_count", { ascending: false })
        .order("like_count", { ascending: false });

    const { data: collections, error } = await query;
    if (error) throw new Error(error.message);

    return { collections: await attachCollectionMeta(supabase, collections ?? [], userId) };
  });

export const getCommunityHome = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const baseSelect =
      "id, user_id, name, description, target_language, definition_language, created_at, updated_at, visibility, category, keywords, learner_count, like_count, rating_sum, rating_count, view_count, copy_count, published_at";

    async function section(order: "trending" | "popular" | "new" | "rated") {
      let q = supabase
        .from("decks")
        .select(baseSelect)
        .eq("visibility", "public")
        .is("hidden_at", null)
        .limit(6);
      if (order === "trending")
        q = q.order("view_count", { ascending: false }).order("like_count", { ascending: false });
      if (order === "popular")
        q = q
          .order("learner_count", { ascending: false })
          .order("copy_count", { ascending: false });
      if (order === "new") q = q.order("published_at", { ascending: false, nullsFirst: false });
      if (order === "rated")
        q = q.order("rating_sum", { ascending: false }).order("rating_count", { ascending: false });
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return attachCommunityMeta(supabase, data ?? [], userId);
    }

    const [trending, popular, newest, topRated, recommended] = await Promise.all([
      section("trending"),
      section("popular"),
      section("new"),
      section("rated"),
      section("popular"),
    ]);

    return { trending, popular, newest, topRated, recommended };
  });

export const getPublicDeckDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ deckId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Unlisted decks are not readable through the decks table by other users.
    // The RPC opens one deck by its exact id, which is what a direct link carries.
    const deck = await getMarketplaceDeck(supabase, data.deckId);

    const { data: views, error: viewError } = await supabase.rpc("record_marketplace_view", {
      p_resource_type: "deck",
      p_resource_id: deck.id,
    });
    if (viewError || views === null) failMarketplace(viewError);

    const { data: cards, error: cardsError } = await supabase.rpc("get_marketplace_deck_cards", {
      _deck_id: deck.id,
    });
    if (cardsError) failMarketplace(cardsError);

    const [meta] = await attachCommunityMeta(supabase, [{ ...deck, view_count: views }], userId);
    meta.cardCount = cards?.length ?? 0;

    const { data: myRating, error: myRatingError } = await supabase
      .from("deck_ratings")
      .select("rating")
      .eq("deck_id", deck.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (myRatingError) failMarketplace(myRatingError);

    return {
      deck: { ...meta, myRating: myRating?.rating ?? null, isOwner: deck.user_id === userId },
      cards: cards ?? [],
    };
  });

export const updateDeckPublishing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        deckId: z.string().uuid(),
        visibility: DeckVisibility,
        category: DeckCategory,
        keywords: z.array(z.string().min(1).max(40)).max(12).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const update = {
      visibility: data.visibility,
      category: data.category,
      keywords: data.keywords.map((word) => word.trim()).filter(Boolean),
    };
    const { error } = await supabase
      .from("decks")
      .update(update)
      .eq("id", data.deckId)
      .eq("user_id", userId);
    if (error) failMarketplace(error);
    return { ok: true };
  });

export const toggleDeckLike = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ deckId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing, error: existingError } = await supabase
      .from("deck_likes")
      .select("id")
      .eq("deck_id", data.deckId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existingError) failMarketplace(existingError);
    if (existing?.id) {
      const { error } = await supabase.from("deck_likes").delete().eq("id", existing.id);
      if (error) failMarketplace(error);
    } else {
      const { error } = await supabase
        .from("deck_likes")
        .insert({ deck_id: data.deckId, user_id: userId });
      if (error) failMarketplace(error);
    }
    const totals = await getMarketplaceDeck(supabase, data.deckId);
    return { liked: !existing?.id, likes: totals.like_count };
  });

export const toggleDeckSave = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ deckId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("deck_saves")
      .select("id")
      .eq("deck_id", data.deckId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing?.id) {
      const { error } = await supabase.from("deck_saves").delete().eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("deck_saves")
        .insert({ deck_id: data.deckId, user_id: userId });
      if (error) throw new Error(error.message);
    }
    return { saved: !existing?.id };
  });

export const rateDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ deckId: z.string().uuid(), rating: z.number().int().min(1).max(5) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("deck_ratings")
      .upsert(
        { deck_id: data.deckId, user_id: userId, rating: data.rating },
        { onConflict: "deck_id,user_id" },
      );
    if (error) failMarketplace(error);
    const totals = await getMarketplaceDeck(supabase, data.deckId);
    return {
      rating: totals.rating_count ? totals.rating_sum / totals.rating_count : 0,
      ratingCount: totals.rating_count,
    };
  });

export const rateCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ collectionId: z.string().uuid(), rating: z.number().int().min(1).max(5) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("collection_ratings")
      .upsert(
        { collection_id: data.collectionId, user_id: userId, rating: data.rating },
        { onConflict: "collection_id,user_id" },
      );
    if (error) failMarketplace(error);
    const { data: rows, error: totalsError } = await supabase.rpc(
      "get_marketplace_collection_totals",
      { _collection_id: data.collectionId },
    );
    const totals = rows?.[0];
    if (totalsError || !totals) failMarketplace(totalsError ?? { code: "PGRST116" });
    return {
      rating: totals.rating_count ? totals.rating_sum / totals.rating_count : 0,
      ratingCount: totals.rating_count,
    };
  });

export const reportDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseDeckReportInput)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("deck_reports")
      .insert({ deck_id: data.deckId, reporter_id: context.userId, reason: data.reason });
    if (error) throw new Error(reportDatabaseErrorMessage(error));
    return { ok: true };
  });

export const reportCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseCollectionReportInput)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("collection_reports").insert({
      collection_id: data.collectionId,
      reporter_id: context.userId,
      reason: data.reason,
    });
    if (error) throw new Error(reportDatabaseErrorMessage(error));
    return { ok: true };
  });

export const duplicatePublicDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ deckId: z.string().uuid(), idempotencyKey: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("duplicate_public_deck_atomic", {
      p_source_deck_id: data.deckId,
      p_idempotency_key: data.idempotencyKey,
    });
    const row = rows?.[0];
    if (error || !row) throw new Error(getDeckCreationErrorMessage(error));
    return { id: row.deck_id, cardIds: row.card_ids, duplicate: row.duplicate };
  });

export const duplicatePublicCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ collectionId: z.string().uuid(), idempotencyKey: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("duplicate_public_collection_atomic", {
      p_source_collection_id: data.collectionId,
      p_idempotency_key: data.idempotencyKey,
    });
    const row = rows?.[0];
    if (error || !row) throw new Error(getDeckCreationErrorMessage(error));
    return { id: row.collection_id, deckIds: row.deck_ids, duplicate: row.duplicate };
  });

export const getCreatorProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("user_id, username, display_name, avatar_url")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);
    if (!profile) throw new Error("Creator not found");

    const { data: decks, error: decksError } = await supabase
      .from("decks")
      .select(
        "id, user_id, name, description, target_language, definition_language, created_at, updated_at, visibility, category, keywords, learner_count, like_count, rating_sum, rating_count, view_count, copy_count, published_at",
      )
      .eq("user_id", data.userId)
      .eq("visibility", "public")
      .is("hidden_at", null)
      .order("published_at", { ascending: false });
    if (decksError) throw new Error(decksError.message);

    const { count: followers } = await supabase
      .from("creator_follows")
      .select("id", { count: "exact", head: true })
      .eq("creator_id", data.userId);
    const { data: followed } = await supabase
      .from("creator_follows")
      .select("id")
      .eq("creator_id", data.userId)
      .eq("follower_id", userId)
      .maybeSingle();

    const publicDecks = await attachCommunityMeta(supabase, decks ?? [], userId);
    return {
      profile: {
        userId: data.userId,
        username: authorName(profile),
        avatarUrl: profile?.avatar_url ?? null,
        totalLearners: publicDecks.reduce((sum, deck) => sum + deck.totalLearners, 0),
        totalLikes: publicDecks.reduce((sum, deck) => sum + deck.likes, 0),
        followers: followers ?? 0,
        followed: !!followed,
        isSelf: data.userId === userId,
      },
      decks: publicDecks,
    };
  });

export const toggleCreatorFollow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ creatorId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    if (data.creatorId === context.userId) return { followed: false };
    const { data: existing } = await context.supabase
      .from("creator_follows")
      .select("id")
      .eq("creator_id", data.creatorId)
      .eq("follower_id", context.userId)
      .maybeSingle();
    if (existing?.id) {
      const { error } = await context.supabase
        .from("creator_follows")
        .delete()
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { followed: false };
    }
    const { error } = await context.supabase
      .from("creator_follows")
      .insert({ creator_id: data.creatorId, follower_id: context.userId });
    if (error) throw new Error(error.message);
    return { followed: true };
  });

export const getModerationQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("deck_reports")
      .select("id, deck_id, reporter_id, reason, status, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { reports: data ?? [] };
  });

export const reviewDeckReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        reportId: z.string().uuid(),
        deckId: z.string().uuid(),
        action: z.enum(["hide", "dismiss"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Keep the existing frontend contract; the database derives the deck from
    // the report and never trusts the independently supplied deckId.
    const { error } = await context.supabase.rpc("moderate_marketplace_report", {
      p_resource_type: "deck",
      p_report_id: data.reportId,
      p_action: data.action,
    });
    if (error) failMarketplace(error);
    return { ok: true };
  });
