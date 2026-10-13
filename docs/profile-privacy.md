# Profile privacy

## Security model

`public.profiles` is Flashlark's public identity directory. A row may be visible to
its owner, to friend-search RPCs, or to visitors when the owner publishes a
marketplace deck or collection. Row Level Security limits which rows can be
read, while column privileges and the physical schema limit which fields can be
returned.

The approved public fields are:

- `id`
- `user_id`
- `username`
- `display_name`
- `avatar_url`
- `created_at`
- `updated_at`

Adding another field requires an explicit privacy review. Public biography or
social fields are acceptable only when users deliberately publish them. Email,
language-learning state, administrative flags, billing data, notification
settings, moderation state, and internal analytics do not belong in this table.

## Private profile data

`public.profile_private` stores owner-only account and learning settings. RLS
allows an authenticated user to read and modify only the row whose `user_id`
matches `auth.uid()`. The `anon` role has no table privileges.

`username_privacy_review_needed` is an internal, owner-only hint. It identifies
historical accounts whose public username matches the local part of their Auth
email. It may be used later to offer a voluntary username change. It must never
change a username automatically, and it may be cleared only after the user has
reviewed or changed the username.

Email is not stored in either profile table. Supabase Auth (`auth.users`) is the
only canonical email store.

## Reading the current user's email

Only read email from the authenticated Supabase user or session:

```ts
const { data, error } = await supabase.auth.getSession();
if (error) throw error;

const email = data.session?.user.email ?? null;
```

Treat `null` as a normal loading, signed-out, or provider-specific state. Do not
query a public table as a fallback. Do not include email in analytics, logs,
public error messages, marketplace payloads, friend-search results, or RPC return
types.

## Explicit selects

Never use `select("*")` for `public.profiles`. RLS controls rows, not individual
columns. An explicit field list documents the intended public contract and
prevents a future migration from silently exposing a newly added column.

```ts
const { data } = await supabase
  .from("profiles")
  .select("user_id, username, display_name, avatar_url");
```

The same rule applies inside views, RPCs, `SECURITY DEFINER` functions, server
functions, marketplace queries, public author cards, and friend search.

## Historical username audit

Run `supabase/checks/find_email_derived_usernames.sql` only from the trusted SQL
Editor or an administrative connection. It compares values inside PostgreSQL but
does not return email addresses. The first query returns an aggregate count; the
second returns the public username, user ID, and private review-flag state.

Finding a match is not permission to rename an account. Offer a clear username
change to the user and preserve the existing value until they consent.

## Change checklist

Before adding or changing a profile field:

1. Decide whether every intended reader may see it permanently.
2. Put private values in `profile_private` or the appropriate private domain table.
3. Keep email in Supabase Auth instead of duplicating it.
4. Add explicit column grants and owner `USING` plus `WITH CHECK` policies.
5. Review every view, RPC, trigger, marketplace query, friend query, and author card.
6. Regenerate `src/integrations/supabase/types.ts`.
7. Update the public-field allowlist in the static audit only after privacy review.
8. Run `npm run check:profile-privacy` and the local Supabase integration test.

GitHub Actions runs the static audit, TypeScript check, and isolated REST/Supabase
JS A/B security test whenever relevant profile, Supabase, marketplace, or friends
files change. The integration job uses a temporary local Supabase instance and
does not require production secrets.
