"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface SpeechHookResult {
  supported: boolean;
  listening: boolean;
  processing: boolean;
  transcript: string;
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
  error: string | null;
  setTranscriptManually: (value: string | ((prev: string) => string)) => void;
}

const TARGET_SAMPLE_RATE = 16000;

function mergeFloat32(chunks: Float32Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function resampleBuffer(data: Float32Array, inputSampleRate: number, targetSampleRate: number) {
  if (inputSampleRate === targetSampleRate) {
    return data;
  }

  const ratio = inputSampleRate / targetSampleRate;
  const newLength = Math.round(data.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i += 1) {
    const origin = i * ratio;
    const lowerIndex = Math.floor(origin);
    const upperIndex = Math.min(lowerIndex + 1, data.length - 1);
    const weight = origin - lowerIndex;
    const lowerValue = data[lowerIndex];
    const upperValue = data[upperIndex];
    result[i] = lowerValue + (upperValue - lowerValue) * weight;
  }

  return result;
}

function floatTo16BitPCM(data: Float32Array) {
  const buffer = new ArrayBuffer(data.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < data.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, data[i]));
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(i * 2, value, true);
  }

  return new Uint8Array(buffer);
}

function base64Encode(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function useSpeechRecognition(): SpeechHookResult {
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioChunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef<number | null>(null);

  const supported = useMemo(() => {
    if (typeof window === "undefined") return false;
    const hasMediaDevices = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    return hasMediaDevices && Boolean(AudioContextCtor);
  }, []);

  const cleanupResources = useCallback(async () => {
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch (err) {
        console.warn("断开音频处理节点失败", err);
      }
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close();
      } catch (err) {
        console.warn("关闭音频上下文失败", err);
      }
      audioContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      mediaStreamRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      audioChunksRef.current = [];
      sampleRateRef.current = null;
      void cleanupResources();
    };
  }, [cleanupResources]);

  const startListening = useCallback(() => {
    if (!supported) {
      setError("当前环境不支持麦克风录音");
      return;
    }
    if (listening || processing) {
      return;
    }

    setError(null);

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
        const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextCtor) {
          throw new Error("AudioContext 不可用");
        }

        const audioContext = new AudioContextCtor();
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);

        audioChunksRef.current = [];
        sampleRateRef.current = audioContext.sampleRate;

        processor.onaudioprocess = (event: AudioProcessingEvent) => {
          const channelData = event.inputBuffer.getChannelData(0);
          audioChunksRef.current.push(Float32Array.from(channelData));
        };

        source.connect(processor);
        processor.connect(audioContext.destination);

        audioContextRef.current = audioContext;
        mediaStreamRef.current = stream;
        processorRef.current = processor;

        setListening(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "麦克风访问失败，请检查权限设置");
        await cleanupResources();
      }
    })();
  }, [cleanupResources, listening, processing, supported]);

  const stopListening = useCallback(() => {
    if (!listening && !mediaStreamRef.current) {
      return;
    }

    setListening(false);

    void (async () => {
      const chunks = audioChunksRef.current;
      const inputSampleRate = sampleRateRef.current ?? audioContextRef.current?.sampleRate ?? TARGET_SAMPLE_RATE;

      audioChunksRef.current = [];
      sampleRateRef.current = null;

      await cleanupResources();

      if (!chunks.length) {
        setError("未捕获到有效音频，请重试");
        return;
      }

      const merged = mergeFloat32(chunks);
      const resampled = resampleBuffer(merged, inputSampleRate, TARGET_SAMPLE_RATE);
      const pcmBytes = floatTo16BitPCM(resampled);
      const base64 = base64Encode(pcmBytes);

      if (!base64) {
        setError("音频编码失败，请重试");
        return;
      }

      setProcessing(true);
      setError(null);

      try {
        const response = await fetch("/api/speech/xfyun", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioBase64: base64 })
        });

        const payload = (await response.json().catch(() => null)) as { text?: string; message?: string; error?: string } | null;

        if (!response.ok) {
          const serverMessage = payload && typeof payload.message === "string" ? payload.message : null;
          const serverError = payload && typeof payload.error === "string" ? payload.error : null;
          if (serverError === "NOT_CONFIGURED") {
            throw new Error(
              serverMessage ?? "讯飞语音识别未启用，请在环境变量中配置 XFYUN_APP_ID 和 XFYUN_API_KEY"
            );
          }
          throw new Error(serverMessage ?? "语音识别服务暂时不可用");
        }

        if (!payload || typeof payload !== "object") {
          throw new Error("语音识别服务返回数据格式不正确");
        }

        const text = (payload.text ?? "").trim();
        if (!text) {
          setError("未识别到有效语音，请重试");
          return;
        }

        setTranscript((prev) => (prev ? `${prev}\n${text}` : text));
      } catch (err) {
        setError(err instanceof Error ? err.message : "语音识别失败，请稍后再试");
      } finally {
        setProcessing(false);
      }
    })();
  }, [cleanupResources, listening]);

  const resetTranscript = useCallback(() => {
    setTranscript("");
    setError(null);
  }, []);

  const setTranscriptManually = useCallback((value: string | ((prev: string) => string)) => {
    setTranscript((prev) => (typeof value === "function" ? (value as (prev: string) => string)(prev) : value));
  }, []);

  return {
    supported,
    listening,
    processing,
    transcript,
    startListening,
    stopListening,
    resetTranscript,
    error,
    setTranscriptManually
  };
}
