import type { TravelPreferences } from "@core/index";

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

const DEFAULT_PREFERENCES: TravelPreferences = {
  destination: "热门旅行目的地",
  days: 3,
  budgetCNY: 5000,
  companions: 2,
  interests: ["美食"]
};

export async function inferPreferencesFromText(
  content: string,
  fallback: TravelPreferences
): Promise<TravelPreferences> {
  const normalizedFallback = normalizePreferences(fallback);
  const trimmed = content.trim();
  if (!trimmed) {
    return normalizedFallback;
  }

  const heuristicPreferences = normalizePreferences(
    applyHeuristicExtraction(trimmed, normalizedFallback)
  );

  const endpoint = process.env.LLM_ENDPOINT;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL_NAME ?? "qwen-plus";

  if (!endpoint || !apiKey) {
    return heuristicPreferences;
  }

  const prompt = buildPreferencePrompt(trimmed, normalizedFallback);

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
      const text = await response.text().catch(() => "");
      throw new Error(`LLM preference request failed: ${response.status} ${text}`);
    }

    const body = (await response.json()) as LLMResponseBody;
    const candidates = extractCandidateTexts(body);

    for (const candidate of candidates) {
      const parsed = tryParsePreferences(candidate, normalizedFallback);
      if (parsed) {
        return mergePreferenceSources(parsed, heuristicPreferences, normalizedFallback);
      }
    }

    return heuristicPreferences;
  } catch (error) {
    console.error("LLM preference extraction error", error);
    return heuristicPreferences;
  }
}

export function normalizePreferences(input: TravelPreferences): TravelPreferences {
  const destination = (input.destination ?? "").trim()
    || DEFAULT_PREFERENCES.destination;

  const days = clampInteger(input.days, 1, 30, DEFAULT_PREFERENCES.days);
  const budgetRaw = Number.isFinite(input.budgetCNY) ? Number(input.budgetCNY) : DEFAULT_PREFERENCES.budgetCNY;
  const budgetCNY = budgetRaw > 0 ? Math.round(budgetRaw) : DEFAULT_PREFERENCES.budgetCNY;
  const companions = clampInteger(input.companions, 1, 10, DEFAULT_PREFERENCES.companions);
  const interests = normalizeInterests(input.interests);

  return {
    destination,
    days,
    budgetCNY,
    companions,
    interests
  };
}

function buildPreferencePrompt(content: string, fallback: TravelPreferences): string {
  const serializedFallback = JSON.stringify(fallback, null, 2);
  return `你是一位中文旅行顾问。请根据用户的自然语言描述提取出旅行偏好，并输出 JSON，字段必须使用以下英文 key：destination（字符串）、days（整数 1-30）、budgetCNY（非负数字）、companions（整数 1-10）、interests（字符串数组，长度不超过 6，每个元素不超过 6 个汉字）。\n\n用户原始描述：\n${content}\n\n如果用户未提供某些字段，请优先沿用参考偏好：\n${serializedFallback}\n\n返回要求：\n1. 只输出 JSON，不要出现额外文字。\n2. JSON 顶层就是上述字段，必要时可补充 missing 字段。\n3. destination 请返回具体城市或目的地，不要为空。`;
}

function mergePreferenceSources(
  primary: TravelPreferences,
  secondary: TravelPreferences,
  fallback: TravelPreferences
): TravelPreferences {
  const destination = primary.destination?.trim()
    || secondary.destination?.trim()
    || fallback.destination;

  const days = Number.isFinite(primary.days) && primary.days > 0
    ? primary.days
    : secondary.days;

  const companions = Number.isFinite(primary.companions) && primary.companions > 0
    ? primary.companions
    : secondary.companions;

  const budgetCNY = Number.isFinite(primary.budgetCNY) && primary.budgetCNY > 0
    ? primary.budgetCNY
    : secondary.budgetCNY;

  const mergedInterests = dedupeInterests([
    ...(Array.isArray(primary.interests) ? primary.interests : []),
    ...(Array.isArray(secondary.interests) ? secondary.interests : []),
    ...fallback.interests
  ]);

  return normalizePreferences({
    destination,
    days,
    budgetCNY,
    companions,
    interests: mergedInterests.length > 0 ? mergedInterests : fallback.interests
  });
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

function tryParsePreferences(candidate: string, fallback: TravelPreferences): TravelPreferences | null {
  if (!candidate) return null;

  const trimmed = candidate.trim();
  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i);
  const jsonText = fencedMatch ? fencedMatch[1].trim() : trimmed;

  const attempts: string[] = [jsonText];
  const firstBrace = jsonText.indexOf("{");
  const lastBrace = jsonText.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    attempts.push(jsonText.slice(firstBrace, lastBrace + 1));
  }

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown;
      if (parsed && typeof parsed === "object") {
        const result = resolvePreferenceObject(parsed as Record<string, unknown>, fallback);
        if (result) {
          return result;
        }
      }
    } catch (error) {
      console.warn("Failed to parse LLM preference JSON", {
        message: (error as Error).message,
        sample: attempt.slice(0, 200)
      });
    }
  }

  return null;
}

function resolvePreferenceObject(
  source: Record<string, unknown>,
  fallback: TravelPreferences
): TravelPreferences | null {
  const variants = [source];
  if (isObject(source.preferences)) variants.push(source.preferences as Record<string, unknown>);
  if (isObject(source.data)) variants.push(source.data as Record<string, unknown>);

  for (const variant of variants) {
    const destination = pickString(variant, ["destination", "city", "location", "目的地", "城市"])
      ?? fallback.destination;
    const days = pickInteger(variant, ["days", "duration", "tripDays", "行程天数", "天数"], fallback.days, 1, 30);
    const budgetCNY = pickNumber(variant, ["budgetCNY", "budget", "totalBudget", "预算"], fallback.budgetCNY);
    const companions = pickInteger(variant, ["companions", "people", "travelers", "人数"], fallback.companions, 1, 10);
    const interests = pickInterestArray(variant, ["interests", "preferences", "tags", "兴趣"], fallback.interests);

    if (destination && destination.trim()) {
      return normalizePreferences({
        destination,
        days,
        budgetCNY,
        companions,
        interests
      });
    }
  }

  return null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function pickInteger(
  obj: Record<string, unknown>,
  keys: string[],
  fallback: number,
  min: number,
  max: number
): number {
  for (const key of keys) {
    const value = obj[key];
    const parsed = coerceNumber(value);
    if (parsed != null && Number.isFinite(parsed)) {
      return clampInteger(parsed, min, max, fallback);
    }
  }
  return clampInteger(fallback, min, max, fallback);
}

function pickNumber(obj: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = obj[key];
    const parsed = coerceNumber(value);
    if (parsed != null && Number.isFinite(parsed)) {
      return Math.max(0, Math.round(parsed));
    }
  }
  return Math.max(0, Math.round(fallback));
}

function pickInterestArray(
  obj: Record<string, unknown>,
  keys: string[],
  fallback: string[]
): string[] {
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) {
      const normalized = value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean);
      if (normalized.length > 0) {
        return normalized.slice(0, 6);
      }
    } else if (typeof value === "string" && value.trim()) {
      const normalized = value
        .split(/[、,，\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (normalized.length > 0) {
        return normalized.slice(0, 6);
      }
    }
  }
  return normalizeInterests(fallback);
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (match) {
      return Number.parseFloat(match[0]);
    }
  }
  return null;
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.round(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function normalizeInterests(interests: string[] | undefined | null): string[] {
  if (!Array.isArray(interests)) {
    return DEFAULT_PREFERENCES.interests;
  }
  const normalized = interests
    .map((interest) => (typeof interest === "string" ? interest.trim() : ""))
    .filter(Boolean)
    .slice(0, 6);
  return normalized.length > 0 ? normalized : DEFAULT_PREFERENCES.interests;
}

function fillDestinationWithFallback(content: string, prefs: TravelPreferences): TravelPreferences {
  if (prefs.destination && prefs.destination.trim()) {
    return prefs;
  }
  const inferred = inferDestinationHeuristically(content);
  const destination = inferred ?? DEFAULT_PREFERENCES.destination;
  return {
    ...prefs,
    destination
  };
}

function applyHeuristicExtraction(content: string, fallback: TravelPreferences): TravelPreferences {
  let result: TravelPreferences = { ...fallback };

  const destination = inferDestinationHeuristically(content);
  if (destination) {
    result = { ...result, destination };
  }

  const companions = extractCompanionCount(content);
  if (companions != null) {
    result = {
      ...result,
      companions: clampInteger(companions, 1, 10, result.companions)
    };
  }

  const days = extractTripDuration(content);
  if (days != null) {
    result = {
      ...result,
      days: clampInteger(days, 1, 30, result.days)
    };
  }

  const budget = extractBudgetCNY(content);
  if (budget != null) {
    result = {
      ...result,
      budgetCNY: Math.max(0, Math.round(budget))
    };
  }

  const inferredInterests = extractInterestKeywords(content);
  if (inferredInterests.length > 0) {
    result = {
      ...result,
      interests: dedupeInterests([...inferredInterests, ...result.interests])
    };
  }

  return fillDestinationWithFallback(content, result);
}

function extractCompanionCount(content: string): number | null {
  const patterns = [
    /我们有?([一二两三四五六七八九十百千万\d]+)个?人/,
    /([一二两三四五六七八九十百千万\d]+)位(?:朋友|同事|家人|伙伴)/,
    /一行([一二两三四五六七八九十百千万\d]+)人/
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (!match) continue;
    const numeric = parseNumericToken(match[1]);
    if (numeric != null && numeric > 0) {
      return numeric;
    }
  }
  return null;
}

function extractTripDuration(content: string): number | null {
  const pattern = /([一二两三四五六七八九十百千\d]+)\s*(?:天|日)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const preceding = content[match.index - 1] ?? "";
    if (preceding === "每") continue;
    const numeric = parseNumericToken(match[1]);
    if (numeric != null && numeric > 0) {
      return numeric;
    }
  }
  return null;
}

function extractBudgetCNY(content: string): number | null {
  const pattern = /(预算|花费|费用|花|控制在)[^\d一二两三四五六七八九十百千万]{0,6}([一二两三四五六七八九十百千万\d\.]+)\s*([万千百]?)/;
  const match = content.match(pattern);
  if (match) {
    const value = parseNumericToken(match[2]);
    if (value != null) {
      const multiplied = applyUnitMultiplier(value, match[3]);
      if (multiplied != null) {
        return multiplied;
      }
    }
  }

  const generic = /([一二两三四五六七八九十百千万\d\.]+)\s*元/;
  const genericMatch = content.match(generic);
  if (genericMatch) {
    const value = parseNumericToken(genericMatch[1]);
    if (value != null) {
      return value;
    }
  }
  return null;
}

const INTEREST_KEYWORDS: Array<{ pattern: RegExp; interest: string }> = [
  { pattern: /(美食|吃|餐厅|小吃|米其林|夜宵)/, interest: "美食" },
  { pattern: /(景点|观光|打卡|景区|名胜|看风景|看景)/, interest: "文化" },
  { pattern: /(自然|徒步|山|海|户外|露营)/, interest: "自然" },
  { pattern: /(亲子|孩子|小孩|家庭)/, interest: "亲子" },
  { pattern: /(购物|买买买|商场|逛街)/, interest: "购物" },
  { pattern: /(放松|休闲|泡温泉|养生)/, interest: "放松" },
  { pattern: /(夜生活|酒吧|蹦迪)/, interest: "夜生活" },
  { pattern: /(冒险|极限|刺激)/, interest: "冒险" }
];

function extractInterestKeywords(content: string): string[] {
  const matched: string[] = [];
  for (const { pattern, interest } of INTEREST_KEYWORDS) {
    if (pattern.test(content)) {
      matched.push(interest);
    }
  }
  return dedupeInterests(matched);
}

const chineseDigitMap: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};

const chineseUnitMap: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1000,
  万: 10000
};

function parseChineseNumber(text: string): number | null {
  let total = 0;
  let section = 0;
  let current = 0;
  let hasValue = false;

  for (const char of text) {
    if (char in chineseDigitMap) {
      current = chineseDigitMap[char];
      hasValue = true;
    } else if (char in chineseUnitMap) {
      const unit = chineseUnitMap[char];
      if (unit === 10000) {
        section = (section + (current || 0)) * unit;
        total += section;
        section = 0;
      } else {
        section += (current || 1) * unit;
      }
      current = 0;
      hasValue = true;
    }
  }

  const result = total + section + current;
  return hasValue ? result : null;
}

function parseNumericToken(token: string | undefined): number | null {
  if (!token) return null;

  const numericMatch = token.match(/\d+(?:\.\d+)?/);
  if (numericMatch) {
    const value = Number.parseFloat(numericMatch[0]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  const cleaned = token.replace(/[约大概差不多左右上下\s]/g, "");
  return parseChineseNumber(cleaned);
}

function applyUnitMultiplier(value: number, unit: string | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  if (!unit) return value;
  const multiplier = chineseUnitMap[unit];
  return multiplier ? value * multiplier : value;
}

function dedupeInterests(interests: string[]): string[] {
  return Array.from(new Set(interests.filter(Boolean))).slice(0, 6);
}

function inferDestinationHeuristically(content: string): string | null {
  const cleaned = content.replace(/\s+/g, "");
  const patterns = [
    /去([\u4e00-\u9fa5A-Za-z]{2,8})玩/,
    /去([\u4e00-\u9fa5A-Za-z]{2,8})旅/,
    /去([\u4e00-\u9fa5A-Za-z]{2,8})/,
    /到([\u4e00-\u9fa5A-Za-z]{2,8})/,
    /安排([\u4e00-\u9fa5A-Za-z]{2,8})/,
    /计划([\u4e00-\u9fa5A-Za-z]{2,8})行程/
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}