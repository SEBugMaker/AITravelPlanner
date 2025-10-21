import { decryptSecret } from "./settings-secrets";
import { getSupabaseAdminClient } from "../supabaseAdmin";

export async function getDecryptedUserSecret(userId: string | null | undefined, secretKey: string): Promise<string | null> {
  if (!userId || !secretKey) {
    return null;
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    console.warn("[UserSecrets] Supabase admin client unavailable");
    return null;
  }

  const { data, error } = await supabase
    .from("user_secrets")
    .select("secret_ciphertext")
    .eq("user_id", userId)
    .eq("secret_key", secretKey)
    .maybeSingle();

  if (error) {
    console.error("[UserSecrets] Failed to fetch secret", error);
    return null;
  }

  const ciphertext = (data as { secret_ciphertext?: string | null } | null)?.secret_ciphertext;
  if (!ciphertext) {
    return null;
  }

  try {
    return decryptSecret(ciphertext);
  } catch (error) {
    console.error("[UserSecrets] Failed to decrypt secret", error);
    return null;
  }
}
