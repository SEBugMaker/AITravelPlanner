#!/usr/bin/env node
/*
  One-off script to sanitize user_secrets entries where users saved the AMAP REST key
  into the `amapWebKey` slot. It finds rows where the decrypted secret equals the
  runtime AMAP_REST_KEY and deletes them to prevent frontend exposure.

  Usage:
    SETTINGS_SECRET_PASSPHRASE=<passphrase> SUPABASE_SERVICE_ROLE_KEY=<key> \
      NEXT_PUBLIC_SUPABASE_URL=<url> AMAP_REST_KEY=<rest> node scripts/sanitize-amap-keys.mjs

  IMPORTANT: This script deletes rows. Create a DB backup or inspect matches before deletion.
*/

import dotenv from "dotenv";
dotenv.config();

import { getSupabaseAdminClient } from "./../apps/web/lib/supabaseAdmin.js";
import { decryptSecret } from "./../apps/web/lib/services/settings-secrets.js";

async function main() {
  const restKey = (process.env.AMAP_REST_KEY || "").trim();
  if (!restKey) {
    console.error("AMAP_REST_KEY not provided in env. Aborting.");
    process.exit(2);
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    console.error("Failed to create Supabase admin client. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.");
    process.exit(2);
  }

  console.log("Scanning user_secrets for secret_key='amapWebKey'...");
  const { data, error } = await supabase
    .from("user_secrets")
    .select("user_id, secret_ciphertext, secret_preview, secret_key, updated_at")
    .eq("secret_key", "amapWebKey");

  if (error) {
    console.error("Failed to query user_secrets:", error);
    process.exit(2);
  }

  const rows = Array.isArray(data) ? data : [];
  console.log(`Found ${rows.length} amapWebKey entries; checking for REST key matches...`);

  const matches = [];
  for (const row of rows) {
    const userId = row.user_id;
    const ciphertext = row.secret_ciphertext;
    if (!ciphertext) continue;
    try {
      const plain = decryptSecret(ciphertext);
      if (plain && plain.trim() === restKey) {
        matches.push({ userId, updatedAt: row.updated_at });
      }
    } catch (e) {
      console.warn(`Failed to decrypt secret for user ${userId}:`, e.message || e);
    }
  }

  if (matches.length === 0) {
    console.log("No entries matched the AMAP_REST_KEY. Nothing to delete.");
    process.exit(0);
  }

  console.log(`Found ${matches.length} entries that match AMAP_REST_KEY.`);
  console.log("The script will delete these rows from user_secrets. Make a DB backup first.");

  // Ask for confirmation on tty
  if (process.stdin.isTTY) {
    // eslint-disable-next-line no-undef
    const answer = await new Promise((resolve) => {
      process.stdout.write("Proceed with deletion? Type 'yes' to continue: ");
      process.stdin.once("data", (d) => resolve(String(d).trim()));
    });
    if (String(answer).toLowerCase() !== "yes") {
      console.log("Aborted by user.");
      process.exit(0);
    }
  }

  for (const m of matches) {
    try {
      const { error: delErr } = await supabase
        .from("user_secrets")
        .delete()
        .match({ user_id: m.userId, secret_key: "amapWebKey" });
      if (delErr) {
        console.error(`Failed to delete secret for user ${m.userId}:`, delErr);
      } else {
        console.log(`Deleted amapWebKey for user ${m.userId} (updatedAt=${m.updatedAt})`);
      }
    } catch (e) {
      console.error(`Unexpected error deleting for user ${m.userId}:`, e);
    }
  }

  console.log("Sanitization complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
