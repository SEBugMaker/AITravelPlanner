"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionContext } from "@supabase/auth-helpers-react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import type { ItineraryPlan, TravelPreferences } from "@core/index";
import { useSpeechRecognition } from "../../hooks/useSpeechRecognition";
import { PlannerMap } from "./planner-map";
import { PlannerWeather } from "./planner-weather";

const quickInterests = ["美食", "自然", "文化", "亲子", "冒险", "购物", "放松", "夜生活"];

interface PlannerFormState extends TravelPreferences {
  persist: boolean;
}

interface SavedItineraryRecord {
  id: string;
  plan: ItineraryPlan;
  preferences: TravelPreferences;
  source: string | null;
  createdAt: string;
}

interface LocationInfo {
  location: {
    longitude: number;
    latitude: number;
    address: string;
    code?: string | null;
    province?: string | null;
    city?: string | null;
  } | null;
  weather: {
    temperature: number | null;
    apparentTemperature: number | null;
    humidity: number | null;
    code: number | null;
  } | null;
}

const defaultFormState: PlannerFormState = {
  destination: "",
  days: 3,
  budgetCNY: 5000,
  companions: 2,
  interests: ["美食"],
  persist: false
};

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

function parsePreferencesFromText(text: string): Partial<TravelPreferences> {
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
      .split(/[、,，\/]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => interestSet.add(item));
  }

  if (interestSet.size > 0) {
    result.interests = Array.from(interestSet).slice(0, 10);
  }

  return result;
}

function formatSpeechStatus(
  supported: boolean,
  listening: boolean,
  processing: boolean,
  transcript: string,
  speechError: string | null
) {
  if (!supported) {
    return { label: "设备不支持", color: "text-rose-500" };
  }
  if (speechError) {
    return { label: speechError, color: "text-rose-500" };
  }
  if (processing) {
    return { label: "识别中…", color: "text-slate-500" };
  }
  if (listening) {
    return { label: "正在录音", color: "text-emerald-600" };
  }
  if (transcript) {
    return { label: "已记录语音内容", color: "text-emerald-600" };
  }
  return { label: "待开始录音", color: "text-slate-400" };
}

export function PlannerShell(): JSX.Element {
  const { session } = useSessionContext();
  const router = useRouter();

  const [formState, setFormState] = useState<PlannerFormState>(defaultFormState);
  const [interestInput, setInterestInput] = useState("");
  const [plan, setPlan] = useState<ItineraryPlan | null>(null);
  const [planSource, setPlanSource] = useState<string | null>(null);
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const [savedItineraries, setSavedItineraries] = useState<SavedItineraryRecord[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const [locationInfo, setLocationInfo] = useState<LocationInfo>({ location: null, weather: null });
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const savedControllerRef = useRef<AbortController | null>(null);
  const locationControllerRef = useRef<AbortController | null>(null);

  const {
    supported,
    listening,
    processing,
    transcript,
    startListening,
    stopListening,
    resetTranscript,
    error: speechError
  } = useSpeechRecognition();

  useEffect(() => {
    return () => {
      savedControllerRef.current?.abort();
      locationControllerRef.current?.abort();
    };
  }, []);

  const speechStatus = useMemo(
    () => formatSpeechStatus(supported, listening, processing, transcript, speechError),
    [supported, listening, processing, transcript, speechError]
  );

  const refreshSavedItineraries = useCallback(async () => {
    if (!session) {
      setSavedItineraries([]);
      setSavedError("登录后即可查看云端行程");
      return;
    }

    savedControllerRef.current?.abort();
    const controller = new AbortController();
    savedControllerRef.current = controller;

    setSavedLoading(true);
    setSavedError(null);

    try {
      const response = await fetch("/api/itineraries?limit=30", {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      });

      if (response.status === 401) {
        setSavedItineraries([]);
        setSavedError("登录后即可查看云端行程");
        return;
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const reason = payload?.message ?? "获取云端行程失败";
        throw new Error(reason);
      }

      const payload = (await response.json()) as { itineraries?: Array<any> };
      const items = Array.isArray(payload.itineraries) ? payload.itineraries : [];
      const mapped: SavedItineraryRecord[] = items
        .map((item) => ({
          id: String(item.id ?? ""),
          plan: item.plan as ItineraryPlan,
          preferences: item.preferences as TravelPreferences,
          source: (item.source ?? null) as string | null,
          createdAt: String(item.created_at ?? item.createdAt ?? new Date().toISOString())
        }))
        .filter((entry) => Boolean(entry.id) && entry.plan && entry.preferences?.destination);

      setSavedItineraries(mapped);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setSavedError(error instanceof Error ? error.message : "获取云端行程失败");
    } finally {
      if (savedControllerRef.current === controller) {
        savedControllerRef.current = null;
      }
      setSavedLoading(false);
    }
  }, [session]);

  const fetchLocationInfo = useCallback(async (destination: string) => {
    const normalized = destination.trim();
    if (!normalized) return;

    locationControllerRef.current?.abort();
    const controller = new AbortController();
    locationControllerRef.current = controller;

    setLocationLoading(true);
    setLocationError(null);

    try {
      const response = await fetch("/api/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination: normalized, includeWeather: true }),
        signal: controller.signal
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const reason = payload?.message ?? "获取目的地信息失败";
        throw new Error(reason);
      }

      const payload = (await response.json()) as LocationInfo;
      setLocationInfo({
        location: payload.location ?? null,
        weather: payload.weather ?? null
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setLocationError(error instanceof Error ? error.message : "获取目的地信息失败");
      setLocationInfo({ location: null, weather: null });
    } finally {
      if (locationControllerRef.current === controller) {
        locationControllerRef.current = null;
      }
      setLocationLoading(false);
    }
  }, []);

  const openSavedDrawer = useCallback(() => {
    if (!session) {
      setSavedItineraries([]);
      setSavedError("登录后即可查看云端行程");
      setIsDrawerOpen(true);
      return;
    }

    setIsDrawerOpen(true);
    void refreshSavedItineraries();
  }, [session, refreshSavedItineraries]);

  const closeSavedDrawer = useCallback(() => {
    setIsDrawerOpen(false);
  }, []);

  const applyContentToPreferences = useCallback(
    (rawContent: string, sourceLabel: string) => {
      const content = rawContent.trim();
      if (!content) {
        setFormSuccess(`${sourceLabel}内容为空，未做任何修改。`);
        return;
      }

      const parsed = parsePreferencesFromText(content);
      const hasStructured = Boolean(
        parsed.destination ||
          parsed.days ||
          parsed.budgetCNY ||
          parsed.companions ||
          (parsed.interests?.length ?? 0) > 0
      );

      if (hasStructured) {
        let destinationToFetch: string | undefined;
        setFormState((prev) => {
          const next = { ...prev };
          if (parsed.destination && parsed.destination !== prev.destination) {
            next.destination = parsed.destination;
            destinationToFetch = parsed.destination;
          }
          if (typeof parsed.days === "number" && parsed.days > 0) {
            next.days = parsed.days;
          }
          if (typeof parsed.budgetCNY === "number" && parsed.budgetCNY >= 0) {
            next.budgetCNY = parsed.budgetCNY;
          }
          if (typeof parsed.companions === "number" && parsed.companions > 0) {
            next.companions = parsed.companions;
          }
          if (parsed.interests?.length) {
            next.interests = Array.from(new Set([...prev.interests, ...parsed.interests])).slice(0, 10);
          }
          return next;
        });

        if (destinationToFetch) {
          void fetchLocationInfo(destinationToFetch);
        }

        setFormSuccess(`${sourceLabel}内容解析完成，已更新旅行偏好。`);
        setFormError(null);
      } else {
        setInterestInput(content);
        setFormSuccess(`${sourceLabel}内容已记录，可整理为兴趣标签。`);
        setFormError(null);
      }
    },
    [fetchLocationInfo]
  );

  const adoptTranscript = useCallback(() => {
    if (!transcript.trim()) return;
    applyContentToPreferences(transcript, "语音");
    resetTranscript();
  }, [transcript, applyContentToPreferences, resetTranscript]);

  const loadSavedItinerary = useCallback(
    (record: SavedItineraryRecord) => {
      if (!record.plan || !record.preferences?.destination) {
        setFormError("云端行程数据不完整，无法载入。");
        return;
      }

      setFormState((prev) => ({
        ...prev,
        ...record.preferences,
        persist: Boolean(session)
      }));
      setPlan(record.plan);
      setPlanSource(record.source ?? "云端行程");
      setActiveDayIndex(0);
      setFormSuccess("已载入云端行程，可继续查看或修改。");
      void fetchLocationInfo(record.preferences.destination);
      closeSavedDrawer();
    },
    [session, fetchLocationInfo, closeSavedDrawer]
  );

  const handleInputChange = useCallback((key: keyof PlannerFormState, value: string | number | boolean) => {
    setFormState((prev) => ({
      ...prev,
      [key]: value
    }));

    if (key === "destination") {
      setLocationInfo({ location: null, weather: null });
      setLocationError(null);
    }
  }, []);

  const toggleInterest = useCallback((interest: string) => {
    setFormState((prev) => ({
      ...prev,
      interests: prev.interests.includes(interest)
        ? prev.interests.filter((item) => item !== interest)
        : [...prev.interests, interest]
    }));
  }, []);

  const addCustomInterest = useCallback(() => {
    const normalized = interestInput.trim();
    if (!normalized) return;

    setFormState((prev) => ({
      ...prev,
      interests: prev.interests.includes(normalized) ? prev.interests : [...prev.interests, normalized]
    }));
    setInterestInput("");
  }, [interestInput]);

  const removeInterest = useCallback((interest: string) => {
    setFormState((prev) => ({
      ...prev,
      interests: prev.interests.filter((item) => item !== interest)
    }));
  }, []);

  const handlePersistToggle = useCallback(
    (checked: boolean) => {
      if (checked && !session) {
        setFormError("请先登录后再保存到云端。");
        router.push("/auth/login");
        return;
      }

      setFormState((prev) => ({
        ...prev,
        persist: checked && Boolean(session)
      }));
    },
    [session, router]
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFormError(null);
      setFormSuccess(null);

      if (!formState.destination.trim()) {
        setFormError("请输入旅行目的地。");
        return;
      }

      if (formState.interests.length === 0) {
        setFormError("请至少选择一个兴趣偏好。");
        return;
      }

      const { persist, ...preferences } = formState;
      const shouldPersist = persist && Boolean(session);

      setIsGenerating(true);
      try {
        const response = await fetch("/api/itineraries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...preferences, persist: shouldPersist })
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload) {
          const message = payload?.message ?? "行程生成失败，请稍后再试。";
          throw new Error(message);
        }

        const itinerary = payload as { plan: ItineraryPlan; source?: string | null };
        setPlan(itinerary.plan);
        setPlanSource(itinerary.source ?? null);
        setActiveDayIndex(0);
        setFormSuccess("行程生成完成！");
        void fetchLocationInfo(preferences.destination);
        if (shouldPersist) {
          void refreshSavedItineraries();
        }
      } catch (error) {
        setPlan(null);
        setPlanSource(null);
        setFormError(error instanceof Error ? error.message : "行程生成失败，请稍后再试。");
      } finally {
        setIsGenerating(false);
      }
    },
    [formState, session, fetchLocationInfo, refreshSavedItineraries]
  );

  useEffect(() => {
    if (!plan) {
      setActiveDayIndex(0);
      return;
    }

    const dayCount = plan.dayPlans.length;
    if (dayCount === 0) {
      setActiveDayIndex(0);
      return;
    }

    if (activeDayIndex >= dayCount) {
      setActiveDayIndex(0);
    }
  }, [plan, activeDayIndex]);

  const dayCountLabel = useMemo(() => {
    if (!plan) {
      return `${formState.days} 天`;
    }
    const count = plan.dayPlans.length;
    return count > 0 ? `${count} 天排期` : `${formState.days} 天`;
  }, [plan, formState.days]);

  const selectedDayPlan = useMemo(() => {
    if (!plan || plan.dayPlans.length === 0) return null;
    const index = Math.min(activeDayIndex, plan.dayPlans.length - 1);
    return plan.dayPlans[index] ?? null;
  }, [plan, activeDayIndex]);

  const clearPlan = useCallback(() => {
    setPlan(null);
    setPlanSource(null);
    setActiveDayIndex(0);
  }, []);

  return (
    <Fragment>
      <div className="px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-8">
          <header className="rounded-3xl bg-white/80 p-8 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-semibold text-slate-900">智能行程规划工作台</h1>
                <p className="mt-2 max-w-3xl text-sm text-slate-600">
                  可通过语音速记或手动填写旅行偏好，系统会自动解析目的地、预算、天数、同行人数与兴趣，调用大模型生成包含交通、住宿、景点、餐厅的个性化行程。
                </p>
              </div>
              <button
                type="button"
                onClick={openSavedDrawer}
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
              >
                我的云端行程
              </button>
            </div>
          </header>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,380px)_1fr]">
            <section className="space-y-6">
              <form onSubmit={handleSubmit} className="space-y-6 rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">旅行偏好</h2>
                  <span className="text-sm text-slate-500">{dayCountLabel}</span>
                </div>

                <div className="space-y-3">
                  <label className="block text-sm font-medium text-slate-700">目的地</label>
                  <input
                    required
                    value={formState.destination}
                    onChange={(event) => handleInputChange("destination", event.target.value)}
                    placeholder="例如：成都、三亚、京都"
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-inner focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-slate-700">行程天数</label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={formState.days}
                      onChange={(event) => handleInputChange("days", Number(event.target.value))}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-inner focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-slate-700">同行人数</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={formState.companions}
                      onChange={(event) => handleInputChange("companions", Number(event.target.value))}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-inner focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="block text-sm font-medium text-slate-700">预算参考（人民币）</label>
                  <input
                    type="number"
                    min={0}
                    value={formState.budgetCNY}
                    onChange={(event) => handleInputChange("budgetCNY", Number(event.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-inner focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-700">兴趣偏好</label>
                    <button type="button" onClick={clearPlan} className="text-xs text-slate-500 hover:text-slate-700">
                      清空行程
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {quickInterests.map((interest) => (
                      <button
                        key={interest}
                        type="button"
                        onClick={() => toggleInterest(interest)}
                        className={clsx(
                          "rounded-full border px-3 py-1 text-sm",
                          formState.interests.includes(interest)
                            ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
                        )}
                      >
                        {interest}
                      </button>
                    ))}
                  </div>

                  {formState.interests.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {formState.interests.map((interest) => (
                        <span key={interest} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                          {interest}
                          <button
                            type="button"
                            aria-label={`移除 ${interest}`}
                            onClick={() => removeInterest(interest)}
                            className="text-slate-400 transition hover:text-slate-600"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="flex gap-2">
                    <input
                      value={interestInput}
                      onChange={(event) => setInterestInput(event.target.value)}
                      placeholder="输入自定义偏好，例如：滑雪/小众博物馆"
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                    />
                    <button
                      type="button"
                      onClick={addCustomInterest}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
                    >
                      添加
                    </button>
                  </div>
                </div>

                <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={formState.persist && Boolean(session)}
                    disabled={!session}
                    onChange={(event) => handlePersistToggle(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <span>生成后保存到云端行程（需登录）</span>
                </label>

                <button
                  type="submit"
                  disabled={isGenerating}
                  className="w-full rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGenerating ? "正在生成行程…" : "生成智能行程"}
                </button>

                {formError ? <p className="text-xs text-rose-500">{formError}</p> : null}
                {formSuccess ? <p className="text-xs text-emerald-600">{formSuccess}</p> : null}
              </form>

              <section className="space-y-3 rounded-3xl border border-slate-200 bg-white/70 p-5 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">语音速记</h3>
                    <p className="text-xs text-slate-500">通过语音快速补充偏好，可自动解析目的地、预算、天数、同行人数与兴趣标签。</p>
                  </div>
                  <span className={clsx("text-xs", speechStatus.color)}>{speechStatus.label}</span>
                </div>

                {!supported ? (
                  <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-500">当前浏览器不支持麦克风录音或权限受限。</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (processing) return;
                          return listening ? stopListening() : startListening();
                        }}
                        disabled={processing}
                        className={clsx(
                          "flex-1 rounded-xl px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70",
                          processing
                            ? "bg-slate-500"
                            : listening
                              ? "bg-rose-500 hover:bg-rose-400"
                              : "bg-slate-900 hover:bg-slate-800"
                        )}
                      >
                        {processing ? "识别中…" : listening ? "正在录音…点击停止" : "开始语音输入"}
                      </button>
                      <button
                        type="button"
                        onClick={resetTranscript}
                        disabled={processing || listening}
                        className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        清空
                      </button>
                    </div>
                    {speechError ? <p className="text-xs text-rose-500">{speechError}</p> : null}
                    <textarea
                      value={transcript}
                      readOnly
                      rows={4}
                      placeholder="语音内容会在此显示，可点击下方按钮解析并填充偏好"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={!transcript || processing}
                      onClick={adoptTranscript}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {transcript ? "解析语音内容并填充偏好" : processing ? "识别中" : "等待语音内容"}
                    </button>
                  </div>
                )}
              </section>
            </section>

            <section className="space-y-6">
              <article className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">行程概览</h2>
                    <p className="text-xs text-slate-500">模型生成的每日安排、交通与餐饮推荐</p>
                  </div>
                  {planSource ? (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">来源：{planSource}</span>
                  ) : null}
                </div>

                {plan ? (
                  <div className="mt-4 space-y-4">
                    <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{plan.overview}</p>

                    {plan.dayPlans.length > 0 ? (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <p className="text-xs text-slate-500">
                            {selectedDayPlan ? `当前查看第 ${selectedDayPlan.day} 天行程` : "等待行程数据…"}
                          </p>
                          {plan.dayPlans.length > 1 ? (
                            <div className="flex flex-wrap gap-2">
                              {plan.dayPlans.map((dayPlan, index) => (
                                <button
                                  key={dayPlan.day}
                                  type="button"
                                  onClick={() => setActiveDayIndex(index)}
                                  className={clsx(
                                    "rounded-full border px-3 py-1 text-xs font-medium transition",
                                    index === activeDayIndex
                                      ? "border-sky-500 bg-sky-100 text-sky-700"
                                      : "border-slate-300 text-slate-600 hover:border-slate-400"
                                  )}
                                >
                                  第 {dayPlan.day} 天
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        {selectedDayPlan ? (
                          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white/70 p-5">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-500">第 {selectedDayPlan.day} 天</p>
                                <p className="text-base font-medium text-slate-900">{selectedDayPlan.summary}</p>
                              </div>
                              {typeof selectedDayPlan.estimatedCost === "number" ? (
                                <span className="text-sm text-slate-500">≈ ¥{selectedDayPlan.estimatedCost}</span>
                              ) : null}
                            </div>

                            {selectedDayPlan.transportation?.length ? (
                              <div>
                                <p className="text-xs font-semibold text-slate-500">交通安排</p>
                                <ul className="mt-2 space-y-2">
                                  {selectedDayPlan.transportation.map((segment, index) => (
                                    <li key={`${segment.mode}-${index}`} className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="font-semibold text-slate-700">{segment.mode}</span>
                                        {typeof segment.costEstimate === "number" ? (
                                          <span className="text-[11px] text-slate-400">≈ ¥{segment.costEstimate}</span>
                                        ) : null}
                                      </div>
                                      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-500">
                                        {segment.origin ? <span>出发：{segment.origin}</span> : null}
                                        {segment.destination ? <span>抵达：{segment.destination}</span> : null}
                                        {segment.departureTime ? <span>出发时间：{segment.departureTime}</span> : null}
                                        {segment.arrivalTime ? <span>到达时间：{segment.arrivalTime}</span> : null}
                                        {segment.duration ? <span>时长：{segment.duration}</span> : null}
                                      </div>
                                      {segment.detail ? <p className="mt-1 text-[11px] text-slate-500">{segment.detail}</p> : null}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            {selectedDayPlan.accommodation ? (
                              <div>
                                <p className="text-xs font-semibold text-slate-500">住宿安排</p>
                                <div className="mt-2 space-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                                  <p className="font-medium text-slate-700">{selectedDayPlan.accommodation.name}</p>
                                  {selectedDayPlan.accommodation.address ? (
                                    <p className="text-xs text-slate-500">地址：{selectedDayPlan.accommodation.address}</p>
                                  ) : null}
                                  <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                                    {selectedDayPlan.accommodation.checkIn ? <span>入住：{selectedDayPlan.accommodation.checkIn}</span> : null}
                                    {selectedDayPlan.accommodation.checkOut ? <span>退房：{selectedDayPlan.accommodation.checkOut}</span> : null}
                                    {typeof selectedDayPlan.accommodation.costEstimate === "number" ? (
                                      <span>参考价：¥{selectedDayPlan.accommodation.costEstimate}</span>
                                    ) : null}
                                  </div>
                                  {selectedDayPlan.accommodation.notes ? (
                                    <p className="text-xs text-slate-500">{selectedDayPlan.accommodation.notes}</p>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}

                            {selectedDayPlan.locations?.length ? (
                              <div>
                                <p className="text-xs font-semibold text-slate-500">路线节点</p>
                                <ol className="mt-2 space-y-2">
                                  {selectedDayPlan.locations.map((location, index) => (
                                    <li key={`${location.name}-${index}`} className="flex items-start gap-2 text-sm text-slate-600">
                                      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[11px] font-semibold text-sky-700">
                                        {index + 1}
                                      </span>
                                      <div className="min-w-0">
                                        <p className="truncate font-medium text-slate-700">{location.name}</p>
                                        {location.address ? <p className="text-xs text-slate-400">{location.address}</p> : null}
                                      </div>
                                    </li>
                                  ))}
                                </ol>
                              </div>
                            ) : null}

                            {selectedDayPlan.restaurants?.length ? (
                              <div>
                                <p className="text-xs font-semibold text-slate-500">餐厅推荐</p>
                                <ul className="mt-2 space-y-2">
                                  {selectedDayPlan.restaurants.map((restaurant, index) => (
                                    <li key={`${restaurant.name}-${index}`} className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="font-semibold text-slate-700">{restaurant.name}</span>
                                        {typeof restaurant.budgetPerPerson === "number" ? (
                                          <span className="text-[11px] text-slate-400">人均 ≈ ¥{restaurant.budgetPerPerson}</span>
                                        ) : null}
                                      </div>
                                      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-500">
                                        {restaurant.cuisine ? <span>菜系：{restaurant.cuisine}</span> : null}
                                        {restaurant.time ? <span>用餐时间：{restaurant.time}</span> : null}
                                        {typeof restaurant.reservation === "boolean" ? (
                                          <span>{restaurant.reservation ? "需预约" : "无需预约"}</span>
                                        ) : null}
                                      </div>
                                      {restaurant.address ? <p className="mt-1 text-[11px] text-slate-500">地址：{restaurant.address}</p> : null}
                                      {restaurant.mustTry ? <p className="mt-1 text-[11px] text-slate-500">必点：{restaurant.mustTry}</p> : null}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            {selectedDayPlan.meals?.length ? (
                              <div>
                                <p className="text-xs font-semibold text-slate-500">整体餐饮安排</p>
                                <p className="mt-1 text-sm text-slate-600">{selectedDayPlan.meals.join("、")}</p>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-6 py-10 text-center text-sm text-slate-500">
                    暂未生成行程。提交偏好后将在此展示完整行程安排。
                  </div>
                )}
              </article>

              <article className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">目的地地图与天气</h2>
                    <p className="text-xs text-slate-500">展示目的地位置与实时天气状况</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void fetchLocationInfo(formState.destination)}
                    disabled={locationLoading || !formState.destination}
                    className="rounded-full border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {locationLoading ? "刷新中…" : "刷新"}
                  </button>
                </div>

                {plan ? (
                  <div className="mt-4 space-y-4">
                    <PlannerMap
                      destination={formState.destination ? formState.destination : null}
                      baseLocation={locationInfo.location ? {
                        latitude: locationInfo.location.latitude,
                        longitude: locationInfo.location.longitude,
                        address: locationInfo.location.address
                      } : null}
                      dayLocations={selectedDayPlan?.locations ?? []}
                      selectedDay={selectedDayPlan?.day ?? null}
                      loading={locationLoading}
                      error={locationError}
                    />

                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                      {locationLoading && !locationInfo.location ? (
                        <p className="text-xs text-slate-500">正在获取天气信息…</p>
                      ) : (
                        <PlannerWeather
                          temperature={locationInfo.weather?.temperature ?? null}
                          apparentTemperature={locationInfo.weather?.apparentTemperature ?? null}
                          humidity={locationInfo.weather?.humidity ?? null}
                          code={locationInfo.weather?.code ?? null}
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-6 py-8 text-center text-sm text-slate-500">
                    生成行程后将自动加载目的地地图与天气信息。
                  </div>
                )}
              </article>
            </section>
          </div>
        </div>
      </div>

      {isDrawerOpen ? (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" role="presentation" onClick={closeSavedDrawer} />
          <aside className="relative ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-slate-200 p-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">我的云端行程</h2>
                <p className="mt-1 text-xs text-slate-500">查看最近保存的行程方案，并一键载入继续规划。</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!session) {
                      setSavedItineraries([]);
                      setSavedError("登录后即可查看云端行程");
                      return;
                    }
                    void refreshSavedItineraries();
                  }}
                  disabled={savedLoading || (!session && !savedError)}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savedLoading ? "刷新中…" : "刷新"}
                </button>
                <button
                  type="button"
                  onClick={closeSavedDrawer}
                  className="rounded-full border border-transparent p-1 text-slate-400 transition hover:text-slate-600"
                  aria-label="关闭云端行程抽屉"
                >
                  ×
                </button>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto p-5">
              {!session ? (
                <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-500">
                  登录后即可保存并查看云端行程。
                </p>
              ) : savedError ? (
                <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-500">{savedError}</p>
              ) : savedItineraries.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-500">
                  生成行程并保存后，将在此处展示最近的记录。
                </p>
              ) : (
                <ul className="space-y-4">
                  {savedItineraries.map((item) => (
                    <li key={item.id} className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{item.preferences.destination}</p>
                          <p className="text-[11px] text-slate-500">
                            {new Date(item.createdAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => loadSavedItinerary(item)}
                          className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
                        >
                          载入行程
                        </button>
                      </div>
                      <div className="mt-3 space-y-1 text-xs text-slate-600">
                        <p>天数：{item.plan.dayPlans?.length ?? 0} 天 • 预算：¥{item.preferences.budgetCNY}</p>
                        <p>兴趣：{item.preferences.interests?.join("、") || "未记录"}</p>
                        {item.source ? <p className="text-[11px] text-slate-400">来源：{item.source}</p> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </Fragment>
  );
}
