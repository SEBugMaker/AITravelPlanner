"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionContext } from "@supabase/auth-helpers-react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import type { ItineraryPlan, TravelPreferences } from "@core/index";
import { estimateBudget, type BudgetItem } from "../../lib/services/budget";
import {
  defaultTravelPreferences,
  parsePreferencesFromText,
  quickInterests
} from "../../lib/services/preferences";
import { useSpeechRecognition } from "../../hooks/useSpeechRecognition";
import { PlannerMap } from "./planner-map";
import { PlannerWeather } from "./planner-weather";

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
  ...defaultTravelPreferences,
  persist: false
};

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

const expenseCategories: BudgetItem["category"][] = ["transport", "accommodation", "dining", "activities", "buffer"];

const budgetCategoryLabels: Record<BudgetItem["category"], string> = {
  transport: "交通",
  accommodation: "住宿",
  dining: "餐饮",
  activities: "活动",
  buffer: "机动"
};

interface ExpenseDraft {
  amount: string;
  category: BudgetItem["category"];
  note: string;
}

interface ExpenseRecord {
  id: string;
  amount: number;
  category: BudgetItem["category"];
  note: string;
  createdAt: string;
  occurredAt: string;
  currency: string;
  origin: "local" | "remote";
}

interface SecretInfo {
  configured: boolean;
  preview: string | null;
  value: string | null;
}

type SecretBundle = Record<"llm" | "supabase" | "amap" | "xfyun", SecretInfo>;

function createEmptySecretInfo(): SecretInfo {
  return { configured: false, preview: null, value: null };
}

function createDefaultSecretBundle(): SecretBundle {
  return {
    llm: createEmptySecretInfo(),
    supabase: createEmptySecretInfo(),
    amap: createEmptySecretInfo(),
    xfyun: createEmptySecretInfo()
  };
}

function maskSecretForDisplay(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= 6) {
    return trimmed;
  }
  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-3);
  return `${prefix}${"*".repeat(Math.max(3, trimmed.length - 6))}${suffix}`;
}

function formatCurrency(value: number | null | undefined, fractionDigits = 0): string {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return "¥0";
  }
  const safeValue = Number(value);
  return `¥${safeValue.toLocaleString("zh-CN", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  })}`;
}

function pickSegmentColor(ratio: number): string {
  if (Number.isNaN(ratio) || ratio <= 0.6) {
    return "bg-sky-500";
  }
  if (ratio <= 0.9) {
    return "bg-amber-500";
  }
  return "bg-rose-500";
}

function generateExpenseId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 11);
}

export function PlannerShell(): JSX.Element {
  const { session } = useSessionContext();
  const router = useRouter();

  const [formState, setFormState] = useState<PlannerFormState>(defaultFormState);
  const [interestInput, setInterestInput] = useState("");
  const [plan, setPlan] = useState<ItineraryPlan | null>(null);
  const [planSource, setPlanSource] = useState<string | null>(null);
  const [currentItineraryId, setCurrentItineraryId] = useState<string | null>(null);
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isTranscriptGenerating, setIsTranscriptGenerating] = useState(false);
  const [isSavingItinerary, setIsSavingItinerary] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [cloudSecrets, setCloudSecrets] = useState<SecretBundle>(createDefaultSecretBundle);
  const [cloudSecretsLoading, setCloudSecretsLoading] = useState(false);

  const [savedItineraries, setSavedItineraries] = useState<SavedItineraryRecord[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const [locationInfo, setLocationInfo] = useState<LocationInfo>({ location: null, weather: null });
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft>({ amount: "", category: "transport", note: "" });
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [expensesLoading, setExpensesLoading] = useState(false);
  const [expenseSubmitting, setExpenseSubmitting] = useState(false);

  const savedControllerRef = useRef<AbortController | null>(null);
  const locationControllerRef = useRef<AbortController | null>(null);
  const expenseControllerRef = useRef<AbortController | null>(null);
  const secretsControllerRef = useRef<AbortController | null>(null);

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

  const llmKeyConfigured = cloudSecrets.llm.configured;
  const llmKeyPreview = cloudSecrets.llm.value ?? cloudSecrets.llm.preview;
  const envSupabaseValue = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  const envSupabasePreview = envSupabaseValue ? maskSecretForDisplay(envSupabaseValue) : null;
  const supabaseKeyConfigured = cloudSecrets.supabase.configured || Boolean(envSupabasePreview);
  const amapKeyConfigured = cloudSecrets.amap.configured;
  const amapKeyValue = cloudSecrets.amap.value ?? null;
  const xfyunKeyConfigured = cloudSecrets.xfyun.configured;

  const applyEnvSecrets = useCallback((target: SecretBundle) => {
    if (envSupabasePreview && !target.supabase.configured) {
      target.supabase = {
        configured: true,
        preview: envSupabasePreview,
        value: null
      };
    }
  }, [envSupabasePreview]);

  const refreshSecretStatus = useCallback(async () => {
    secretsControllerRef.current?.abort();

    if (!session) {
      const fallback = createDefaultSecretBundle();
      applyEnvSecrets(fallback);
      setCloudSecrets(fallback);
      setCloudSecretsLoading(false);
      return;
    }

    const controller = new AbortController();
    secretsControllerRef.current = controller;
    setCloudSecretsLoading(true);

    try {
      const response = await fetch("/api/settings/secrets", {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      });

      if (response.status === 401) {
        const fallback = createDefaultSecretBundle();
        applyEnvSecrets(fallback);
        setCloudSecrets(fallback);
        return;
      }

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        const message = payload?.message ?? "获取密钥状态失败";
        throw new Error(message);
      }

      const entries: Array<{ key?: string; preview?: string | null; value?: string | null }> = Array.isArray(
        (payload as any).secrets
      )
        ? (payload as any).secrets
        : [];
      const map = new Map(
        entries
          .filter((item) => typeof item?.key === "string")
          .map((item) => [String(item?.key), item])
      );

      const next = createDefaultSecretBundle();

      const assign = (targetKey: keyof SecretBundle, possibleKeys: string[]) => {
        const entry = possibleKeys.map((name) => map.get(name)).find(Boolean);
        if (!entry) {
          next[targetKey] = createEmptySecretInfo();
          return;
        }
        next[targetKey] = {
          configured: true,
          preview: typeof entry.preview === "string" ? entry.preview : null,
          value: typeof entry.value === "string" ? entry.value : null
        };
      };

      assign("llm", ["llmApiKey", "bailianApiKey"]);
      assign("supabase", ["supabaseAnonKey"]);
      assign("amap", ["amapWebKey", "amapApiKey"]);
      assign("xfyun", ["xfyunAppSecret"]);

      applyEnvSecrets(next);

      setCloudSecrets(next);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      console.error("[PlannerShell] refreshSecretStatus failed", error);
      const fallback = createDefaultSecretBundle();
      applyEnvSecrets(fallback);
      setCloudSecrets(fallback);
    } finally {
      if (secretsControllerRef.current === controller) {
        secretsControllerRef.current = null;
      }
      setCloudSecretsLoading(false);
    }
  }, [session, supabaseKeyConfigured, applyEnvSecrets]);

  useEffect(() => {
    return () => {
      savedControllerRef.current?.abort();
      locationControllerRef.current?.abort();
      expenseControllerRef.current?.abort();
      secretsControllerRef.current?.abort();
    };
  }, []);

  const speechStatus = useMemo(() => {
    if (cloudSecretsLoading) {
      return { label: "正在检测密钥…", color: "text-slate-500" };
    }
    if (!xfyunKeyConfigured) {
      return { label: "请先配置讯飞语音密钥", color: "text-amber-600" };
    }
    return formatSpeechStatus(supported, listening, processing, transcript, speechError);
  }, [cloudSecretsLoading, xfyunKeyConfigured, supported, listening, processing, transcript, speechError]);

  useEffect(() => {
    void refreshSecretStatus();
  }, [refreshSecretStatus]);

  const refreshSavedItineraries = useCallback(async () => {
    if (!session) {
      setSavedItineraries([]);
      setSavedError("登录后即可查看云端行程");
      return;
    }

    if (!supabaseKeyConfigured) {
      setSavedItineraries([]);
      setSavedError("尚未配置 Supabase 匿名密钥，云端行程不可用。");
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

    if (!amapKeyConfigured) {
      setLocationInfo({ location: null, weather: null });
      setLocationError("请先在设置页配置高德地图密钥后再加载目的地。");
      return;
    }

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
  }, [amapKeyConfigured]);

  const fetchExpensesForItinerary = useCallback(async (itineraryId: string) => {
    const normalized = itineraryId.trim();
    if (!normalized) {
      setExpenses([]);
      return;
    }

    if (!supabaseKeyConfigured) {
      setExpenses([]);
      setExpenseError("尚未配置 Supabase 匿名密钥，无法同步云端消费记录。");
      return;
    }

    expenseControllerRef.current?.abort();
    const controller = new AbortController();
    expenseControllerRef.current = controller;

    setExpensesLoading(true);
    setExpenseError(null);

    try {
      const response = await fetch(`/api/expenses?itineraryId=${encodeURIComponent(normalized)}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      });

      if (response.status === 401) {
        setExpenses([]);
        setExpenseError("登录后即可查看消费记录");
        return;
      }

      if (response.status === 403) {
        setExpenses([]);
        setExpenseError("暂无权访问该行程的消费记录");
        return;
      }

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        const reason = payload?.message ?? "获取消费记录失败";
        throw new Error(reason);
      }

      const items = Array.isArray(payload.expenses) ? payload.expenses : [];
      const mapped: ExpenseRecord[] = items
        .map((item: any) => {
          const categoryCandidate = String(item.category ?? "");
          const safeCategory = expenseCategories.includes(categoryCandidate as BudgetItem["category"])
            ? (categoryCandidate as BudgetItem["category"])
            : "activities";

          const amount = Number(item.amount ?? 0);
          if (!Number.isFinite(amount) || amount < 0) {
            return null;
          }

          const occurredAt = String(item.occurredAt ?? item.occurred_at ?? item.createdAt ?? item.created_at ?? new Date().toISOString());
          const createdAt = String(item.createdAt ?? item.created_at ?? occurredAt);

          return {
            id: String(item.id ?? generateExpenseId()),
            amount,
            category: safeCategory,
            note: typeof item.note === "string" ? item.note : "",
            currency: typeof item.currency === "string" && item.currency.trim() ? item.currency : "CNY",
            occurredAt,
            createdAt,
            origin: "remote"
          } as ExpenseRecord;
        })
  .filter((entry: ExpenseRecord | null): entry is ExpenseRecord => entry !== null);

      setExpenses(mapped);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setExpenseError(error instanceof Error ? error.message : "获取消费记录失败");
      setExpenses([]);
    } finally {
      if (expenseControllerRef.current === controller) {
        expenseControllerRef.current = null;
      }
      setExpensesLoading(false);
    }
  }, [supabaseKeyConfigured]);

  const openSavedDrawer = useCallback(() => {
    if (!session) {
      setSavedItineraries([]);
      setSavedError("登录后即可查看云端行程");
      setIsDrawerOpen(true);
      return;
    }

    if (!supabaseKeyConfigured) {
      setSavedItineraries([]);
      setSavedError("尚未配置 Supabase 匿名密钥，无法访问云端行程。");
      setIsDrawerOpen(true);
      return;
    }

    setIsDrawerOpen(true);
    void refreshSavedItineraries();
  }, [session, supabaseKeyConfigured, refreshSavedItineraries]);

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

  const ensureLlmKeyReady = useCallback(() => {
    if (cloudSecretsLoading) {
      setFormError("正在检测云端密钥状态，请稍候…");
      setFormSuccess(null);
      return false;
    }
    if (!llmKeyConfigured) {
      setFormError("请先在设置页面配置阿里云百炼 API Key，再生成智能行程。");
      setFormSuccess(null);
      return false;
    }
    return true;
  }, [cloudSecretsLoading, llmKeyConfigured]);

  const submitTranscriptToAI = useCallback(async () => {
    const content = transcript.trim();
    if (!content) {
      setFormError("请先录入语音内容。");
      return;
    }

    if (!ensureLlmKeyReady()) {
      return;
    }

  const shouldPersist = formState.persist && Boolean(session) && supabaseKeyConfigured;

    setFormError(null);
    setFormSuccess(null);
    setIsTranscriptGenerating(true);
    try {
  const response = await fetch("/api/itineraries/from-transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: content, persist: shouldPersist })
      });

      const payload = await response.json().catch(() => null);

      if (response.status === 401) {
        setFormError(payload?.message ?? "请先登录后再使用云端生成功能。");
        return;
      }

      if (response.status === 422) {
        const parsed = payload?.parsedPreferences ?? {};
        setFormState((prev) => ({
          ...prev,
          ...parsed,
          persist: prev.persist
        }));
        setFormError(payload?.message ?? "语音内容缺少关键信息，请确认后再试。");
        return;
      }

      if (!response.ok || !payload) {
        const message = payload?.message ?? "语音行程生成失败";
        throw new Error(message);
      }

      const itinerary = payload as {
        plan: ItineraryPlan;
        source?: string | null;
        note?: string | null;
        itineraryId?: string | null;
        preferences: TravelPreferences;
        usedFallback?: boolean;
      };

      if (!itinerary.plan || !itinerary.preferences) {
        throw new Error("语音行程生成失败，返回数据不完整");
      }

      setPlan(itinerary.plan);
      setPlanSource(itinerary.source ?? "语音生成");
      setCurrentItineraryId(itinerary.itineraryId ?? null);
      setExpenses([]);
      setExpenseError(null);
      setActiveDayIndex(0);
      setFormState((prev) => ({
        ...prev,
        ...itinerary.preferences,
        persist: shouldPersist
      }));
      setFormSuccess(itinerary.usedFallback ? "行程已生成，部分字段采用默认值，可继续调整。" : "语音行程生成完成！");
      void fetchLocationInfo(itinerary.preferences.destination);
      if (shouldPersist) {
        void refreshSavedItineraries();
      }
      resetTranscript();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "语音行程生成失败");
    } finally {
      setIsTranscriptGenerating(false);
    }
  }, [
    transcript,
    ensureLlmKeyReady,
    formState.persist,
    session,
    fetchLocationInfo,
    refreshSavedItineraries,
    resetTranscript,
    setFormState
  ]);

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
      setCurrentItineraryId(record.id ?? null);
      setExpenses([]);
      setActiveDayIndex(0);
      setFormSuccess("已载入云端行程，可继续查看或修改。");
  setExpenseError(null);
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

  const handleExpenseFieldChange = useCallback(<Key extends keyof ExpenseDraft>(key: Key, value: string) => {
    setExpenseDraft((prev) => ({
      ...prev,
      [key]: value
    }));
  }, []);

  const addExpense = useCallback(async () => {
    setExpenseError(null);
    const normalizedAmount = Number.parseFloat(expenseDraft.amount);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      setExpenseError("请输入有效的金额");
      return;
    }

    const amountValue = Number(normalizedAmount.toFixed(2));
    const noteValue = expenseDraft.note.trim();

    const appendLocal = (message: string | null) => {
      const timestamp = new Date().toISOString();
      const record: ExpenseRecord = {
        id: generateExpenseId(),
        amount: amountValue,
        category: expenseDraft.category,
        note: noteValue,
        createdAt: timestamp,
        occurredAt: timestamp,
        currency: "CNY",
        origin: "local"
      };

      setExpenses((prev) => [record, ...prev]);
      setExpenseDraft((prev) => ({ amount: "", category: prev.category, note: "" }));
      if (message) {
        setExpenseError(message);
      }
    };

    if (!session) {
      appendLocal("未登录，仅在本地保存。登录并保存行程后可同步到云端。");
      return;
    }

    if (!supabaseKeyConfigured) {
      appendLocal("尚未配置 Supabase 密钥，消费记录暂存于本地。");
      return;
    }

    if (!currentItineraryId) {
      appendLocal("行程未保存到云端，此消费仅保存在本地。");
      return;
    }

    setExpenseSubmitting(true);
    try {
      const response = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itineraryId: currentItineraryId,
          amount: amountValue,
          category: expenseDraft.category,
          note: noteValue || undefined,
          occurredAt: new Date().toISOString()
        })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.message ?? "记录消费失败";
        throw new Error(message);
      }

      setExpenseDraft((prev) => ({ amount: "", category: prev.category, note: "" }));
      await fetchExpensesForItinerary(currentItineraryId);
    } catch (error) {
      setExpenseError(error instanceof Error ? error.message : "记录消费失败");
    } finally {
      setExpenseSubmitting(false);
    }
  }, [expenseDraft, session, supabaseKeyConfigured, currentItineraryId, fetchExpensesForItinerary]);

  const removeExpense = useCallback(
    async (record: ExpenseRecord) => {
      setExpenseError(null);

      if (record.origin === "remote" && session && currentItineraryId && supabaseKeyConfigured) {
        try {
          const response = await fetch("/api/expenses", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: record.id })
          });

          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            const message = payload?.message ?? "删除消费记录失败";
            throw new Error(message);
          }

          await fetchExpensesForItinerary(currentItineraryId);
        } catch (error) {
          setExpenseError(error instanceof Error ? error.message : "删除消费记录失败");
        }
        return;
      }

      if (record.origin === "remote" && !supabaseKeyConfigured) {
        setExpenseError("尚未配置 Supabase 密钥，无法操作云端消费记录。");
        return;
      }

      setExpenses((prev) => prev.filter((expense) => expense.id !== record.id));
    },
    [session, supabaseKeyConfigured, currentItineraryId, fetchExpensesForItinerary]
  );

  const saveItineraryManually = useCallback(async () => {
    if (!plan) {
      setFormError("当前没有可保存的行程。");
      return;
    }

    if (!session) {
      setFormError("请先登录后再保存到云端。");
      router.push("/auth/login");
      return;
    }

    if (!supabaseKeyConfigured) {
      setFormError("请先在设置页面配置 Supabase 匿名密钥，再保存到云端。");
      setFormSuccess(null);
      return;
    }

    setIsSavingItinerary(true);
    setFormError(null);
    setFormSuccess(null);

    const { persist: _persist, ...preferences } = formState;

    try {
      const response = await fetch("/api/itineraries/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          preferences,
          itineraryId: currentItineraryId ?? undefined
        })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        const message = payload?.message ?? "保存云端行程失败";
        throw new Error(message);
      }

      if (payload.itineraryId) {
        setCurrentItineraryId(String(payload.itineraryId));
      }

      const actionLabel = payload.action === "updated" ? "云端行程已更新。" : "云端行程已保存。";
      setFormSuccess(actionLabel);
      void refreshSavedItineraries();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "保存云端行程失败");
    } finally {
      setIsSavingItinerary(false);
    }
  }, [plan, session, supabaseKeyConfigured, router, formState, currentItineraryId, refreshSavedItineraries]);

  const handlePersistToggle = useCallback(
    (checked: boolean) => {
      if (checked && !session) {
        setFormError("请先登录后再保存到云端。");
        router.push("/auth/login");
        return;
      }

      if (checked && !supabaseKeyConfigured) {
        setFormError("请先配置 Supabase 匿名密钥后再开启自动保存。");
        setFormSuccess(null);
        return;
      }

      setFormState((prev) => ({
        ...prev,
        persist: checked && Boolean(session) && supabaseKeyConfigured
      }));
    },
    [session, supabaseKeyConfigured, router]
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

      if (!ensureLlmKeyReady()) {
        return;
      }

  const { persist, ...preferences } = formState;
  const shouldPersist = persist && Boolean(session) && supabaseKeyConfigured;

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

  const itinerary = payload as { plan: ItineraryPlan; source?: string | null; itineraryId?: string | null };
  setPlan(itinerary.plan);
  setPlanSource(itinerary.source ?? null);
  setCurrentItineraryId(itinerary.itineraryId ?? null);
        setExpenses([]);
        setExpenseError(null);
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
    [formState, session, supabaseKeyConfigured, ensureLlmKeyReady, fetchLocationInfo, refreshSavedItineraries]
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

  useEffect(() => {
    if (!currentItineraryId) {
      return;
    }

    if (!session) {
      setExpenses([]);
      return;
    }

    if (!supabaseKeyConfigured) {
      setExpenses([]);
      setExpenseError("尚未配置 Supabase 匿名密钥，无法同步云端消费记录。");
      return;
    }

    void fetchExpensesForItinerary(currentItineraryId);
  }, [currentItineraryId, session, supabaseKeyConfigured, fetchExpensesForItinerary]);

  const budgetSummary = useMemo(() => {
    if (!plan) {
      return null;
    }
    return estimateBudget(plan, formState);
  }, [plan, formState]);

  const totalExpense = useMemo(() => {
    return expenses.reduce((sum, item) => sum + item.amount, 0);
  }, [expenses]);

  const spentByBudgetCategory = useMemo(() => {
    const map = new Map<BudgetItem["category"], number>();
    for (const expense of expenses) {
      map.set(expense.category, Number((map.get(expense.category) ?? 0) + expense.amount));
    }
    return map;
  }, [expenses]);

  const remainingBudget = useMemo(() => {
    const base = budgetSummary?.total ?? formState.budgetCNY;
    const diff = base - totalExpense;
    return diff > 0 ? diff : 0;
  }, [budgetSummary, formState.budgetCNY, totalExpense]);

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
    setCurrentItineraryId(null);
    setExpenses([]);
    setActiveDayIndex(0);
    setExpenseError(null);
  }, []);

  return (
    <Fragment>
  <div className="px-3 pt-3 pb-10 sm:px-5 sm:pt-6 lg:px-6 xl:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
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
                disabled={!session || !supabaseKeyConfigured || cloudSecretsLoading}
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                我的云端行程
              </button>
            </div>
          </header>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,300px)_minmax(0,1.35fr)_minmax(0,320px)] xl:grid-cols-[minmax(0,310px)_minmax(0,1.4fr)_minmax(0,340px)]">
            <section className="space-y-6">
              <article className="space-y-3 rounded-3xl border border-slate-200 bg-white/70 p-5 shadow-sm">
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
                          if (cloudSecretsLoading || !xfyunKeyConfigured) return;
                          return listening ? stopListening() : startListening();
                        }}
                        disabled={processing || cloudSecretsLoading || !xfyunKeyConfigured}
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
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        disabled={!transcript || processing || isTranscriptGenerating || cloudSecretsLoading || !xfyunKeyConfigured}
                        onClick={adoptTranscript}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {transcript ? "解析语音内容并填充偏好" : processing ? "识别中" : "等待语音内容"}
                      </button>
                      <button
                        type="button"
                        disabled={!transcript || processing || isTranscriptGenerating || isGenerating || cloudSecretsLoading || !llmKeyConfigured}
                        onClick={() => void submitTranscriptToAI()}
                        className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isTranscriptGenerating ? "语音生成中…" : "直接生成行程"}
                      </button>
                    </div>
                  </div>
                )}
              </article>

              <form onSubmit={handleSubmit} className="space-y-6 rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">旅行偏好</h2>
                  <span className="text-sm text-slate-500">{dayCountLabel}</span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-xs text-slate-600">
                  <div className="flex flex-col gap-1">
                    {cloudSecretsLoading ? (
                      <span>正在检测云端密钥状态…</span>
                    ) : (
                      <>
                        <span className={clsx(llmKeyConfigured ? "text-emerald-600" : "text-amber-600")}>
                          百炼 API Key：
                          {llmKeyConfigured
                            ? "已配置，可生成智能行程。"
                            : session
                              ? "未配置，生成行程功能暂不可用。"
                              : "需登录并配置后才能生成行程。"}
                          {llmKeyConfigured && llmKeyPreview ? (
                            <span className="ml-2 font-mono text-[11px] text-slate-500">{llmKeyPreview}</span>
                          ) : null}
                        </span>
                        <span className={clsx(xfyunKeyConfigured ? "text-emerald-600" : "text-amber-600")}>
                          讯飞语音密钥：
                          {xfyunKeyConfigured
                            ? "已配置，可使用语音速记。"
                            : session
                              ? "未配置，录音识别已停用。"
                              : "需登录并配置后才能使用语音速记。"}
                        </span>
                        <span className={clsx(amapKeyConfigured ? "text-emerald-600" : "text-amber-600")}>
                          高德地图密钥：
                          {amapKeyConfigured
                            ? "已配置，可加载地图与定位。"
                            : session
                              ? "未配置，地图功能已禁用。"
                              : "需登录并配置后才能加载地图。"}
                        </span>
                        <span className={clsx(supabaseKeyConfigured ? "text-emerald-600" : "text-amber-600")}>
                          Supabase 匿名密钥：
                          {supabaseKeyConfigured
                            ? "已配置，可保存并同步云端行程。"
                            : session
                              ? "未配置，云端保存与同步不可用。"
                              : "需登录并配置后才能启用云端同步。"}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => router.push(session ? "/settings" : "/auth/login")}
                      className="rounded-full border border-slate-300 px-3 py-1 text-[11px] text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
                    >
                      {session ? "前往设置" : "登录配置"}
                    </button>
                    {session ? (
                      <button
                        type="button"
                        onClick={() => void refreshSecretStatus()}
                        disabled={cloudSecretsLoading}
                        className="rounded-full border border-slate-200 px-3 py-1 text-[11px] text-slate-500 transition hover:border-slate-400 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {cloudSecretsLoading ? "刷新中…" : "刷新状态"}
                      </button>
                    ) : null}
                  </div>
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
                    checked={formState.persist && Boolean(session) && supabaseKeyConfigured}
                    disabled={!session || !supabaseKeyConfigured || cloudSecretsLoading}
                    onChange={(event) => handlePersistToggle(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <span>
                    生成后保存到云端行程（需登录）
                    {!supabaseKeyConfigured ? " - 请先配置 Supabase 密钥" : ""}
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={isGenerating || isTranscriptGenerating || cloudSecretsLoading || !llmKeyConfigured}
                  className="w-full rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGenerating ? "正在生成行程…" : isTranscriptGenerating ? "语音生成中…" : "生成智能行程"}
                </button>

                {formError ? <p className="text-xs text-rose-500">{formError}</p> : null}
                {formSuccess ? <p className="text-xs text-emerald-600">{formSuccess}</p> : null}
              </form>

            </section>

            <section className="flex flex-col gap-6">
              <article className="flex flex-1 flex-col rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">行程概览</h2>
                    <p className="text-xs text-slate-500">
                      查看 AI 自动汇总的行程结构，涵盖每日亮点、交通建议、餐饮推荐与住宿提示，便于快速核对整体节奏。
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {planSource ? (
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">来源：{planSource}</span>
                    ) : null}
                    {plan ? (
                      <button
                        type="button"
                        onClick={() => void saveItineraryManually()}
                        disabled={isSavingItinerary}
                        className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSavingItinerary ? "保存中…" : currentItineraryId ? "更新云端行程" : "保存到云端"}
                      </button>
                    ) : null}
                  </div>
                </div>

                {plan ? (
                  <div className="flex flex-1 flex-col gap-4">
                    <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{plan.overview}</p>

                    {plan.dayPlans.length > 0 ? (
                      <div className="flex flex-1 flex-col gap-4">
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
                          <div className="flex flex-1 flex-col gap-4 rounded-2xl border border-slate-200 bg-white/70 p-5">
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
                  <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-6 py-10 text-center text-sm text-slate-500">
                    生成行程后，这里会展示每日节点、交通方式与餐饮推荐，帮助你快速预览整体旅程结构。
                  </div>
                )}
              </article>

            </section>

            <section className="space-y-6">
              <article className="flex flex-col rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">目的地地图与天气</h2>
                    <p className="text-xs text-slate-500">展示目的地位置与实时天气状况</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void fetchLocationInfo(formState.destination)}
                    disabled={
                      locationLoading ||
                      !formState.destination ||
                      cloudSecretsLoading ||
                      !amapKeyConfigured
                    }
                    className="rounded-full border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {locationLoading ? "刷新中…" : "刷新"}
                  </button>
                </div>

                {plan ? (
                  <div className="mt-4 flex flex-1 flex-col gap-4">
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
                      amapKey={amapKeyValue ?? null}
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
                  <div className="mt-6 flex flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-6 py-8 text-center text-sm text-slate-500">
                    生成行程后将自动加载目的地地图与天气信息。
                  </div>
                )}
              </article>

              <article className="flex flex-col rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm xl:max-h-[620px] xl:overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">预算与支出</h2>
                    <p className="text-xs text-slate-500">智能预算拆分，快速记录行程开销</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {expensesLoading ? <span className="text-xs text-slate-400">消费记录同步中…</span> : null}
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                      总预算：{formatCurrency(budgetSummary?.total ?? formState.budgetCNY)}
                    </span>
                  </div>
                </div>

                {budgetSummary ? (
                  <div className="mt-4 flex-1 space-y-4 overflow-y-auto pr-1">
                    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 sm:grid-cols-3">
                      <div className="rounded-xl bg-white/60 px-3 py-2">
                        <p className="text-xs text-slate-500">已记录支出</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{formatCurrency(totalExpense, 2)}</p>
                      </div>
                      <div className="rounded-xl bg-white/60 px-3 py-2">
                        <p className="text-xs text-slate-500">剩余预算</p>
                        <p className="mt-1 text-sm font-semibold text-emerald-600">{formatCurrency(remainingBudget, 2)}</p>
                      </div>
                      <div className="rounded-xl bg-white/60 px-3 py-2">
                        <p className="text-xs text-slate-500">每日平均预算</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{formatCurrency(budgetSummary.dailyAverage, 2)}</p>
                      </div>
                    </div>

                    <ul className="grid gap-4 sm:grid-cols-2">
                      {budgetSummary.items.map((item) => {
                        const actual = spentByBudgetCategory.get(item.category) ?? 0;
                        const ratio = item.estimated > 0 ? actual / item.estimated : 0;
                        const barWidth = ratio > 0 ? `${Math.min(100, Math.max(ratio * 100, 6))}%` : "0%";

                        return (
                          <li key={item.category} className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-4">
                            <div className="flex items-center justify-between text-[11px] text-slate-500">
                              <span className="text-xs font-semibold text-slate-600">{budgetCategoryLabels[item.category]}</span>
                              <span>
                                {formatCurrency(actual, 2)} / {formatCurrency(item.estimated)}
                              </span>
                            </div>
                            <div className="mt-2 h-2 rounded-full bg-slate-100">
                              <div className={clsx("h-full rounded-full transition-all", pickSegmentColor(ratio))} style={{ width: barWidth }} />
                            </div>
                            <p className="mt-2 text-xs font-medium text-slate-900">预计投入：{formatCurrency(item.estimated)}</p>
                            <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">{item.description}</p>
                          </li>
                        );
                      })}
                    </ul>

                    {expenses.length > 0 ? (
                      <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-4">
                        <h3 className="text-sm font-semibold text-slate-900">支出明细</h3>
                        <ul className="mt-3 space-y-2">
                          {expenses.map((expense) => (
                            <li key={expense.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs text-slate-600">
                              <div className="min-w-0 space-y-1">
                                <p className="font-semibold text-slate-900">
                                  {budgetCategoryLabels[expense.category]} · {formatCurrency(expense.amount, 2)}
                                </p>
                                {expense.note ? <p className="text-[11px] text-slate-500">{expense.note}</p> : null}
                                <p className="text-[11px] text-slate-400">
                                  {new Date(expense.occurredAt || expense.createdAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void removeExpense(expense)}
                                className="rounded-full border border-slate-200 px-2 py-1 text-[11px] text-slate-500 transition hover:border-slate-400 hover:text-slate-700"
                              >
                                删除
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-6 flex flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-6 py-8 text-center text-sm text-slate-500">
                    生成行程后将提供预算拆分建议，并帮助跟踪支出。
                  </div>
                )}

                <div className="mt-4 space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900">记录实时支出</h3>
                  <p className="text-[11px] text-slate-400">
                    {!session
                      ? "登录并保存行程后，支出可同步到云端。"
                      : !supabaseKeyConfigured
                        ? "尚未配置 Supabase 密钥，消费记录将仅保存在本地。"
                      : currentItineraryId
                        ? "支出将实时同步到云端并与行程关联。"
                        : "当前行程未保存到云端，消费会暂存于本地。"}
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={expenseDraft.amount}
                      onChange={(event) => handleExpenseFieldChange("amount", event.target.value)}
                      placeholder="金额（¥）"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 sm:w-28"
                    />
                    <select
                      value={expenseDraft.category}
                      onChange={(event) => handleExpenseFieldChange("category", event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 sm:w-36"
                    >
                      {expenseCategories.map((category) => (
                        <option key={category} value={category}>
                          {budgetCategoryLabels[category]}
                        </option>
                      ))}
                    </select>
                    <input
                      value={expenseDraft.note}
                      onChange={(event) => handleExpenseFieldChange("note", event.target.value)}
                      placeholder="备注（可选）"
                      className="w-full flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                    />
                    <button
                      type="button"
                      onClick={() => void addExpense()}
                      disabled={expenseSubmitting}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {expenseSubmitting ? "记录中…" : "记录"}
                    </button>
                  </div>
                  {expenseError ? <p className="text-xs text-rose-500">{expenseError}</p> : null}
                  {expenses.length === 0 && !expensesLoading ? (
                    <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-4 text-center text-xs text-slate-500">
                      记录消费后将展示明细，便于对比预算。
                    </p>
                  ) : budgetSummary ? null : (
                    <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-4">
                      <h3 className="text-sm font-semibold text-slate-900">支出明细</h3>
                      <ul className="mt-3 space-y-2">
                        {expenses.map((expense) => (
                          <li key={expense.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs text-slate-600">
                            <div className="min-w-0 space-y-1">
                              <p className="font-semibold text-slate-900">
                                {budgetCategoryLabels[expense.category]} · {formatCurrency(expense.amount, 2)}
                              </p>
                              {expense.note ? <p className="text-[11px] text-slate-500">{expense.note}</p> : null}
                              <p className="text-[11px] text-slate-400">
                                {new Date(expense.occurredAt || expense.createdAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void removeExpense(expense)}
                              className="rounded-full border border-slate-200 px-2 py-1 text-[11px] text-slate-500 transition hover:border-slate-400 hover:text-slate-700"
                            >
                              删除
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
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
                    if (!supabaseKeyConfigured) {
                      setSavedItineraries([]);
                      setSavedError("尚未配置 Supabase 匿名密钥，云端行程不可用。");
                      return;
                    }
                    void refreshSavedItineraries();
                  }}
                  disabled={savedLoading || (!session && !savedError) || !supabaseKeyConfigured}
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
