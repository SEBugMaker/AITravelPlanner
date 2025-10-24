import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabaseServer";
import { createSecretPreview, decryptSecret, encryptSecret } from "../../../../lib/services/settings-secrets";

const entrySchema = z.object({
  secret_key: z.string(),
  secret_ciphertext: z.string(),
  secret_preview: z.string().nullable().optional(),
  updated_at: z.string().nullable()
});

const writeSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(4, "密钥长度至少为 4 个字符")
});

export async function GET() {
  try {
    const supabase = createSupabaseServerClient({ access: "write" });
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError) {
      console.warn("[Settings] Failed to verify user for secrets GET", userError);
    }

    if (!user) {
      return NextResponse.json({
        error: "UNAUTHORIZED",
        message: "请先登录后再读取敏感配置"
      }, { status: 401 });
    }

    let queryData: Array<Record<string, unknown>> | null = null;
    let queryError: unknown = null;

    const primary = await supabase
      .from("user_secrets")
      .select("secret_key, secret_ciphertext, secret_preview, updated_at")
      .eq("user_id", user.id);

    if (primary.error) {
      const message = primary.error.message ?? "";
      const missingPreviewColumn = message.includes("secret_preview") || message.includes("does not exist") || message.includes("column");

      if (missingPreviewColumn) {
        const fallback = await supabase
          .from("user_secrets")
          .select("secret_key, secret_ciphertext, updated_at")
          .eq("user_id", user.id);

        if (fallback.error) {
          queryError = fallback.error;
        } else {
          queryData = fallback.data ?? [];
        }
      } else {
        queryError = primary.error;
      }
    } else {
      queryData = primary.data ?? [];
    }

    if (queryError) {
      console.error("[Settings] Failed to fetch user secrets", queryError);
      return NextResponse.json({
        error: "SUPABASE_ERROR",
        message: "获取敏感配置失败"
      }, { status: 500 });
    }

    const secrets = (queryData ?? [])
      .map((entry) => entrySchema.safeParse(entry))
      .filter((result): result is z.SafeParseSuccess<z.infer<typeof entrySchema>> => result.success)
      .map((result) => {
        const { secret_key, secret_ciphertext, secret_preview, updated_at } = result.data;
        let plaintext: string | null = null;
        try {
          plaintext = decryptSecret(secret_ciphertext);
        } catch (error) {
          console.error("[Settings] decrypt secret failed", error);
        }

        const preview = secret_preview ?? (plaintext ? createSecretPreview(plaintext) : null);

        return {
          key: secret_key,
          value: plaintext,
          preview,
          updatedAt: updated_at
        };
      });

    const secretMap = new Map(secrets.map((item) => [item.key, item]));

    const ensureEnvSecret = (key: string, rawValue: string | undefined | null) => {
      if (secretMap.has(key)) {
        return;
      }
      const value = typeof rawValue === "string" ? rawValue.trim() : "";
      if (!value) {
        return;
      }
      secretMap.set(key, {
        key,
        value: null,
        preview: createSecretPreview(value),
        updatedAt: null
      });
    };

    ensureEnvSecret("supabaseAnonKey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    ensureEnvSecret("llmApiKey", process.env.LLM_API_KEY ?? process.env.BAILIAN_API_KEY);
  // Avoid accidentally exposing the backend REST key via env fallback.
  // If NEXT_PUBLIC_AMAP_KEY equals AMAP_REST_KEY, treat it as absent here.
  const rawEnvAmap = typeof process.env.NEXT_PUBLIC_AMAP_KEY === "string" ? process.env.NEXT_PUBLIC_AMAP_KEY.trim() : "";
  const rawRestAmap = typeof process.env.AMAP_REST_KEY === "string" ? process.env.AMAP_REST_KEY.trim() : "";
  const safeEnvAmap = rawEnvAmap && rawEnvAmap !== rawRestAmap ? rawEnvAmap : undefined;
  ensureEnvSecret("amapWebKey", safeEnvAmap);
    ensureEnvSecret("xfyunApiKey", process.env.XFYUN_API_KEY ?? process.env.NEXT_PUBLIC_XFYUN_API_KEY);
    ensureEnvSecret("xfyunAppSecret", process.env.XFYUN_API_SECRET ?? process.env.IFLYTEK_API_SECRET ?? process.env.NEXT_PUBLIC_XFYUN_API_SECRET ?? process.env.NEXT_PUBLIC_IFLYTEK_API_SECRET);

    // Ensure we never return a plaintext value for amapWebKey to the browser.
    // Always return only a preview (or env-based preview) and keep value null.
    try {
      const envWebKey = typeof process.env.NEXT_PUBLIC_AMAP_KEY === "string" ? process.env.NEXT_PUBLIC_AMAP_KEY.trim() : "";
      const existing = secretMap.get("amapWebKey");
      if (existing) {
        secretMap.set("amapWebKey", {
          key: "amapWebKey",
          value: null,
          preview: existing.preview ?? (envWebKey ? createSecretPreview(envWebKey) : null),
          updatedAt: existing.updatedAt ?? null
        });
      } else if (envWebKey) {
        // If no user secret exists but env web key present, expose only preview
        secretMap.set("amapWebKey", {
          key: "amapWebKey",
          value: null,
          preview: createSecretPreview(envWebKey),
          updatedAt: null
        });
      }
    } catch (e) {
      console.warn("[Settings] Failed to sanitize amapWebKey before returning to client", e);
    }

    return NextResponse.json({ secrets: Array.from(secretMap.values()) });
  } catch (error) {
    console.error("[Settings] Unhandled secrets GET error", error);
    return NextResponse.json({
      error: "INTERNAL_ERROR",
      message: "获取敏感配置失败"
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createSupabaseServerClient({ access: "write" });
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError) {
      console.warn("[Settings] Failed to verify user for secrets POST", userError);
    }

    if (!user) {
      return NextResponse.json({
        error: "UNAUTHORIZED",
        message: "请先登录后再更新敏感配置"
      }, { status: 401 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = writeSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json({
        error: "INVALID_REQUEST",
        details: parsed.error.flatten()
      }, { status: 400 });
    }

    const ciphertext = encryptSecret(parsed.data.value);
    const preview = createSecretPreview(parsed.data.value);

    const upsertPayload = {
      user_id: user.id,
      secret_key: parsed.data.key,
      secret_ciphertext: ciphertext,
      secret_preview: preview
    };

    const selection = "updated_at, secret_preview";
    const primary = await supabase
      .from("user_secrets")
      .upsert(upsertPayload, { onConflict: "user_id,secret_key" })
      .select(selection)
      .maybeSingle();

    if (primary.error) {
      const message = primary.error.message ?? "";
      const missingPreviewColumn = message.includes("secret_preview") || message.includes("column") || message.includes("schema");

      if (!missingPreviewColumn) {
        console.error("[Settings] Failed to upsert user secret", primary.error);
        return NextResponse.json({
          error: "SUPABASE_ERROR",
          message: "保存敏感配置失败"
        }, { status: 500 });
      }

      console.warn("[Settings] secret_preview column missing, falling back to legacy upsert");
      const fallbackPayload = {
        user_id: user.id,
        secret_key: parsed.data.key,
        secret_ciphertext: ciphertext
      };

      const fallback = await supabase
        .from("user_secrets")
        .upsert(fallbackPayload, { onConflict: "user_id,secret_key" })
        .select("updated_at")
        .maybeSingle();

      if (fallback.error) {
        console.error("[Settings] Legacy upsert failed", fallback.error);
        return NextResponse.json({
          error: "SUPABASE_ERROR",
          message: "保存敏感配置失败"
        }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        updatedAt: fallback.data?.updated_at ?? new Date().toISOString(),
        preview,
        value: parsed.data.value
      });
    }

    return NextResponse.json({
      ok: true,
      updatedAt: primary.data?.updated_at ?? new Date().toISOString(),
      preview: primary.data?.secret_preview ?? preview,
      value: parsed.data.value
    });
  } catch (error) {
    console.error("[Settings] Unhandled secrets POST error", error);
    if (error instanceof Error && error.message.includes("SETTINGS_SECRET_PASSPHRASE")) {
      return NextResponse.json({
        error: "SERVER_MISCONFIGURED",
        message: "后端未配置 SETTINGS_SECRET_PASSPHRASE，无法加密敏感信息"
      }, { status: 500 });
    }
    return NextResponse.json({
      error: "INTERNAL_ERROR",
      message: "保存敏感配置失败"
    }, { status: 500 });
  }
}
