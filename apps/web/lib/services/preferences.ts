import type { TravelPreferences } from "@core/index";

export const quickInterests: string[] = ["美食", "自然", "文化", "亲子", "冒险", "购物", "放松", "夜生活"];

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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toNumberOrNull = (value: unknown) => {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }
  return value;
};

export const defaultTravelPreferences: TravelPreferences = {
  destination: "",
  days: 3,
  budgetCNY: 5000,
  companions: 2,
  interests: ["美食"]
};

export function parsePreferencesFromText(text: string): Partial<TravelPreferences> {
  const normalized = text.replace(/\s+/g, "");
  const result: Partial<TravelPreferences> = {};

  const destinationMatch = normalized.match(/(?:去|到|前往|想去)([\u4e00-\u9fa5A-Za-z\d]{2,})/);
  if (destinationMatch?.[1]) {
    result.destination = destinationMatch[1].replace(/(旅游|旅行|玩|看看)$/u, "");
  }

  const dayMatch = normalized.match(/([零一二两三四五六七八九十百千万\d\.]+)天/);
  const parsedDays = parseNumericToken(dayMatch?.[1] ?? "");
  if (parsedDays && parsedDays > 0) {
    result.days = Math.min(30, Math.max(1, Math.round(parsedDays)));
  }

  const budgetMatch = normalized.match(/预算(?:大概|大约|约)?([零一二两三四五六七八九十百千万\d\.]+)(万|千|百)?(?:元|块|人民币|rmb|cny)?/i);
  const parsedBudget = applyUnitMultiplier(parseNumericToken(budgetMatch?.[1] ?? ""), budgetMatch?.[2]);
  if (parsedBudget != null) {
    result.budgetCNY = Math.max(0, Math.round(parsedBudget));
  }

  const companionMatch = normalized.match(/([零一二两三四五六七八九十百千万\d\.]+)(?:位|人|名)(?:同行|一起|出行)?/);
  const parsedCompanions = parseNumericToken(companionMatch?.[1] ?? "");
  if (parsedCompanions && parsedCompanions > 0) {
    result.companions = Math.min(10, Math.max(1, Math.round(parsedCompanions)));
  }

  const interestSet = new Set<string>();
  for (const interest of quickInterests) {
    if (normalized.includes(interest)) {
      interestSet.add(interest);
    }
  }

  const interestSegmentMatch = normalized.match(/喜欢([^。！!?？；;]+)/);
  if (interestSegmentMatch?.[1]) {
    interestSegmentMatch[1]
      .split(/[、,，\//]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => interestSet.add(item));
  }

  if (interestSet.size > 0) {
    result.interests = Array.from(interestSet).slice(0, 10);
  }

  return result;
}

export function buildTravelPreferencesFromParsed(parsed: Partial<TravelPreferences>): TravelPreferences | null {
  const destination = parsed.destination?.trim();
  if (!destination) {
    return null;
  }

  const result: TravelPreferences = {
    destination,
    days: defaultTravelPreferences.days,
    budgetCNY: defaultTravelPreferences.budgetCNY,
    companions: defaultTravelPreferences.companions,
    interests: defaultTravelPreferences.interests
  };

  const days = toNumberOrNull(parsed.days);
  if (days != null) {
    result.days = clamp(Math.round(days), 1, 30);
  }

  const budget = toNumberOrNull(parsed.budgetCNY);
  if (budget != null) {
    result.budgetCNY = Math.max(0, Math.round(budget));
  }

  const companions = toNumberOrNull(parsed.companions);
  if (companions != null) {
    result.companions = clamp(Math.round(companions), 1, 10);
  }

  if (Array.isArray(parsed.interests) && parsed.interests.length > 0) {
    const unique = Array.from(new Set(parsed.interests)).filter(Boolean).slice(0, 10);
    if (unique.length > 0) {
      result.interests = unique;
    }
  }

  return result;
}

function parseNumericToken(token: string): number | null {
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

function applyUnitMultiplier(value: number | null, unit: string | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (!unit) return value;

  const map: Record<string, number> = {
    十: 10,
    百: 100,
    千: 1000,
    万: 10000
  };

  return map[unit] ? value * map[unit] : value;
}

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
