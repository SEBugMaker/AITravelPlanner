import type {
  TravelPreferences,
  ItineraryPlan,
  DayLocation,
  TransportationSegment,
  AccommodationPlan,
  DiningRecommendation
} from "@core/index";
import { buildItineraryPrompt } from "./prompts";
import { getDecryptedUserSecret } from "../services/user-secrets";

interface LLMResponseChoice {
  message?: {
    content?: Array<{
      text?: string;
      type: string;
    }>;
  };
}

interface LLMResponseBody {
  output?: {
    text?: string;
    choices?: LLMResponseChoice[];
  };
  output_text?: string;
}

interface GenerateItineraryResult {
  plan: ItineraryPlan | null;
  rawText: string | null;
}

interface LLMRequestOptions {
  userId?: string | null;
}

export async function requestItineraryFromLLM(
  preferences: TravelPreferences,
  options: LLMRequestOptions = {}
): Promise<GenerateItineraryResult> {
  const endpoint = process.env.LLM_ENDPOINT;

  let apiKey = process.env.LLM_API_KEY;
  if (options.userId) {
    const userScopedKey = await getDecryptedUserSecret(options.userId, "llmApiKey");
    if (userScopedKey) {
      apiKey = userScopedKey;
    } else {
      const legacyKey = await getDecryptedUserSecret(options.userId, "bailianApiKey");
      if (legacyKey) {
        apiKey = legacyKey;
      }
    }
  }
  const model = process.env.LLM_MODEL_NAME ?? "qwen-plus";

  if (!endpoint || !apiKey) {
    return { plan: null, rawText: null };
  }

  const prompt = buildItineraryPrompt(preferences);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        input: {
          prompt,
          result_format: "json"
        },
        model
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM request failed: ${response.status} ${text}`);
    }

  const body = (await response.json()) as LLMResponseBody;
  const candidateTexts = extractCandidateTexts(body);
  await logRawResponse(body, candidateTexts);

    for (const candidate of candidateTexts) {
      const parsed = tryParsePlan(candidate);
      if (parsed) {
        return { plan: parsed, rawText: candidate };
      }
    }

    console.warn("LLM response returned no parsable plan", {
      candidates: candidateTexts.map((text) => text.slice(0, 200))
    });
    return { plan: null, rawText: candidateTexts[0] ?? null };
  } catch (error) {
    console.error("LLM request error", error);
    return { plan: null, rawText: null };
  }
}

function extractCandidateTexts(body: LLMResponseBody): string[] {
  const candidates: string[] = [];

  const choiceContent = body.output?.choices?.[0]?.message?.content ?? [];
  for (const item of choiceContent) {
    if (item.type === "text" && item.text) {
      candidates.push(item.text);
    }
  }

  if (typeof body.output?.text === "string") {
    candidates.push(body.output.text);
  }

  if (typeof body.output_text === "string") {
    candidates.push(body.output_text);
  }

  return candidates.filter(Boolean);
}

function tryParsePlan(candidate: string): ItineraryPlan | null {
  if (!candidate) return null;

  const trimmed = candidate.trim();
  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i);
  const jsonText = fencedMatch ? fencedMatch[1].trim() : trimmed;

  const attempts: string[] = [jsonText];

  const firstBrace = jsonText.indexOf("{");
  const lastBrace = jsonText.lastIndexOf("}");
  if (firstBrace > 0 && lastBrace > firstBrace) {
    attempts.push(jsonText.slice(firstBrace, lastBrace + 1));
  }

  for (const attempt of attempts) {
    try {
      const raw = JSON.parse(attempt) as unknown;
      const plan = coerceItineraryPlan(raw);
      if (plan) {
        return plan;
      }
    } catch (error) {
      console.warn("Failed to parse LLM JSON payload", {
        message: (error as Error).message,
        sample: attempt.slice(0, 200)
      });
    }
  }

  return null;
}

function coerceItineraryPlan(input: unknown): ItineraryPlan | null {
  if (!input || typeof input !== "object") return null;

  const candidates: Record<string, unknown>[] = [];
  const root = input as Record<string, unknown>;
  candidates.push(root);

  if (isObject(root.plan)) candidates.push(root.plan as Record<string, unknown>);
  if (isObject(root.itinerary)) candidates.push(root.itinerary as Record<string, unknown>);

  for (const candidate of candidates) {
    const dayPlans = extractDayPlans(candidate);
    if (!dayPlans) continue;

    const overview = pickString(candidate.overview) ?? pickString(candidate.summary);
    const estimatedTotal = pickNumber(candidate.estimatedTotal) ?? pickNumber(candidate.totalBudget);

    return {
      overview: overview ?? "",
      dayPlans,
      estimatedTotal: estimatedTotal ?? 0
    };
  }

  return null;
}

async function logRawResponse(body: LLMResponseBody, candidates: string[]) {
  if (process.env.LLM_DEBUG !== "true") return;

  try {
    const [{ mkdir, writeFile }, { join, relative }] = await Promise.all([
      import("node:fs/promises"),
      import("node:path")
    ]);

    const dir = join(process.cwd(), ".llm-debug");
    await mkdir(dir, { recursive: true });

    const file = join(dir, `response-${Date.now()}.json`);
    const payload = {
      timestamp: new Date().toISOString(),
      body,
      candidates: candidates.map((text) => text.slice(0, 2000))
    };

    await writeFile(file, JSON.stringify(payload, null, 2), "utf-8");
    console.info("LLM debug response written to", relative(process.cwd(), file));
  } catch (error) {
    console.warn("Failed to persist LLM debug response", error);
  }
}

function extractDayPlans(source: Record<string, unknown>): ItineraryPlan["dayPlans"] | null {
  const candidates = [
    source.dayPlans,
    source.days,
    source.dailyPlans,
    source.itinerary,
    source.schedule
  ];

  const arrayCandidate = candidates.find(Array.isArray);
  if (!Array.isArray(arrayCandidate)) return null;

  return arrayCandidate.map((item, index) => normalizeDayPlan(item, index));
}

function normalizeDayPlan(item: unknown, index: number) {
  const record = isObject(item) ? (item as Record<string, unknown>) : {};

  const day = pickNumber(record.day) ?? index + 1;
  const summary = pickString(record.summary)
    ?? pickString(record.title)
    ?? pickString(record.description)
    ?? `行程第 ${index + 1} 天`;
  const highlights = pickStringArray(record.highlights) ?? pickStringArray(record.activities) ?? [];
  const meals = pickStringArray(record.meals) ?? pickStringArray(record.dining) ?? [];
  const estimatedCost = pickNumber(record.estimatedCost) ?? undefined;
  const locations =
    pickLocationArray(record.locations)
      ?? pickLocationArray(record.places)
      ?? pickLocationArray(record.stops)
      ?? pickLocationArray(record.points)
      ?? pickLocationArray(record.pointsOfInterest)
      ?? [];
  const transportation =
    pickTransportationArray(record.transportation)
      ?? pickTransportationArray(record.transports)
      ?? pickTransportationArray(record.travel)
      ?? [];
  const accommodation =
    pickAccommodation(record.accommodation)
      ?? pickAccommodation(record.hotel)
      ?? pickAccommodation(record.lodging)
      ?? null;
  const restaurants =
    pickRestaurantArray(record.restaurants)
      ?? pickRestaurantArray(record.diningRecommendations)
      ?? pickRestaurantArray(record.food)
      ?? [];

  return {
    day,
    summary,
    highlights,
    meals,
    estimatedCost,
    locations,
    transportation,
    accommodation,
    restaurants
  };
}

function pickString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
}

function pickBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["yes", "true", "需要", "是", "需预约"].includes(normalized)) return true;
    if (["no", "false", "不需要", "否"].includes(normalized)) return false;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return undefined;
}

function pickNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function pickStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const result = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : undefined))
      .filter(Boolean) as string[];
    return result.length > 0 ? result : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(/[\n,、，]/).map((item) => item.trim()).filter(Boolean);
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type LocationCandidate = {
  name?: unknown;
  title?: unknown;
  latitude?: unknown;
  lat?: unknown;
  longitude?: unknown;
  lng?: unknown;
  lon?: unknown;
  address?: unknown;
  detail?: unknown;
};

function pickLocationArray(value: unknown): DayLocation[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const result: DayLocation[] = [];

  for (const entry of value) {
    if (!isObject(entry)) continue;
    const candidate = entry as LocationCandidate;

    const name = pickString(candidate.name) ?? pickString(candidate.title) ?? pickString(candidate.detail);
    if (!name) continue;

    const latitude = pickNumber(candidate.latitude) ?? pickNumber(candidate.lat);
    const longitude =
      pickNumber(candidate.longitude)
      ?? pickNumber(candidate.lng)
      ?? pickNumber(candidate.lon);
    const address = pickString(candidate.address);

    result.push({
      name,
      latitude: latitude ?? undefined,
      longitude: longitude ?? undefined,
      address: address ?? undefined
    });
  }

  return result.length > 0 ? result : undefined;
}

type TransportationCandidate = {
  mode?: unknown;
  type?: unknown;
  transport?: unknown;
  detail?: unknown;
  description?: unknown;
  origin?: unknown;
  from?: unknown;
  departure?: unknown;
  departureTime?: unknown;
  startTime?: unknown;
  destination?: unknown;
  to?: unknown;
  arrival?: unknown;
  arrivalTime?: unknown;
  endTime?: unknown;
  duration?: unknown;
  cost?: unknown;
  costEstimate?: unknown;
};

function pickTransportationArray(value: unknown): TransportationSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const result: TransportationSegment[] = [];
  for (const entry of value) {
    if (!isObject(entry)) continue;
    const candidate = entry as TransportationCandidate;

    const mode = pickString(candidate.mode) ?? pickString(candidate.type) ?? pickString(candidate.transport);
    if (!mode) continue;

    const origin = pickString(candidate.origin) ?? pickString(candidate.from);
    const destination = pickString(candidate.destination) ?? pickString(candidate.to);
    const departureTime = pickString(candidate.departureTime) ?? pickString(candidate.departure) ?? pickString(candidate.startTime);
    const arrivalTime = pickString(candidate.arrivalTime) ?? pickString(candidate.arrival) ?? pickString(candidate.endTime);
    const duration = pickString(candidate.duration);
    const detail = pickString(candidate.detail) ?? pickString(candidate.description);
    const costEstimate = pickNumber(candidate.costEstimate) ?? pickNumber(candidate.cost);

    result.push({
      mode,
      origin: origin ?? undefined,
      destination: destination ?? undefined,
      departureTime: departureTime ?? undefined,
      arrivalTime: arrivalTime ?? undefined,
      duration: duration ?? undefined,
      detail: detail ?? undefined,
      costEstimate: costEstimate ?? undefined
    });
  }

  return result.length > 0 ? result : undefined;
}

type AccommodationCandidate = {
  name?: unknown;
  title?: unknown;
  hotel?: unknown;
  address?: unknown;
  location?: unknown;
  checkIn?: unknown;
  checkInTime?: unknown;
  checkOut?: unknown;
  checkOutTime?: unknown;
  notes?: unknown;
  description?: unknown;
  remark?: unknown;
  cost?: unknown;
  costEstimate?: unknown;
  price?: unknown;
};

function pickAccommodation(value: unknown): AccommodationPlan | null | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = value as AccommodationCandidate;
  const name = pickString(candidate.name) ?? pickString(candidate.title) ?? pickString(candidate.hotel);
  const address = pickString(candidate.address) ?? pickString(candidate.location);
  const checkIn = pickString(candidate.checkIn) ?? pickString(candidate.checkInTime);
  const checkOut = pickString(candidate.checkOut) ?? pickString(candidate.checkOutTime);
  const notes = pickString(candidate.notes) ?? pickString(candidate.description) ?? pickString(candidate.remark);
  const costEstimate = pickNumber(candidate.costEstimate) ?? pickNumber(candidate.cost) ?? pickNumber(candidate.price);

  if (!name && !address && !notes) {
    return name ? { name } : null;
  }

  const resolvedName = name ?? address ?? "推荐住宿";

  return {
    name: resolvedName,
    address: address ?? undefined,
    checkIn: checkIn ?? undefined,
    checkOut: checkOut ?? undefined,
    notes: notes ?? undefined,
    costEstimate: costEstimate ?? undefined
  };
}

type DiningCandidate = {
  name?: unknown;
  title?: unknown;
  restaurant?: unknown;
  cuisine?: unknown;
  type?: unknown;
  specialty?: unknown;
  mustTry?: unknown;
  signatureDish?: unknown;
  address?: unknown;
  location?: unknown;
  reservation?: unknown;
  needReservation?: unknown;
  reservationRequired?: unknown;
  budget?: unknown;
  budgetPerPerson?: unknown;
  price?: unknown;
  time?: unknown;
  diningTime?: unknown;
  description?: unknown;
};

function pickRestaurantArray(value: unknown): DiningRecommendation[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const result: DiningRecommendation[] = [];
  for (const entry of value) {
    if (!isObject(entry)) continue;
    const candidate = entry as DiningCandidate;

    const name = pickString(candidate.name) ?? pickString(candidate.title) ?? pickString(candidate.restaurant);
    if (!name) continue;

    const cuisine = pickString(candidate.cuisine) ?? pickString(candidate.type);
    const mustTry = pickString(candidate.mustTry) ?? pickString(candidate.signatureDish) ?? pickString(candidate.description);
    const address = pickString(candidate.address) ?? pickString(candidate.location);
    const reservation = pickBoolean(candidate.reservation) ?? pickBoolean(candidate.needReservation) ?? pickBoolean(candidate.reservationRequired);
    const budgetPerPerson = pickNumber(candidate.budgetPerPerson) ?? pickNumber(candidate.budget) ?? pickNumber(candidate.price);
    const time = pickString(candidate.time) ?? pickString(candidate.diningTime);

    result.push({
      name,
      cuisine: cuisine ?? undefined,
      mustTry: mustTry ?? undefined,
      address: address ?? undefined,
      reservation: reservation ?? undefined,
      budgetPerPerson: budgetPerPerson ?? undefined,
      time: time ?? undefined
    });
  }

  return result.length > 0 ? result : undefined;
}
