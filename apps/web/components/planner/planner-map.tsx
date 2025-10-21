"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import AMapLoader from "@amap/amap-jsapi-loader";
import type { DayLocation } from "@core/index";

const FALLBACK_MIN_HEIGHT_PX = 320;
const ENV_AMAP_KEY = (process.env.NEXT_PUBLIC_AMAP_KEY ?? "").trim();
const SECURITY_JS_CODE = (process.env.NEXT_PUBLIC_AMAP_SECURITY_JS_CODE ?? "").trim();

type LogLevel = "info" | "warn" | "error";

export interface PlannerMapProps {
  destination: string | null;
  baseLocation: {
    latitude: number;
    longitude: number;
    address: string;
  } | null;
  dayLocations: DayLocation[];
  selectedDay: number | null;
  loading: boolean;
  error?: string | null;
  amapKey?: string | null;
}

type MapContext = {
  map: any | null;
  AMap: any | null;
  markers: any[];
  polyline: any | null;
};

function toFiniteNumber(value: unknown, context: string): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      console.warn(`[PlannerMap] Empty string for number (${context})`, value);
      return null;
    }
    const parsed = Number.parseFloat(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    console.warn(`[PlannerMap] Failed to parse number (${context})`, value);
    return null;
  }
  if (value != null) {
    console.warn(`[PlannerMap] Unsupported number type (${context})`, value);
  }
  return null;
}

function normalizeLongitude(value: unknown, context: string): number | null {
  const result = toFiniteNumber(value, `${context}.lng`);
  if (result == null) return null;
  if (result < -180 || result > 180) {
    console.warn(`[PlannerMap] Longitude out of bounds (${context})`, result);
    return null;
  }
  return result;
}

function normalizeLatitude(value: unknown, context: string): number | null {
  const result = toFiniteNumber(value, `${context}.lat`);
  if (result == null) return null;
  if (result < -90 || result > 90) {
    console.warn(`[PlannerMap] Latitude out of bounds (${context})`, result);
    return null;
  }
  return result;
}

function normalizePoint(
  lngValue: unknown,
  latValue: unknown,
  context: string
): [number, number] | null {
  const lng = normalizeLongitude(lngValue, context);
  const lat = normalizeLatitude(latValue, context);
  if (lng == null || lat == null) return null;
  if (Number.isNaN(lng) || Number.isNaN(lat)) {
    console.warn(`[PlannerMap] Point contains NaN (${context})`, { lng, lat });
    return null;
  }
  return [lng, lat];
}

function measureContainer(element: HTMLElement | null): { width: number; height: number } | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height))
  };
}

function applyFallbackContainerHeight(
  element: HTMLElement | null,
  appliedRef: MutableRefObject<boolean>
) {
  if (!element || appliedRef.current) return;
  if (element.getBoundingClientRect().height <= 0) {
    element.style.minHeight = `${FALLBACK_MIN_HEIGHT_PX}px`;
    appliedRef.current = true;
  }
}

function resetFallbackContainerHeight(
  element: HTMLElement | null,
  appliedRef: MutableRefObject<boolean>
) {
  if (!element || !appliedRef.current) return;
  element.style.minHeight = "";
  appliedRef.current = false;
}

function usePlannerDebugLog() {
  return useCallback(async (level: LogLevel, message: string, data?: Record<string, unknown>) => {
    try {
      await fetch("/api/debug-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, message, data })
      });
    } catch (error) {
      console.warn("[PlannerMap] Failed to send debug log", error, { level, message, data });
    }
  }, []);
}

export function PlannerMap({
  destination,
  baseLocation,
  dayLocations,
  selectedDay,
  loading,
  error,
  amapKey
}: PlannerMapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contextRef = useRef<MapContext>({ map: null, AMap: null, markers: [], polyline: null });
  const fallbackAppliedRef = useRef(false);
  const overlayRetryRef = useRef<number | null>(null);
  const updateOverlaysRef = useRef<() => void>(() => {});

  const [isMapReady, setIsMapReady] = useState(false);
  const [mapInitError, setMapInitError] = useState<string | null>(null);

  const resolvedAmapKey = useMemo(() => {
    const trimmedCloud = (amapKey ?? "").trim();
    if (trimmedCloud) return trimmedCloud;
    return ENV_AMAP_KEY;
  }, [amapKey]);

  const sendDebugLog = usePlannerDebugLog();

  const basePoint = useMemo(() => {
    if (!baseLocation) return null;
    const normalized = normalizePoint(baseLocation.longitude, baseLocation.latitude, "baseLocation");
    if (!normalized) {
      void sendDebugLog("warn", "Base location lacks valid coordinates", { baseLocation });
    }
    return normalized;
  }, [baseLocation, sendDebugLog]);

  const updateOverlays = useCallback(() => {
    const { map, AMap } = contextRef.current;
    if (!map || !AMap || !isMapReady) {
      return;
    }

    const size = measureContainer(containerRef.current);
    const hasSize = Boolean(size && size.width > 0 && size.height > 0);

    if (!hasSize) {
      console.warn("[PlannerMap] Skip overlay update due to zero container size", size);
      void sendDebugLog("warn", "Skip overlay update due to zero container size", { size, isMapReady });
      if (typeof window !== "undefined") {
        if (overlayRetryRef.current != null) {
          window.clearTimeout(overlayRetryRef.current);
        }
        overlayRetryRef.current = window.setTimeout(() => {
          overlayRetryRef.current = null;
          updateOverlaysRef.current();
        }, 180);
      }
      return;
    }

    if (overlayRetryRef.current != null && typeof window !== "undefined") {
      window.clearTimeout(overlayRetryRef.current);
      overlayRetryRef.current = null;
    }

    try {
      contextRef.current.markers.forEach((marker) => marker?.setMap?.(null));
      contextRef.current.polyline?.setMap?.(null);
    } catch (cleanupErr) {
      console.warn("[PlannerMap] Failed to clear overlays", cleanupErr);
    }
    contextRef.current.markers = [];
    contextRef.current.polyline = null;

    const normalizedPoints = dayLocations
      .map((location, index) => {
        const point = normalizePoint(
          location.longitude,
          location.latitude,
          `dayLocations[${index}]`
        );
        if (!point) {
          void sendDebugLog("warn", "Skip invalid day location", { index, location });
          return null;
        }
        return { point, location, index };
      })
      .filter(Boolean) as Array<{ point: [number, number]; location: DayLocation; index: number }>;

    if (normalizedPoints.length === 0) {
      if (basePoint) {
        try {
          const marker = new AMap.Marker({
            position: basePoint,
            title: destination ?? baseLocation?.address ?? "目的地"
          });
          marker.setMap(map);
          contextRef.current.markers = [marker];
          map.setZoomAndCenter(11, basePoint);
          void sendDebugLog("info", "Rendered fallback marker", {
            destination,
            basePoint,
            address: baseLocation?.address
          });
        } catch (fallbackErr) {
          console.error("[PlannerMap] Failed to render fallback marker", fallbackErr, basePoint);
          void sendDebugLog("error", "Failed to render fallback marker", {
            error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
            basePoint
          });
        }
      }
      return;
    }

    const markers: any[] = [];
    normalizedPoints.forEach(({ point, location, index }) => {
      try {
        const marker = new AMap.Marker({
          position: point,
          title: `${index + 1}. ${location.name ?? "未命名地点"}`
        });
        marker.setMap(map);
        markers.push(marker);
      } catch (markerErr) {
        console.error("[PlannerMap] Failed to render marker", markerErr, { point, location, index });
        void sendDebugLog("error", "Failed to render marker", {
          error: markerErr instanceof Error ? markerErr.message : String(markerErr),
          point,
          location,
          index
        });
      }
    });
    contextRef.current.markers = markers;

    if (normalizedPoints.length >= 2) {
      try {
        const polyline = new AMap.Polyline({
          path: normalizedPoints.map(({ point }) => point),
          strokeColor: "#2563eb",
          strokeWeight: 4,
          lineJoin: "round",
          lineCap: "round",
          showDir: true
        });
        polyline.setMap(map);
        contextRef.current.polyline = polyline;
        void sendDebugLog("info", "Rendered polyline", { pointCount: normalizedPoints.length });
      } catch (polylineErr) {
        console.error("[PlannerMap] Failed to render polyline", polylineErr);
        void sendDebugLog("error", "Failed to render polyline", {
          error: polylineErr instanceof Error ? polylineErr.message : String(polylineErr),
          pointCount: normalizedPoints.length
        });
      }
    }

    const overlays = [...markers];
    if (contextRef.current.polyline) {
      overlays.push(contextRef.current.polyline);
    }

    try {
      if (overlays.length > 0) {
        map.setFitView(overlays);
      } else if (basePoint) {
        map.setZoomAndCenter(11, basePoint);
      }
    } catch (fitErr) {
      console.warn("[PlannerMap] map.setFitView failed", fitErr);
      void sendDebugLog("warn", "map.setFitView failed", {
        error: fitErr instanceof Error ? fitErr.message : String(fitErr)
      });
      if (basePoint) {
        try {
          map.setZoomAndCenter(11, basePoint);
        } catch (centerErr) {
          console.error("[PlannerMap] Failed to center map after fitView failure", centerErr);
          void sendDebugLog("error", "Failed to center map after fitView failure", {
            error: centerErr instanceof Error ? centerErr.message : String(centerErr),
            basePoint
          });
        }
      }
    }
  }, [baseLocation, basePoint, dayLocations, destination, isMapReady, sendDebugLog]);

  useEffect(() => {
    updateOverlaysRef.current = updateOverlays;
  }, [updateOverlays]);

  useEffect(() => {
    let destroyed = false;
    let retryTimer: number | null = null;
    let mapInstance: any | null = null;

    const clearRetryTimer = () => {
      if (retryTimer != null && typeof window !== "undefined") {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const cleanupContext = () => {
      try {
        contextRef.current.markers.forEach((marker) => marker?.setMap?.(null));
        contextRef.current.polyline?.setMap?.(null);
      } catch (cleanupErr) {
        console.warn("[PlannerMap] Cleanup overlays failed", cleanupErr);
      }
      contextRef.current = { map: null, AMap: null, markers: [], polyline: null };
      mapInstance?.destroy?.();
      mapInstance = null;
    };

    const initMap = async (attempt = 0) => {
      if (destroyed) return;

      const container = containerRef.current;
      if (!container || !resolvedAmapKey) {
        setMapInitError(
          resolvedAmapKey
            ? "地图容器暂不可用，请稍后重试。"
            : "未检测到高德密钥，无法加载地图。请在设置页配置或通过环境变量注入。"
        );
        setIsMapReady(false);
        return;
      }

      applyFallbackContainerHeight(container, fallbackAppliedRef);
      const size = measureContainer(container);
      const hasSize = Boolean(size && size.width > 0 && size.height > 0);

      if (!hasSize && attempt < 10) {
        clearRetryTimer();
        retryTimer = window.setTimeout(() => initMap(attempt + 1), 160);
        void sendDebugLog("warn", "Container not ready, retry initializing map", {
          attempt,
          size,
          hasContainer: Boolean(container)
        });
        return;
      }

      setMapInitError(null);
      setIsMapReady(false);

      try {
        if (typeof window !== "undefined") {
          const code = SECURITY_JS_CODE.trim();
          if (code) {
            (window as any)._AMapSecurityConfig = { securityJsCode: code };
          } else {
            delete (window as any)._AMapSecurityConfig;
            void sendDebugLog("warn", "Security JS code missing; cleared window config");
          }
        }

        const AMap = await AMapLoader.load({
          key: resolvedAmapKey,
          version: "2.0",
          plugins: ["AMap.ToolBar", "AMap.Scale"]
        });

        if (destroyed) return;

        const mapOptions: Record<string, unknown> = {
          zoom: basePoint ? 11 : 4,
          viewMode: "3D"
        };
        if (basePoint) {
          mapOptions.center = basePoint;
        }

        mapInstance = new AMap.Map(container, mapOptions);
        mapInstance.addControl(new AMap.ToolBar());
        mapInstance.addControl(new AMap.Scale());

        contextRef.current = { map: mapInstance, AMap, markers: [], polyline: null };

        mapInstance.on?.("complete", () => {
          if (destroyed) return;
          setIsMapReady(true);
          void sendDebugLog("info", "Map initialization complete", {
            hasSecurityCode: Boolean(SECURITY_JS_CODE)
          });
          updateOverlaysRef.current();
        });
      } catch (initErr) {
        console.error("[PlannerMap] Failed to initialize AMap", initErr);
        cleanupContext();
        setMapInitError(
          initErr instanceof Error ? initErr.message : "地图加载失败，请稍后重试。"
        );
        setIsMapReady(false);
        void sendDebugLog("error", "Failed to initialize map", {
          error: initErr instanceof Error ? initErr.message : String(initErr),
          attempt
        });
      }
    };

    void initMap();

    return () => {
      destroyed = true;
      clearRetryTimer();
      cleanupContext();
    };
  }, [sendDebugLog, basePoint, resolvedAmapKey]);

  useEffect(() => {
    const container = containerRef.current;
    const map = contextRef.current.map;
    if (!container || !map || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) {
        void sendDebugLog("warn", "Map container resized to zero", { width, height });
        return;
      }
      resetFallbackContainerHeight(container, fallbackAppliedRef);
      map.resize?.();
      updateOverlaysRef.current();
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [sendDebugLog]);

  useEffect(() => {
    if (!isMapReady) return;
    updateOverlaysRef.current();
  }, [isMapReady, dayLocations, selectedDay, basePoint]);

  const renderState = () => {
    if (!resolvedAmapKey) {
      return (
        <p className="text-xs text-amber-600">
          未配置高德地图密钥，无法加载地图。请在设置页提供密钥或配置环境变量。
        </p>
      );
    }
    if (mapInitError) {
      return <p className="text-xs text-rose-500">{mapInitError}</p>;
    }
    if (loading) {
      return <p className="text-xs text-slate-500">正在加载地图信息…</p>;
    }
    if (error) {
      return <p className="text-xs text-rose-500">{error}</p>;
    }
    if (baseLocation && !basePoint) {
      return (
        <p className="text-xs text-amber-600">目的地缺少有效坐标，请重新尝试搜索以获取准确位置。</p>
      );
    }
    if (!basePoint && dayLocations.length === 0) {
      return <p className="text-xs text-slate-500">生成行程后将显示目的地地图。</p>;
    }
    if (dayLocations.length === 0) {
      return (
        <p className="text-xs text-slate-500">
          第 {selectedDay ?? "?"} 天暂未提供有效坐标，将使用目的地默认位置展示。
        </p>
      );
    }
    return null;
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex-1 min-h-[20rem] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
        <div ref={containerRef} className="h-full w-full" />
      </div>
      {renderState()}
      {destination && baseLocation ? (
        <p className="text-xs text-slate-500">
          目的地：{destination}（{baseLocation?.address ?? "未知地址"}）
        </p>
      ) : null}
    </div>
  );
}
