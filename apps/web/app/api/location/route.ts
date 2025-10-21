import { NextResponse } from "next/server";
// Note: defer loading of supabase server client and user-secrets helper to runtime
// to avoid static analysis/compile errors in some CI/typechecker setups.
import { z } from "zod";

const requestSchema = z.object({
  destination: z.string().min(1, "destination is required"),
  includeWeather: z.boolean().optional()
});

interface AMapGeocodeResponse {
  status: string;
  info: string;
  geocodes?: Array<{
    formatted_address?: string;
    location?: string;
    adcode?: string;
    province?: string;
    city?: string | string[];
  }>;
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    weather_code?: number;
  };
  hourly?: {
    time: string[];
    temperature_2m: number[];
    precipitation: number[];
  };
}

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = requestSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({
        error: "INVALID_REQUEST",
        details: parsed.error.flatten()
      }, { status: 400 });
    }

    const { destination, includeWeather = true } = parsed.data;
    // Accept several environment variable names for the REST key so CI / env files
    // that use different names continue to work. Priority:
    // 1) AMAP_REST_KEY (server-side REST key)
    // 2) process.env.NEXT_PUBLIC_AMAP_KEY (fallback if only public key provided)
    // 3) process.env.AMAP_KEY (legacy)
    // 4) per-user secret stored in `user_secrets` (key names: amapRestKey, amapWebKey)
    let restKey = process.env.AMAP_REST_KEY ?? process.env.NEXT_PUBLIC_AMAP_KEY ?? process.env.AMAP_KEY ?? null;

    // If no global REST key, try to use user-scoped secret (requires authenticated session)
    if (!restKey) {
      try {
  // @ts-ignore - dynamic import to avoid static resolution issues in some CI/typecheck setups
  const { createSupabaseServerClient } = await import("../../../lib/supabaseServer");
  // @ts-ignore - dynamic import to avoid static resolution issues in some CI/typecheck setups
  const { getDecryptedUserSecret } = await import("../../../lib/services/user-secrets");
        const supabase = createSupabaseServerClient({ access: "write" });
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (!user || userError) {
          // no authenticated user available; fall through to error below
          console.warn("[Location] No authenticated user for per-user AMAP key fallback", userError);
        } else {
          // try common secret keys used by settings page
          const candidateKeys = ["amapRestKey", "amapWebKey", "AMAP_REST_KEY", "NEXT_PUBLIC_AMAP_KEY"];
          for (const key of candidateKeys) {
            try {
              const val = await getDecryptedUserSecret(user.id, key);
              if (val) {
                restKey = val;
                break;
              }
            } catch (err) {
              console.warn("[Location] failed to read user secret", key, err);
            }
          }
        }
      } catch (err) {
        console.warn("[Location] per-user AMAP key fallback failed", err);
      }
    }

    if (!restKey) {
      return NextResponse.json({
        error: "AMAP_KEY_MISSING",
        message: "服务器未配置 AMAP_REST_KEY，无法获取地理信息"
      }, { status: 503 });
    }

    const geoUrl = new URL("https://restapi.amap.com/v3/geocode/geo");
    geoUrl.searchParams.set("address", destination);
    geoUrl.searchParams.set("key", restKey);
    geoUrl.searchParams.set("output", "json");

    const geoResponse = await fetch(geoUrl.toString());
    if (!geoResponse.ok) {
      const payload = await geoResponse.text();
      throw new Error(`Geocode request failed: ${geoResponse.status} ${payload}`);
    }

    const geoBody = (await geoResponse.json()) as AMapGeocodeResponse;
    const geocode = geoBody.geocodes?.[0];
    if (geoBody.status !== "1" || !geocode?.location) {
      return NextResponse.json({
        error: "DESTINATION_NOT_FOUND",
        message: `无法解析目的地：${destination}`
      }, { status: 404 });
    }

    const [lngString, latString] = geocode.location.split(",");
    const longitude = Number.parseFloat(lngString);
    const latitude = Number.parseFloat(latString);

    const basePayload: Record<string, unknown> = {
      destination,
      location: {
        longitude,
        latitude,
        address: geocode.formatted_address ?? destination,
        code: geocode.adcode ?? null,
        province: geocode.province ?? null,
        city: Array.isArray(geocode.city) ? geocode.city.join("") : geocode.city ?? null
      }
    };

    if (!includeWeather) {
      return NextResponse.json(basePayload, { status: 200 });
    }

    const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
    weatherUrl.searchParams.set("latitude", latitude.toString());
    weatherUrl.searchParams.set("longitude", longitude.toString());
    weatherUrl.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code");
    weatherUrl.searchParams.set("hourly", "temperature_2m,precipitation");
    weatherUrl.searchParams.set("forecast_hours", "24");
    weatherUrl.searchParams.set("timezone", "auto");

    const weatherResponse = await fetch(weatherUrl.toString());
    if (!weatherResponse.ok) {
      const payload = await weatherResponse.text();
      throw new Error(`Weather request failed: ${weatherResponse.status} ${payload}`);
    }

    const weatherBody = (await weatherResponse.json()) as OpenMeteoResponse;

    const weather = weatherBody.current
      ? {
          temperature: weatherBody.current.temperature_2m ?? null,
          apparentTemperature: weatherBody.current.apparent_temperature ?? null,
          humidity: weatherBody.current.relative_humidity_2m ?? null,
          code: weatherBody.current.weather_code ?? null
        }
      : null;

    return NextResponse.json({
      ...basePayload,
      weather,
      forecast: weatherBody.hourly ?? null
    });
  } catch (error) {
    console.error("Location API error", error);
    return NextResponse.json({
      error: "INTERNAL_ERROR",
      message: "无法获取目的地信息"
    }, { status: 500 });
  }
}
