import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

for (const name of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
  assert.ok(process.env[name], `Missing ${name}`);
}

const supabaseUrl = process.env.SUPABASE_URL;

// This fixture creates and deletes users with the service-role key, so never point it at production.
const fixtureHost = new URL(supabaseUrl).hostname;
assert.ok(
  fixtureHost === "127.0.0.1" || fixtureHost === "localhost",
  "This fixture is restricted to local Supabase",
);
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.notEqual(serviceRoleKey, publishableKey, "Service-role and publishable keys must differ");

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
const password = `Flashlark-${randomUUID()}-Aa1!`;
const fixtureUserIds = [];
const fixtureDeckIds = [];

function authClient() {
  return createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createFixtureUser(label) {
  const email = `flashlark-study-security-${suffix}-${label}@example.invalid`;
  const username = `study_security_${suffix}_${label}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, display_name: `Study security ${label.toUpperCase()}` },
  });
  if (error || !data.user) throw new Error(`Could not create fixture user ${label}`);
  fixtureUserIds.push(data.user.id);

  const client = authClient();
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signIn.session) {
    throw new Error(`Could not authenticate fixture user ${label}`);
  }
  return { id: data.user.id, accessToken: signIn.session.access_token };
}

async function createDeck(userId, visibility, label) {
  const { data, error } = await admin
    .from("decks")
    .insert({
      user_id: userId,
      name: `Study security ${label}`,
      description: "Temporary automated study-integrity fixture",
      visibility,
      published_at: visibility === "public" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create fixture deck ${label}`);
  fixtureDeckIds.push(data.id);
  return data.id;
}

async function createCard(userId, deckId, label, position = 0) {
  const term = `temporary-${label}`;
  const definition = `temporary definition ${label}`;
  const { data, error } = await admin
    .from("cards")
    .insert({
      user_id: userId,
      deck_id: deckId,
      term,
      definition,
      position,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create fixture card ${label}`);
  return { id: data.id, term, definition };
}

async function verifyDatabaseConstraints(userAId, deckAId, cardAId, userBId, deckBId) {
  const invalidMutations = [
    admin.from("card_progress").insert({
      user_id: userAId,
      deck_id: deckAId,
      card_id: cardAId,
      card_key: cardAId,
      mastery: 2,
      correct_count: -1,
    }),
    admin.from("study_events").insert({
      user_id: userAId,
      deck_id: deckAId,
      card_id: cardAId,
      card_key: cardAId,
      correct: true,
      mode: "study",
      response_ms: -1,
    }),
    admin.from("speed_runs").insert({
      user_id: userAId,
      deck_id: deckAId,
      duration: 45,
      score: -1,
      accuracy: 101,
    }),
    admin.from("cards").insert({
      user_id: userAId,
      deck_id: deckBId,
      term: "invalid owner relation",
      definition: "must be rejected",
      position: 99,
    }),
    admin.from("profile_private").update({ streak_days: -1, total_xp: -1 }).eq("user_id", userBId),
  ];

  const results = await Promise.all(invalidMutations);
  for (const [index, result] of results.entries()) {
    assert.ok(result.error, `Database constraint scenario ${index + 1} unexpectedly succeeded`);
  }
}

let testFailure;
try {
  const userA = await createFixtureUser("a");
  const userB = await createFixtureUser("b");
  const deckAId = await createDeck(userA.id, "private", "a-private");
  const cardsA = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      createCard(userA.id, deckAId, `a-private-${index}`, index),
    ),
  );
  cardsA[3].definition = "primary answer, alternate answer";
  const { error: alternativeAnswerError } = await admin
    .from("cards")
    .update({ definition: cardsA[3].definition })
    .eq("id", cardsA[3].id);
  if (alternativeAnswerError) throw new Error("Could not prepare alternative-answer fixture");
  const privateDeckBId = await createDeck(userB.id, "private", "b-private");
  const privateCardB = await createCard(userB.id, privateDeckBId, "b-private");
  const publicDeckBId = await createDeck(userB.id, "public", "b-public");
  const publicCardB = await createCard(userB.id, publicDeckBId, "b-public");
  await verifyDatabaseConstraints(userA.id, deckAId, cardsA[0].id, userB.id, privateDeckBId);

  const childEnvironment = {
    PATH: process.env.PATH,
    NODE_ENV: "test",
    SUPABASE_URL: supabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
    STUDY_TEST_EXPECT_DIRECT_WRITES_BLOCKED:
      process.env.STUDY_TEST_EXPECT_DIRECT_WRITES_BLOCKED ?? "true",
    STUDY_TEST_EXPECT_LEGACY_BOOLEAN_BLOCKED:
      process.env.STUDY_TEST_EXPECT_LEGACY_BOOLEAN_BLOCKED ?? "true",
    STUDY_TEST_USER_A_ACCESS_TOKEN: userA.accessToken,
    STUDY_TEST_USER_A_ID: userA.id,
    STUDY_TEST_USER_B_ACCESS_TOKEN: userB.accessToken,
    STUDY_TEST_USER_B_ID: userB.id,
    STUDY_TEST_DECK_A_ID: deckAId,
    STUDY_TEST_CARD_A_ID: cardsA[0].id,
    STUDY_TEST_CARDS_A_JSON: JSON.stringify(cardsA),
    STUDY_TEST_PRIVATE_DECK_B_ID: privateDeckBId,
    STUDY_TEST_PRIVATE_CARD_B_ID: privateCardB.id,
    STUDY_TEST_PUBLIC_DECK_B_ID: publicDeckBId,
    STUDY_TEST_PUBLIC_CARD_B_ID: publicCardB.id,
    STUDY_TEST_PUBLIC_CARD_B_TERM: publicCardB.term,
    STUDY_TEST_PUBLIC_CARD_B_DEFINITION: publicCardB.definition,
  };
  const result = spawnSync(process.execPath, ["scripts/verify-study-data-integrity.mjs"], {
    cwd: process.cwd(),
    env: childEnvironment,
    stdio: "inherit",
  });
  assert.equal(result.status, 0, "Study data integrity verifier failed");
} catch (error) {
  testFailure = error;
  throw error;
} finally {
  const cleanupErrors = [];
  if (fixtureDeckIds.length > 0) {
    const { error } = await admin.from("decks").delete().in("id", fixtureDeckIds);
    if (error) cleanupErrors.push(error);
  }
  if (fixtureUserIds.length > 0) {
    for (const table of ["profiles", "profile_private"]) {
      const { error } = await admin.from(table).delete().in("user_id", fixtureUserIds);
      if (error) cleanupErrors.push(error);
    }
    for (const userId of fixtureUserIds) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0 && !testFailure) {
    throw new Error("Study integrity fixtures could not be fully removed");
  }
  if (cleanupErrors.length > 0) {
    console.error("Study integrity verification failed and fixture cleanup was incomplete.");
  }
}

console.log("Temporary study-integrity fixtures were removed.");
