"use client";

const weatherCodeMap: Record<number, string> = {
  0: "晴朗",
  1: "主要晴",
  2: "局部多云",
  3: "阴天",
  45: "雾",
  48: "霜雾",
  51: "小雾雨",
  53: "中雾雨",
  55: "大雾雨",
  56: "小冻雾雨",
  57: "大冻雾雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "冻雨",
  67: "冻雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  80: "小阵雨",
  81: "中阵雨",
  82: "暴阵雨",
  85: "小阵雪",
  86: "大阵雪",
  95: "雷阵雨",
  96: "雷阵雨伴冰雹",
  99: "雷阵雨伴冰雹"
};

export interface PlannerWeatherProps {
  temperature: number | null;
  apparentTemperature: number | null;
  humidity: number | null;
  code: number | null;
}

export function PlannerWeather({ temperature, apparentTemperature, humidity, code }: PlannerWeatherProps) {
  if (temperature == null && humidity == null && code == null) {
    return (
      <p className="text-xs text-slate-500">
        暂无法获取天气数据，请稍后重试或检查网络。
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl bg-slate-50 px-4 py-3">
        <p className="text-xs text-slate-500">当前气温</p>
        <p className="text-lg font-semibold text-slate-900">
          {temperature != null ? `${Math.round(temperature)}°C` : "--"}
        </p>
      </div>
      <div className="rounded-2xl bg-slate-50 px-4 py-3">
        <p className="text-xs text-slate-500">体感温度</p>
        <p className="text-lg font-semibold text-slate-900">
          {apparentTemperature != null ? `${Math.round(apparentTemperature)}°C` : "--"}
        </p>
      </div>
      <div className="rounded-2xl bg-slate-50 px-4 py-3">
        <p className="text-xs text-slate-500">相对湿度</p>
        <p className="text-lg font-semibold text-slate-900">
          {humidity != null ? `${Math.round(humidity)}%` : "--"}
        </p>
      </div>
      {code != null ? (
        <div className="sm:col-span-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          今日天气：{weatherCodeMap[code] ?? `代码 ${code}`}
        </div>
      ) : null}
    </div>
  );
}
