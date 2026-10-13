import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const requiredEnvironment = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

for (const name of requiredEnvironment) {
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
const fixtureUsers = [];

function authClient() {
  return createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createFixtureUser(label) {
  const email = `flashlark-security-${suffix}-${label}@example.invalid`;
  const username = `security_${suffix}_${label}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, display_name: `Security test ${label.toUpperCase()}` },
  });
  if (error || !data.user) {
    throw new Error(`Could not create fixture user ${label}: ${error?.code ?? "unknown"}`);
  }
  fixtureUsers.push(data.user.id);

  const client = authClient();
  const { data: sessionData, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !sessionData.session) {
    throw new Error(
      `Could not authenticate fixture user ${label}: ${signInError?.code ?? "unknown"}`,
    );
  }

  return { id: data.user.id, accessToken: sessionData.session.access_token };
}

async function createPublicDeck(userId, label) {
  const { error } = await admin.from("decks").insert({
    user_id: userId,
    name: `Security verification ${label.toUpperCase()}`,
    description: "Temporary automated security fixture",
    visibility: "public",
    published_at: new Date().toISOString(),
  });
  if (error) {
    throw new Error(`Could not create fixture deck ${label}: ${error.code ?? "unknown"}`);
  }
}

let testFailure;

try {
  const userA = await createFixtureUser("a");
  const userB = await createFixtureUser("b");
  await createPublicDeck(userA.id, "a");
  await createPublicDeck(userB.id, "b");

  const childEnvironment = {
    PATH: process.env.PATH,
    NODE_ENV: "test",
    SUPABASE_URL: supabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SECURITY_TEST_USER_A_ACCESS_TOKEN: userA.accessToken,
    SECURITY_TEST_USER_A_ID: userA.id,
    SECURITY_TEST_USER_B_ACCESS_TOKEN: userB.accessToken,
    SECURITY_TEST_USER_B_ID: userB.id,
  };
  const result = spawnSync(process.execPath, ["scripts/verify-profile-email-privacy.mjs"], {
    cwd: process.cwd(),
    env: childEnvironment,
    stdio: "inherit",
  });
  assert.equal(result.status, 0, "Profile privacy verifier failed");
} catch (error) {
  testFailure = error;
  throw error;
} finally {
  const cleanupResults = await Promise.allSettled(
    fixtureUsers.map((userId) => admin.auth.admin.deleteUser(userId)),
  );
  const cleanupFailed = cleanupResults.some(
    (result) => result.status === "rejected" || result.value.error,
  );
  if (cleanupFailed && !testFailure) {
    throw new Error("Profile privacy fixtures could not be fully removed");
  }
  if (cleanupFailed) {
    console.error("Profile privacy verification failed and fixture cleanup was incomplete.");
  }
}

console.log("Temporary profile privacy fixtures were removed.");
