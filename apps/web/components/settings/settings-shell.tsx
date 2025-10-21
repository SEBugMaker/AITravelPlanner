"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSessionContext } from "@supabase/auth-helpers-react";

type FeedbackState = { type: "success" | "error"; message: string } | null;

interface SensitiveDescriptor {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  group?: string;
  groupLabel?: string;
  groupDescription?: string;
  groupPrimary?: boolean;
}

interface SensitiveSettingState extends SensitiveDescriptor {
  configured: boolean;
  editing: boolean;
  inputValue: string;
  lastUpdated: string | null;
  preview: string | null;
  plainValue: string | null;
  testing: boolean;
  testResult: { status: "success" | "error"; message: string } | null;
}

const sensitiveDescriptors: SensitiveDescriptor[] = [
  {
    key: "llmApiKey",
    label: "阿里云百炼 API Key",
    description: "用于调用 LLM 能力生成行程内容，支持随时轮换。",
    placeholder: "请输入百炼 API key"
  },
  {
    key: "supabaseAnonKey",
    label: "Supabase 匿名密钥",
    description: "用于客户端鉴权 Supabase 数据服务。建议只在受信任环境启用。",
    placeholder: "请输入 Supabase anon key"
  },
  {
    key: "amapWebKey",
    label: "高德 Web 服务密钥",
    description: "用于目的地地图与地点检索，仅在渲染地图时使用。",
    placeholder: "请输入高德 Web 服务密钥"
  },
  {
    key: "xfyunApiKey",
    label: "讯飞语音 App Key",
    description: "用于讯飞语音识别的 API Key，需与密钥配套使用。",
    placeholder: "请输入讯飞 API Key",
    group: "xfyun",
    groupLabel: "讯飞语音凭证",
    groupDescription: "配置讯飞 App Key 与 API Secret 以启用语音识别。"
  },
  {
    key: "xfyunAppSecret",
    label: "讯飞语音 API Secret",
    description: "用于语音识别签名的密钥 (API Secret)，需与 App Key 搭配使用。",
    placeholder: "请输入讯飞 API Secret",
    group: "xfyun",
    groupLabel: "讯飞语音凭证",
    groupDescription: "配置讯飞 App Key 与 API Secret 以启用语音识别。",
    groupPrimary: true
  }
];

function createSensitiveState(): SensitiveSettingState[] {
  return sensitiveDescriptors.map((descriptor) => ({
    ...descriptor,
    configured: false,
    editing: false,
    inputValue: "",
    lastUpdated: null,
    preview: null,
    plainValue: null,
    testing: false,
    testResult: null
  }));
}

function formatTimestamp(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });
}

type SensitiveSettingWithLabel = SensitiveSettingState & { lastUpdatedLabel: string | null };

interface SensitiveSettingGroup {
  id: string;
  label: string;
  description: string | null;
  items: SensitiveSettingWithLabel[];
}

export function SettingsShell() {
  const { session } = useSessionContext();
  const isAuthenticated = Boolean(session?.user);

  const [sensitiveSettings, setSensitiveSettings] = useState<SensitiveSettingState[]>(createSensitiveState);
  const [secretsLoading, setSecretsLoading] = useState(false);
  const [secretsError, setSecretsError] = useState<string | null>(null);
  const [pendingSensitiveKey, setPendingSensitiveKey] = useState<string | null>(null);

  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const sensitiveWithLabel = useMemo<SensitiveSettingWithLabel[]>(() => {
    return sensitiveSettings.map((setting) => ({
      ...setting,
      lastUpdatedLabel: formatTimestamp(setting.lastUpdated)
    }));
  }, [sensitiveSettings]);

  const groupedSensitiveSettings = useMemo<SensitiveSettingGroup[]>(() => {
    const groups = new Map<string, SensitiveSettingGroup>();

    for (const setting of sensitiveWithLabel) {
      const groupId = setting.group ?? setting.key;
      let group = groups.get(groupId);
      if (!group) {
        const label = setting.group ? setting.groupLabel ?? setting.label : setting.label;
        const description = setting.group ? setting.groupDescription ?? setting.description : setting.description;
        group = {
          id: groupId,
          label,
          description: description ?? null,
          items: []
        };
        groups.set(groupId, group);
      }
      group.items.push(setting);
    }

    return Array.from(groups.values());
  }, [sensitiveWithLabel]);

  const refreshSecrets = useCallback(async () => {
    if (!isAuthenticated) {
      return;
    }

    setSecretsLoading(true);
    setSecretsError(null);
    try {
      const response = await fetch("/api/settings/secrets", { method: "GET" });
      const payload = await response.json().catch(() => null);
      if (response.status === 401) {
        setSecretsError("登录后即可管理敏感密钥");
        return;
      }
      if (!response.ok) {
        throw new Error(payload?.message ?? "获取敏感配置失败");
      }
      const entries: Array<{ key: string; updatedAt: string | null; preview: string | null; value: string | null }> = Array.isArray(payload?.secrets)
        ? payload.secrets
        : [];
      const metadataMap = new Map(entries.map((item) => {
        const normalizedKey = item.key === "bailianApiKey" ? "llmApiKey" : item.key;
        return [normalizedKey, {
          updatedAt: item.updatedAt ?? null,
          preview: item.preview ?? null,
          value: item.value ?? null
        }];
      }));
      setSensitiveSettings((prev) =>
        prev.map((setting) => ({
          ...setting,
          configured: metadataMap.has(setting.key),
          lastUpdated: metadataMap.get(setting.key)?.updatedAt ?? null,
          preview: metadataMap.get(setting.key)?.preview ?? null,
          plainValue: metadataMap.get(setting.key)?.value ?? null,
          editing: false,
          inputValue: "",
          testing: false,
          testResult: null
        }))
      );
    } catch (error) {
      console.error("[SettingsShell] refreshSecrets failed", error);
      setSecretsError(error instanceof Error ? error.message : "获取敏感配置失败");
    } finally {
      setSecretsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setSensitiveSettings(createSensitiveState());
      setSecretsError(null);
      setSecretsLoading(false);
      return;
    }

    void refreshSecrets();
  }, [isAuthenticated, refreshSecrets]);

  const startSensitiveEditing = (key: string) => {
    if (!isAuthenticated) {
      setFeedback({ type: "error", message: "登录后才能调整密钥信息。" });
      return;
    }
    if (secretsLoading) {
      return;
    }

    setSensitiveSettings((prev) =>
      prev.map((setting) =>
        setting.key === key
          ? { ...setting, editing: true, inputValue: setting.plainValue ?? "" }
          : { ...setting, editing: false, inputValue: "" }
      )
    );
    setFeedback(null);
  };

  const cancelSensitiveEditing = (key: string) => {
    setSensitiveSettings((prev) =>
      prev.map((setting) =>
        setting.key === key ? { ...setting, editing: false, inputValue: "" } : setting
      )
    );
    setFeedback(null);
  };

  const handleSensitiveInputChange = (key: string, value: string) => {
    setSensitiveSettings((prev) =>
      prev.map((setting) =>
        setting.key === key ? { ...setting, inputValue: value } : setting
      )
    );
  };

  const handleSensitiveSubmit = async (key: string) => {
    const target = sensitiveSettings.find((setting) => setting.key === key);
    if (!target) {
      setFeedback({ type: "error", message: "未找到该密钥配置。" });
      return;
    }
    const sanitized = target.inputValue.trim();

    if (!isAuthenticated) {
      setFeedback({ type: "error", message: "请登录后再保存密钥。" });
      return;
    }

    if (!sanitized) {
      setFeedback({ type: "error", message: "请输入有效的密钥值。" });
      return;
    }

    setPendingSensitiveKey(key);
    setFeedback(null);
    try {
      const response = await fetch("/api/settings/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: sanitized })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message ?? "保存敏感配置失败");
      }

      const updatedAt = typeof payload?.updatedAt === "string" ? payload.updatedAt : new Date().toISOString();
      const previewValue = typeof payload?.preview === "string" ? payload.preview : target?.preview ?? null;
      const plainValue = typeof payload?.value === "string" ? payload.value : sanitized;

      setSensitiveSettings((prev) =>
        prev.map((setting) =>
          setting.key === key
            ? {
                ...setting,
                configured: true,
                editing: false,
                inputValue: "",
                lastUpdated: updatedAt,
                preview: previewValue,
                plainValue,
                testing: false,
                testResult: null
              }
            : setting
        )
      );
      setFeedback({ type: "success", message: `${target?.label ?? "密钥"} 已更新并保存。` });
      setSecretsError(null);
    } catch (error) {
      console.error("[SettingsShell] handleSensitiveSubmit failed", error);
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "保存敏感配置失败" });
    } finally {
      setPendingSensitiveKey(null);
    }
  };

  const handleSecretTest = async (key: string) => {
    const target = sensitiveSettings.find((setting) => setting.key === key);
    if (!target) {
      setFeedback({ type: "error", message: "未找到该密钥配置。" });
      return;
    }

    if (!target.configured) {
      setFeedback({ type: "error", message: "请先保存密钥后再测试。" });
      return;
    }

    setSensitiveSettings((prev) =>
      prev.map((setting) =>
        setting.key === key
          ? {
              ...setting,
              testing: true,
              testResult: null
            }
          : setting
      )
    );

    try {
      const response = await fetch("/api/settings/secrets/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key })
      });

      const payload = await response.json().catch(() => null);

      if (response.status === 401) {
        const message = payload?.message ?? "请登录后再测试密钥。";
        setFeedback({ type: "error", message });
        setSensitiveSettings((prev) =>
          prev.map((setting) =>
            setting.key === key
              ? {
                  ...setting,
                  testing: false,
                  testResult: { status: "error", message }
                }
              : setting
          )
        );
        return;
      }

      if (!response.ok || !payload) {
        const message = payload?.message ?? payload?.error ?? "密钥测试失败";
        setSensitiveSettings((prev) =>
          prev.map((setting) =>
            setting.key === key
              ? {
                  ...setting,
                  testing: false,
                  testResult: { status: "error", message }
                }
              : setting
          )
        );
        return;
      }

      const ok = typeof payload.ok === "boolean" ? payload.ok : false;
      const message = typeof payload.message === "string" ? payload.message : ok ? "测试成功" : "测试失败";

      setSensitiveSettings((prev) =>
        prev.map((setting) =>
          setting.key === key
            ? {
                ...setting,
                testing: false,
                testResult: { status: ok ? "success" : "error", message }
              }
            : setting
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "密钥测试失败";
      setSensitiveSettings((prev) =>
        prev.map((setting) =>
          setting.key === key
            ? {
                ...setting,
                testing: false,
                testResult: { status: "error", message }
              }
            : setting
        )
      );
    }
  };

  const renderSingleSetting = (setting: SensitiveSettingWithLabel) => {
    const testDisabled = !isAuthenticated || setting.testing || !setting.configured;

    return (
      <div key={setting.key} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/75 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">{setting.label}</p>
            <p className="text-xs text-slate-500">{setting.description}</p>
          </div>
          <span className="text-[11px] font-medium text-slate-500">{setting.configured ? "已配置" : "未配置"}</span>
        </div>

        {setting.configured ? (
          <p className="rounded-xl bg-slate-100 px-3 py-2 font-mono text-sm tracking-widest text-slate-600 break-all">
            {setting.plainValue && setting.plainValue.trim()
              ? setting.plainValue
              : setting.preview && setting.preview.trim()
                ? setting.preview
                : "***"}
          </p>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 px-3 py-2 text-sm text-slate-400">尚未提供密钥</p>
        )}

        {setting.lastUpdatedLabel ? (
          <p className="text-[11px] text-slate-400">最近更新：{setting.lastUpdatedLabel}</p>
        ) : null}

        {setting.editing ? (
          <div className="flex flex-col gap-3">
            <input
              type="text"
              value={setting.inputValue}
              onChange={(event) => handleSensitiveInputChange(setting.key, event.target.value)}
              placeholder={setting.placeholder}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSensitiveSubmit(setting.key)}
                disabled={pendingSensitiveKey === setting.key}
                className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {pendingSensitiveKey === setting.key ? "保存中…" : "确认覆盖"}
              </button>
              <button
                type="button"
                onClick={() => cancelSensitiveEditing(setting.key)}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500 transition hover:border-slate-400 hover:text-slate-700"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => startSensitiveEditing(setting.key)}
              disabled={!isAuthenticated || secretsLoading}
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              重新输入
            </button>
            <button
              type="button"
              onClick={() => handleSecretTest(setting.key)}
              disabled={testDisabled}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {setting.testing ? "测试中…" : "测试联通"}
            </button>
          </div>
        )}

        {setting.testResult ? (
          <p
            className={`text-[11px] ${
              setting.testResult.status === "success"
                ? "text-emerald-600"
                : "text-rose-600"
            }`}
          >
            {setting.testResult.message}
          </p>
        ) : null}
      </div>
    );
  };

  const renderGroupedField = (setting: SensitiveSettingWithLabel) => (
    <div key={setting.key} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/70 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{setting.label}</p>
          <p className="text-xs text-slate-500">{setting.description}</p>
        </div>
        <span className="text-[11px] font-medium text-slate-500">{setting.configured ? "已配置" : "未配置"}</span>
      </div>

      {setting.configured ? (
        <p className="rounded-xl bg-slate-100 px-3 py-2 font-mono text-sm tracking-widest text-slate-600 break-all">
          {setting.plainValue && setting.plainValue.trim()
            ? setting.plainValue
            : setting.preview && setting.preview.trim()
              ? setting.preview
              : "***"}
        </p>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-2 text-sm text-slate-400">尚未提供密钥</p>
      )}

      {setting.lastUpdatedLabel ? (
        <p className="text-[11px] text-slate-400">最近更新：{setting.lastUpdatedLabel}</p>
      ) : null}

      {setting.editing ? (
        <div className="flex flex-col gap-3">
          <input
            type="text"
            value={setting.inputValue}
            onChange={(event) => handleSensitiveInputChange(setting.key, event.target.value)}
            placeholder={setting.placeholder}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-inner focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSensitiveSubmit(setting.key)}
              disabled={pendingSensitiveKey === setting.key}
              className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {pendingSensitiveKey === setting.key ? "保存中…" : "确认覆盖"}
            </button>
            <button
              type="button"
              onClick={() => cancelSensitiveEditing(setting.key)}
              className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500 transition hover:border-slate-400 hover:text-slate-700"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => startSensitiveEditing(setting.key)}
          disabled={!isAuthenticated || secretsLoading}
          className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          重新输入
        </button>
      )}
    </div>
  );

  const renderGroupedSetting = (group: SensitiveSettingGroup) => {
    const primary = group.items.find((item) => item.groupPrimary) ?? group.items[0];
    const groupConfigured = group.items.every((item) => item.configured);
    const testDisabled = !isAuthenticated || primary.testing || !groupConfigured;

    return (
      <div key={group.id} className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white/75 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">{group.label}</p>
            {group.description ? <p className="text-xs text-slate-500">{group.description}</p> : null}
          </div>
          <span className="text-[11px] font-medium text-slate-500">{groupConfigured ? "已配置" : "未配置"}</span>
        </div>

        <div className="flex flex-col gap-3">
          {group.items.map((item) => renderGroupedField(item))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleSecretTest(primary.key)}
            disabled={testDisabled}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {primary.testing ? "测试中…" : "测试联通"}
          </button>
          {!groupConfigured ? (
            <span className="text-[11px] text-amber-600">请先保存所有字段后再测试。</span>
          ) : null}
        </div>

        {primary.testResult ? (
          <p
            className={`text-[11px] ${
              primary.testResult.status === "success"
                ? "text-emerald-600"
                : "text-rose-600"
            }`}
          >
            {primary.testResult.message}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="px-3 pb-12 pt-4 sm:px-5 lg:px-6 xl:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="rounded-3xl bg-white/80 px-8 py-7 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">配置中心</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                集中管理敏感密钥。密钥内容始终以 * 号隐藏，并且仅支持重新输入覆盖。
              </p>
            </div>
            <div className="rounded-full bg-slate-900/90 px-4 py-1.5 text-xs font-medium text-white">
              {isAuthenticated ? `已登录：${session?.user?.email ?? "账号"}` : "未登录"}
            </div>
          </div>
          {!isAuthenticated ? (
            <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
              登录后方可持久化配置与更新密钥。当前修改仅临时保存于浏览器会话。
            </p>
          ) : null}
        </header>

        {feedback ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-xs ${
              feedback.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                : "border-rose-200 bg-rose-50 text-rose-600"
            }`}
          >
            {feedback.message}
          </div>
        ) : null}

        <section className="space-y-5 rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
          <header>
            <h2 className="text-lg font-semibold text-slate-900">敏感密钥</h2>
            <p className="mt-1 text-xs text-slate-500">
              密钥内容不会在界面中回显。已配置的字段以 ******** 展示，点击“重新输入”即可覆盖旧值。
            </p>
          </header>

          {secretsLoading ? (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-3 text-xs text-slate-500">
              敏感配置加载中…
            </p>
          ) : null}
          {secretsError ? (
            <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-600">{secretsError}</p>
          ) : null}

          <div className="flex flex-col gap-4">
            {groupedSensitiveSettings.map((group) =>
              group.items.length === 1 && !group.items[0].group
                ? renderSingleSetting(group.items[0])
                : renderGroupedSetting(group)
            )}
          </div>
        </section>

      </div>
    </div>
  );
}
