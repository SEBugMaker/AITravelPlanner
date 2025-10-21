import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type WebSocketType from "ws";
import type { RawData as WebSocketRawData } from "ws";
import { createSupabaseServerClient } from "../../../../lib/supabaseServer";
import { getDecryptedUserSecret } from "../../../../lib/services/user-secrets";

export const runtime = "nodejs";

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

const XFYUN_HOST = "iat-api.xfyun.cn";
const XFYUN_PATH = "/v2/iat";
const XFYUN_SCHEME = "wss";
const XFYUN_LOG_PREFIX = "[XFYun]";

type WpgsResult = {
  sn?: number;
  pgs?: "apd" | "rpl";
  rg?: [number, number];
  ws?: Array<{ cw?: Array<{ w?: string } | null> } | null>;
};

type WpgsSegment = { cw?: Array<{ w?: string } | null> } | null;

const debugEnabled = process.env.XFYUN_DEBUG === "1" || process.env.NODE_ENV === "development";

function debugLog(message: string, payload?: Record<string, unknown>) {
  if (!debugEnabled) return;
  if (payload) {
    console.log(XFYUN_LOG_PREFIX, message, payload);
  } else {
    console.log(XFYUN_LOG_PREFIX, message);
  }
}

function normalizeRange(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const start = Number(value[0]);
  const end = Number(value[1]);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  return [start, end];
}

function normalizeWsSegments(segments: unknown): WpgsSegment[] {
  if (!Array.isArray(segments)) return [];
  return segments.map((segment) => {
    if (!segment || typeof segment !== "object") return null;
    const cwRaw = (segment as { cw?: unknown }).cw;
    if (!Array.isArray(cwRaw)) return { cw: undefined };
    const cw = cwRaw.map((item) => {
      if (!item || typeof item !== "object") return null;
      const word = typeof (item as { w?: unknown }).w === "string" ? (item as { w?: string }).w : "";
      return { w: word };
    });
    return { cw };
  });
}

function parseResult(input: unknown): WpgsResult | null {
  if (!input) return null;

  if (typeof input === "string") {
    try {
      const json = Buffer.from(input, "base64").toString("utf8");
      return JSON.parse(json) as WpgsResult;
    } catch (error) {
      console.error("Failed to decode XFYun result", error);
      return null;
    }
  }

  if (typeof input === "object") {
    const raw = input as Record<string, unknown>;
    const nested = parseResult(raw.text);

    const snCandidate = typeof raw.sn === "number" ? raw.sn : nested?.sn;
    const pgsCandidate = raw.pgs === "apd" || raw.pgs === "rpl" ? (raw.pgs as "apd" | "rpl") : nested?.pgs;
    const rgCandidate = normalizeRange(raw.rg) ?? nested?.rg;

    let ws: WpgsSegment[] = normalizeWsSegments(raw.ws);

    if (!ws.length) {
      const rtList = (raw.cn as { st?: { rt?: unknown } } | undefined)?.st?.rt;
      if (Array.isArray(rtList)) {
        ws = rtList.flatMap((entry) => normalizeWsSegments((entry as { ws?: unknown }).ws));
      }
    }

    if (!ws.length && nested?.ws?.length) {
      const nestedWs = nested.ws;
      if (nestedWs) {
        ws = [...nestedWs];
      }
    }

    if (snCandidate !== undefined || ws.length || pgsCandidate || rgCandidate) {
      return {
        sn: snCandidate,
        pgs: pgsCandidate,
        rg: rgCandidate,
        ws
      };
    }
  }

  return null;
}

function extractTextFromWs(result: WpgsResult | null): string {
  if (!result || !Array.isArray(result.ws)) return "";
  return result.ws
    .flatMap((segment) => segment?.cw ?? [])
    .map((choice) => choice?.w ?? "")
    .join("");
}

function buildAuthorization({
  apiKey,
  apiSecret,
  method,
  path,
  date,
  host
}: {
  apiKey: string;
  apiSecret: string;
  method: string;
  path: string;
  date: string;
  host: string;
}) {
  const signatureOrigin = [`host: ${host}`, `date: ${date}`, `${method.toUpperCase()} ${path} HTTP/1.1`].join("\n");
  const signatureSha = crypto.createHmac("sha256", apiSecret).update(signatureOrigin).digest("base64");
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureSha}"`;
  return Buffer.from(authorizationOrigin).toString("base64");
}

function toGMTString(timestamp: number) {
  return new Date(timestamp).toUTCString();
}

function aggregateText(result: WpgsResult | null, store: Map<number, string>) {
  if (!result) {
    return Array.from(store.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, text]) => text)
      .join("");
  }

  const sn = typeof result.sn === "number" ? result.sn : undefined;
  const text = extractTextFromWs(result);

  if (sn === undefined) {
    return Array.from(store.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, value]) => value)
      .join("") + text;
  }

  if (result.pgs === "rpl" && Array.isArray(result.rg)) {
    const [start, end] = result.rg;
    for (const key of Array.from(store.keys())) {
      if (key >= start && key <= end) {
        store.delete(key);
      }
    }
  }

  if (text) {
    store.set(sn, text);
  }

  return Array.from(store.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, value]) => value)
    .join("");
}

export async function POST(request: Request) {
  try {
    const { audioBase64 } = (await request.json().catch(() => ({}))) as { audioBase64?: string };

    if (!audioBase64 || typeof audioBase64 !== "string") {
      return NextResponse.json(
        { error: "INVALID_REQUEST", message: "缺少音频数据" },
        { status: 400 }
      );
    }

    debugLog("收到语音识别请求", { audioLength: audioBase64.length });

    // Prefer user-scoped secret stored in user_secrets table. If absent, fall back to server env.
    const supabase = createSupabaseServerClient({ access: "write" });
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError) {
      console.warn("[XFYun] Failed to verify user", userError);
    }

    let appId: string | null = null;
    let apiKey: string | null = null;
    let apiSecret: string | null = null;
    const domain = process.env.XFYUN_DOMAIN ?? "iat";

    if (user?.id) {
      try {
        // user-stored secret names: xfyunAppId (optional), xfyunAppKey, xfyunAppSecret or xfyunAppSecret
        const userSecret = await getDecryptedUserSecret(user.id, "xfyunAppSecret");
        const userAppId = await getDecryptedUserSecret(user.id, "xfyunAppId");
        const userApiKey = await getDecryptedUserSecret(user.id, "xfyunApiKey");

        if (userSecret) apiSecret = userSecret;
        if (userAppId) appId = userAppId;
        if (userApiKey) apiKey = userApiKey;
      } catch (err) {
        console.warn("[XFYun] failed to read user secret", err);
      }
    }

    // Fallback to env if user-scoped secrets not present
    appId = appId ?? process.env.XFYUN_APP_ID ?? process.env.NEXT_PUBLIC_XFYUN_APP_ID ?? process.env.IFLYTEK_APP_ID ?? process.env.NEXT_PUBLIC_IFLYTEK_APP_ID ?? null;
    apiKey = apiKey ?? process.env.XFYUN_API_KEY ?? process.env.NEXT_PUBLIC_XFYUN_API_KEY ?? process.env.IFLYTEK_API_KEY ?? process.env.NEXT_PUBLIC_IFLYTEK_API_KEY ?? null;
    apiSecret = apiSecret ?? process.env.XFYUN_API_SECRET ?? process.env.IFLYTEK_API_SECRET ?? process.env.NEXT_PUBLIC_XFYUN_API_SECRET ?? process.env.NEXT_PUBLIC_IFLYTEK_API_SECRET ?? null;

    if (!appId || !apiKey || !apiSecret) {
      const missingVars = [
        !appId ? "XFYUN_APP_ID" : null,
        !apiKey ? "XFYUN_API_KEY" : null,
        !apiSecret ? "XFYUN_API_SECRET" : null
      ]
        .filter(Boolean)
        .join(", ");
      console.warn("XFYun credentials missing, please set:", missingVars || "XFYUN_APP_ID / XFYUN_API_KEY / XFYUN_API_SECRET");
      return NextResponse.json(
        {
          error: "NOT_CONFIGURED",
          message: `讯飞语音识别未启用，请在设置页配置讯飞密钥或在环境变量中配置 ${missingVars || "XFYUN_APP_ID、XFYUN_API_KEY、XFYUN_API_SECRET"}`
        },
        { status: 503 }
      );
    }

    const timestamp = Date.now();
    const dateHeader = toGMTString(timestamp);
    const authorization = buildAuthorization({
      apiKey,
      apiSecret,
      method: "GET",
      path: XFYUN_PATH,
      host: XFYUN_HOST,
      date: dateHeader
    });

    const wsUrl = `${XFYUN_SCHEME}://${XFYUN_HOST}${XFYUN_PATH}?authorization=${encodeURIComponent(
      authorization
    )}&date=${encodeURIComponent(dateHeader)}&host=${encodeURIComponent(XFYUN_HOST)}`;

    const accumulated = new Map<number, string>();
    let finalText = "";

    const WebSocket = await getWebSocketCtor();

    debugLog("开始建立 WebSocket 连接", {
      endpoint: `${XFYUN_SCHEME}://${XFYUN_HOST}${XFYUN_PATH}`,
      domain
    });

    const transcript = await new Promise<string>((resolve, reject) => {
      const socket: any = new WebSocket(wsUrl, {
        handshakeTimeout: 10000,
        headers: {
          Date: dateHeader,
          Host: XFYUN_HOST
        }
      } as any);

      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.close(4000, "timeout");
          reject(new Error("XFYun WebSocket 超时"));
        }
      }, 25000);

      const abort = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.close();
        debugLog("语音识别流程中断", { error: error.message });
        reject(error);
      };

      socket.on("error", (event: Error) => {
        abort(event instanceof Error ? event : new Error("XFYun WebSocket 连接失败"));
      });

      socket.on("open", () => {
        try {
          const firstFrame = {
            common: {
              app_id: appId
            },
            business: {
              domain,
              language: "zh_cn",
              accent: "mandarin",
              dwa: "wpgs"
            },
            data: {
              status: 0,
              format: "audio/L16;rate=16000",
              encoding: "raw",
              audio: audioBase64
            }
          };

          socket.send(JSON.stringify(firstFrame));
          debugLog("已发送首帧音频", {
            audioLength: audioBase64.length
          });

          const lastFrame = {
            data: {
              status: 2,
              format: "audio/L16;rate=16000",
              encoding: "raw",
              audio: ""
            }
          };

          socket.send(JSON.stringify(lastFrame));
          debugLog("已发送结束帧");
        } catch (error) {
          abort(error instanceof Error ? error : new Error("发送音频数据失败"));
        }
      });

      socket.on("message", (data: WebSocketRawData) => {
        try {
          const payload = JSON.parse(data.toString()) as {
            code?: number;
            message?: string;
            data?: { status?: number; result?: unknown };
          };

          const code = payload.code ?? 0;
          if (code !== 0) {
            debugLog("收到错误响应", { code, message: payload.message });
            abort(new Error(payload.message ?? `XFYun 返回错误码 ${code}`));
            return;
          }

          const result = parseResult(payload.data?.result ?? null);
          if (result) {
            finalText = aggregateText(result, accumulated);
            debugLog("收到识别片段", {
              sn: result.sn,
              pgs: result.pgs,
              rg: result.rg,
              status: payload.data?.status,
              partialLength: finalText.length
            });
          } else {
            debugLog("收到无法解析的识别结果", {
              status: payload.data?.status,
              hasResult: Boolean(payload.data?.result)
            });
          }

          if (payload.data?.status === 2 && !settled) {
            settled = true;
            clearTimeout(timeout);
            socket.close(1000);
            debugLog("识别完成", { finalLength: finalText.length });
            resolve(finalText.trim());
          }
        } catch (error) {
          abort(error instanceof Error ? error : new Error("解析识别结果失败"));
        }
      });

      socket.on("close", (code: number, reason: Buffer | string) => {
        debugLog("WebSocket 关闭", {
          code,
          reason: typeof reason === "string" ? reason : reason?.toString()
        });
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const message = typeof reason === "string" ? reason : reason?.toString() || `XFYun WebSocket closed with code ${code}`;
        if (code === 1000) {
          resolve(finalText.trim());
        } else {
          reject(new Error(message));
        }
      });
    });

    if (!transcript) {
      return NextResponse.json(
        { error: "EMPTY_TRANSCRIPT", message: "未识别到有效语音，请重试" },
        { status: 422 }
      );
    }

    return NextResponse.json({ text: transcript });
  } catch (error) {
    console.error("XFYun speech recognition failed", error);
    debugLog("接口异常结束", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      {
        error: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "语音识别请求处理失败"
      },
      { status: 500 }
    );
  }
}
