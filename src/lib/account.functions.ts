import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function deleteAvatarFiles(userId: string) {
  const bucket = supabaseAdmin.storage.from("avatars");
  const { data, error } = await bucket.list(userId, { limit: 100 });

  if (error || !data?.length) return;

  const paths = data.map((file) => `${userId}/${file.name}`);
  const { error: removeError } = await bucket.remove(paths);
  if (removeError) console.error("Could not remove avatar files", removeError.message);
}

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;

    const { error: userCheckError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userCheckError) {
      throw new Error(userCheckError.message || "Could not verify account before deletion.");
    }

    // One DELETE of the auth user. Every table that holds this user's data
    // references auth.users (directly or through profiles, decks, collections)
    // with ON DELETE CASCADE, so Postgres removes all of it in the same
    // transaction: if anything fails, nothing is deleted and the user can retry.
    // The old code ran ~17 separate deletes first, so a failure midway wiped the
    // data but left the account.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message || "Could not delete account.");

    // The rest runs after the account is gone, so a failure here must not report
    // the deletion as failed. Storage files are outside the database
    // transaction. The table deletes are normally no-ops (the cascade already
    // removed the rows) and only guard against a database missing a foreign key.
    try {
      await deleteAvatarFiles(userId);
      for (const table of ["decks", "collections", "profiles"] as const) {
        const { error: leftoverError } = await supabaseAdmin
          .from(table)
          .delete()
          .eq("user_id", userId);
        if (leftoverError) console.error(`Could not clean up ${table}`, leftoverError.message);
      }
    } catch (cleanupError) {
      console.error("Account cleanup after deletion failed", cleanupError);
    }

    return { ok: true };
  });
