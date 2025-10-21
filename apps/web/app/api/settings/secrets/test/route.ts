import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import type WebSocketType from "ws";
import type { RawData as WebSocketRawData } from "ws";
import { createSupabaseServerClient } from "../../../../../lib/supabaseServer";
import { getDecryptedUserSecret } from "../../../../../lib/services/user-secrets";

const schema = z.object({
  key: z.enum(["llmApiKey", "supabaseAnonKey", "amapWebKey", "xfyunApiKey", "xfyunAppSecret"])
});

interface TestResult {
  ok: boolean;
  message: string;
}

async function resolveUserId() {
  const supabase = createSupabaseServerClient({ access: "write" });
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function resolveSecretValue(userId: string | null, key: string): Promise<string | null> {
  const primary = await getDecryptedUserSecret(userId, key);
  if (primary) return primary;

  switch (key) {
    case "llmApiKey":
      return process.env.LLM_API_KEY ?? process.env.BAILIAN_API_KEY ?? null;
    case "supabaseAnonKey":
      return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null;
    case "amapWebKey":
      return process.env.NEXT_PUBLIC_AMAP_KEY ?? null;
    case "xfyunApiKey":
      return (
        process.env.XFYUN_API_KEY ??
        process.env.NEXT_PUBLIC_XFYUN_API_KEY ??
        process.env.IFLYTEK_API_KEY ??
        process.env.NEXT_PUBLIC_IFLYTEK_API_KEY ??
        null
      );
    case "xfyunAppSecret":
      return (
        process.env.XFYUN_APP_SECRET ??
        process.env.XFYUN_API_SECRET ??
        process.env.IFLYTEK_APP_SECRET ??
        process.env.IFLYTEK_API_SECRET ??
        null
      );
    default:
      return null;
  }
}

async function testLlmKey(apiKey: string): Promise<TestResult> {
  const endpoint = process.env.LLM_ENDPOINT;
  const model = process.env.LLM_MODEL_NAME ?? "qwen-plus";

  if (!endpoint) {
    return { ok: false, message: "服务器未配置 LLM_ENDPOINT，无法测试。" };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        input: {
          prompt: "测试联通请求，请回复 OK。",
          result_format: "text"
        },
        model,
        parameters: { max_tokens: 20 }
      })
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        message: `调用失败（${response.status}）：${text.slice(0, 180)}`
      };
    }

    return { ok: true, message: "联通成功，LLM 返回 200。" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "连接 LLM 失败"
    };
  }
}

async function testSupabaseKey(apiKey: string): Promise<TestResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    return { ok: false, message: "服务器未配置 Supabase URL，无法测试。" };
  }

  try {
    const target = new URL("/rest/v1/user_secrets", url);
    target.searchParams.set("select", "user_id");
    target.searchParams.set("limit", "1");

    const response = await fetch(target.toString(), {
      method: "GET",
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (response.status === 200) {
      return { ok: true, message: "Supabase REST 接口可访问。" };
    }

    if (response.status === 401) {
      return { ok: false, message: "认证失败，请确认 Supabase 匿名密钥是否正确。" };
    }

    const text = await response.text();
    return {
      ok: false,
      message: `Supabase 返回状态 ${response.status}：${text.slice(0, 200)}`
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "连接 Supabase 失败"
    };
  }
}

async function testAmapKey(apiKey: string): Promise<TestResult> {
  try {
    const endpoint = new URL("https://restapi.amap.com/v3/config/district");
    endpoint.searchParams.set("keywords", "北京");
    endpoint.searchParams.set("subdistrict", "0");
    endpoint.searchParams.set("key", apiKey);

    const response = await fetch(endpoint.toString(), { method: "GET" });
    const payload = (await response.json().catch(() => null)) as { status?: string; info?: string } | null;

    if (!response.ok) {
      return {
        ok: false,
        message: `请求失败（${response.status}）：${payload?.info ?? "未知错误"}`
      };
    }

    if (payload?.status === "1") {
      return { ok: true, message: "高德 Web 服务返回成功。" };
    }

    return {
      ok: false,
      message: payload?.info ? `高德接口返回：${payload.info}` : "高德接口返回异常。"
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "连接高德接口失败"
    };
  }
}

async function testXfyunKey(
  appId: string,
  apiKey: string,
  apiSecret: string
): Promise<TestResult> {
  let WebSocketCtor: typeof WebSocketType | null = null;

  async function getWebSocketCtor() {
    if (!WebSocketCtor) {
      process.env.WS_NO_BUFFER_UTIL ??= "1";
      process.env.WS_NO_UTF_8_VALIDATE ??= "1";
      const wsModule = await import("ws");
      WebSocketCtor = wsModule.default;
    }
    return WebSocketCtor as typeof WebSocketType;
  }

  const host = "iat-api.xfyun.cn";
  const path = "/v2/iat";
  const scheme = "wss";

  const timestamp = Date.now();
  const dateHeader = new Date(timestamp).toUTCString();
  const signatureOrigin = [`host: ${host}`, `date: ${dateHeader}`, `GET ${path} HTTP/1.1`].join("\n");
  const signatureSha = crypto.createHmac("sha256", apiSecret).update(signatureOrigin).digest("base64");
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureSha}"`;
  const authorization = Buffer.from(authorizationOrigin).toString("base64");

  const wsUrl = `${scheme}://${host}${path}?authorization=${encodeURIComponent(
    authorization
  )}&date=${encodeURIComponent(dateHeader)}&host=${encodeURIComponent(host)}`;

  try {
    const WebSocket = await getWebSocketCtor();

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(wsUrl, {
        handshakeTimeout: 8000,
        headers: { Date: dateHeader, Host: host }
      } as any);

      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close(4000, "timeout");
        reject(new Error("讯飞 WebSocket 超时"));
      }, 12000);

      socket.on("error", (event: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(event instanceof Error ? event : new Error("WebSocket 连接失败"));
      });

      socket.on("open", () => {
        try {
          const firstFrame = {
            common: { app_id: appId },
            business: {
              domain: "iat",
              language: "zh_cn",
              accent: "mandarin",
              dwa: "wpgs"
            },
            data: {
              status: 0,
              format: "audio/L16;rate=16000",
              encoding: "raw",
              audio: ""
            }
          };
          socket.send(JSON.stringify(firstFrame));

          const lastFrame = {
            data: { status: 2, format: "audio/L16;rate=16000", encoding: "raw", audio: "" }
          };
          socket.send(JSON.stringify(lastFrame));
        } catch (error) {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(error instanceof Error ? error : new Error("发送数据失败"));
          }
        }
      });

      socket.on("message", (data: WebSocketRawData) => {
        try {
          const payload = JSON.parse(data.toString()) as { code?: number };
          if (typeof payload.code === "number" && payload.code !== 0) {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              reject(new Error(`讯飞接口返回错误码 ${payload.code}`));
            }
            return;
          }

          if (!settled && typeof payload.code === "number" && payload.code === 0) {
            settled = true;
            clearTimeout(timeout);
            try {
              socket.close(1000, "ok");
            } catch (closeError) {
              console.warn("[XFYun] 关闭测试 WebSocket 失败", closeError);
            }
            resolve();
          }
        } catch (error) {
          // ignore parse issue, not critical for connectivity test
        }
      });

      socket.on("close", (code: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (code === 1000 || code === 0) {
          resolve();
        } else {
          reject(new Error(`讯飞接口关闭，状态码 ${code}`));
        }
      });
    });

    return { ok: true, message: "讯飞 WebSocket 握手成功。" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "讯飞接口连接失败"
    };
  }
}

async function handleTest(key: string, userId: string | null): Promise<TestResult> {
  switch (key) {
    case "llmApiKey": {
      const value = await resolveSecretValue(userId, "llmApiKey");
      if (!value) {
        return { ok: false, message: "未找到百炼 API Key" };
      }
      return testLlmKey(value);
    }
    case "supabaseAnonKey": {
      const value = await resolveSecretValue(userId, "supabaseAnonKey");
      if (!value) {
        return { ok: false, message: "未找到 Supabase 匿名密钥" };
      }
      return testSupabaseKey(value);
    }
    case "amapWebKey": {
      const value = await resolveSecretValue(userId, "amapWebKey");
      if (!value) {
        return { ok: false, message: "未找到高德 Web 服务密钥" };
      }
      return testAmapKey(value);
    }
    case "xfyunApiKey":
    case "xfyunAppSecret": {
      const [apiSecret, apiKey] = await Promise.all([
        resolveSecretValue(userId, "xfyunAppSecret"),
        resolveSecretValue(userId, "xfyunApiKey")
      ]);

      const appId =
        (await getDecryptedUserSecret(userId, "xfyunAppId")) ??
        process.env.XFYUN_APP_ID ??
        process.env.NEXT_PUBLIC_XFYUN_APP_ID ??
        null;

      if (!appId) {
        return { ok: false, message: "未找到讯飞 App ID，无法建立连接。" };
      }

      if (!apiKey) {
        return { ok: false, message: "未找到讯飞 API Key，请先配置。" };
      }

      if (!apiSecret) {
        return { ok: false, message: "未找到讯飞 API Secret，请先配置。" };
      }

      return testXfyunKey(appId, apiKey, apiSecret);
    }
    default:
      return { ok: false, message: "不支持的密钥类型" };
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({
        error: "INVALID_REQUEST",
        details: parsed.error.flatten()
      }, { status: 400 });
    }

    const userId = await resolveUserId();
    if (!userId) {
      return NextResponse.json({
        error: "UNAUTHORIZED",
        message: "请先登录后再测试密钥。"
      }, { status: 401 });
    }

    const result = await handleTest(parsed.data.key, userId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[Settings] Secret self-test failed", error);
    return NextResponse.json({
      error: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "密钥测试失败"
    }, { status: 500 });
  }
}
