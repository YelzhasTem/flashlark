BEGIN;

-- Unlisted decks and collections open only by direct link (audit item C8).
--
-- Before: any signed-in user could list every unlisted deck and collection,
-- cards included, with one REST call
-- (GET /rest/v1/decks?visibility=eq.unlisted&select=*,cards(*)), because the
-- table SELECT policies allowed visibility IN ('public', 'unlisted').
--
-- After: table reads by other users return public items only. An unlisted
-- item is read through SECURITY DEFINER functions that take its exact id, so
-- only someone who has the link can open it. Owners still see everything they
-- own through the "Users view own ..." policies. Nothing is deleted.

-- 1. Table reads: public items only ---------------------------------------

DROP POLICY IF EXISTS "Authenticated can view unlisted deck links" ON public.decks;
DROP POLICY IF EXISTS "Authenticated can view unlisted deck cards" ON public.cards;
DROP POLICY IF EXISTS "Authenticated can view unlisted collection links" ON public.collections;
DROP POLICY IF EXISTS "Authenticated can view unlisted collection links" ON public.collection_decks;

-- 2. Exact-id checks used by like / save / rate policies ------------------
--
-- The old policy checks ran EXISTS (SELECT ... FROM decks) as the caller, so
-- without the unlisted SELECT policy liking an unlisted deck would fail.

CREATE OR REPLACE FUNCTION public.can_view_marketplace_deck(_deck_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.decks d
    WHERE d.id = _deck_id
      AND d.visibility::TEXT IN ('public', 'unlisted')
      AND d.hidden_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_marketplace_collection(_collection_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.collections c
    WHERE c.id = _collection_id
      AND c.visibility::TEXT IN ('public', 'unlisted')
      AND c.hidden_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_marketplace_deck(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_marketplace_collection(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_marketplace_deck(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_marketplace_collection(UUID) TO authenticated;

ALTER POLICY "Users like decks" ON public.deck_likes WITH CHECK (
  (SELECT auth.uid()) = user_id AND public.can_view_marketplace_deck(deck_id));
ALTER POLICY "Users save decks" ON public.deck_saves WITH CHECK (
  (SELECT auth.uid()) = user_id AND public.can_view_marketplace_deck(deck_id));
ALTER POLICY "Users rate decks" ON public.deck_ratings WITH CHECK (
  (SELECT auth.uid()) = user_id AND public.can_view_marketplace_deck(deck_id));
ALTER POLICY "Users update own ratings" ON public.deck_ratings
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id AND public.can_view_marketplace_deck(deck_id));
ALTER POLICY "Users like collections" ON public.collection_likes WITH CHECK (
  (SELECT auth.uid()) = user_id AND public.can_view_marketplace_collection(collection_id));
ALTER POLICY "Users save collections" ON public.collection_saves WITH CHECK (
  (SELECT auth.uid()) = user_id AND public.can_view_marketplace_collection(collection_id));
ALTER POLICY "Users rate collections" ON public.collection_ratings WITH CHECK (
  (SELECT auth.uid()) = user_id AND public.can_view_marketplace_collection(collection_id));
ALTER POLICY "Users update own collection ratings" ON public.collection_ratings
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id AND public.can_view_marketplace_collection(collection_id));

-- 3. Reading one deck or collection by its link ---------------------------
--
-- Same rules the old SELECT policies had: public or unlisted, not hidden by a
-- moderator, and the owner is not someone the caller blocked.

CREATE OR REPLACE FUNCTION public.get_marketplace_deck(_deck_id UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  name TEXT,
  description TEXT,
  target_language TEXT,
  definition_language TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  visibility public.deck_visibility,
  category public.deck_category,
  keywords TEXT[],
  learner_count INTEGER,
  like_count INTEGER,
  rating_sum INTEGER,
  rating_count INTEGER,
  view_count INTEGER,
  copy_count INTEGER,
  published_at TIMESTAMPTZ
)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT d.id, d.user_id, d.name, d.description, d.target_language, d.definition_language,
    d.created_at, d.updated_at, d.visibility, d.category, d.keywords, d.learner_count,
    d.like_count, d.rating_sum, d.rating_count, d.view_count, d.copy_count, d.published_at
  FROM public.decks d
  WHERE auth.uid() IS NOT NULL
    AND d.id = _deck_id
    AND d.visibility::TEXT IN ('public', 'unlisted')
    AND d.hidden_at IS NULL
    AND NOT public.is_blocked_by_me(d.user_id);
$$;

CREATE OR REPLACE FUNCTION public.get_marketplace_deck_cards(_deck_id UUID)
RETURNS TABLE (id UUID, term TEXT, definition TEXT, "position" INTEGER)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT c.id, c.term, c.definition, c.position
  FROM public.cards c
  JOIN public.decks d ON d.id = c.deck_id
  WHERE auth.uid() IS NOT NULL
    AND d.id = _deck_id
    AND d.visibility::TEXT IN ('public', 'unlisted')
    AND d.hidden_at IS NULL
    AND NOT public.is_blocked_by_me(d.user_id)
  ORDER BY c.position, c.id;
$$;

CREATE OR REPLACE FUNCTION public.get_marketplace_collection_totals(_collection_id UUID)
RETURNS TABLE (like_count INTEGER, rating_sum INTEGER, rating_count INTEGER)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT c.like_count, c.rating_sum, c.rating_count
  FROM public.collections c
  WHERE auth.uid() IS NOT NULL
    AND c.id = _collection_id
    AND c.visibility::TEXT IN ('public', 'unlisted')
    AND c.hidden_at IS NULL
    AND NOT public.is_blocked_by_me(c.user_id);
$$;

-- Supabase's default privileges grant anon EXECUTE on new public functions,
-- which REVOKE ... FROM PUBLIC alone does not remove.
REVOKE ALL ON FUNCTION public.get_marketplace_deck(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_marketplace_deck_cards(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_marketplace_collection_totals(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_marketplace_deck(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_marketplace_deck_cards(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_marketplace_collection_totals(UUID) TO authenticated;

COMMIT;
