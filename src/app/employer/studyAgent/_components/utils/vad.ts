"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { MicVAD } from "@ricky0123/vad-web";

interface UseVADOptions {
  onSpeechStart?: () => void;
  onSpeechRealStart?: () => void;
  onSpeechEnd?: (audio: Float32Array) => void;
  onError?: (error: Error) => void;
  positiveSpeechThreshold?: number;
  negativeSpeechThreshold?: number;
  redemptionMs?: number;
  preSpeechPadMs?: number;
  minSpeechMs?: number;
}

type VADState = "idle" | "running" | "paused" | "stopping";

export function useVAD(options: UseVADOptions = {}) {
  const {
    onSpeechStart,
    onSpeechEnd,
    onSpeechRealStart,
    onError,
    positiveSpeechThreshold = 0.6,
    negativeSpeechThreshold = 0.30,
    redemptionMs = 3000,
    preSpeechPadMs = 200,
    minSpeechMs = 600,
  } = options;

  // Refs
  const vadRef = useRef<MicVAD | null>(null);
  const onSpeechStartRef = useRef(onSpeechStart);
  const onSpeechEndRef = useRef(onSpeechEnd);
  const onSpeechRealStartRef = useRef(onSpeechRealStart);
  const onErrorRef = useRef(onError);
  const wasRecordingBeforePauseRef = useRef(false);
  
  // State as refs for callbacks to access current values
  const vadStateRef = useRef<VADState>("idle");
  const isRecordingRef = useRef(false);

  // State for React re-renders
  const [vadState, setVadState] = useState<VADState>("idle");
  const [isRecording, setIsRecording] = useState(false);

  // Sync refs with state
  useEffect(() => {
    vadStateRef.current = vadState;
  }, [vadState]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Keep callback refs updated
  useEffect(() => {
    onSpeechStartRef.current = onSpeechStart;
    onSpeechEndRef.current = onSpeechEnd;
    onSpeechRealStartRef.current = onSpeechRealStart;
    onErrorRef.current = onError;
  }, [onSpeechStart, onSpeechEnd, onSpeechRealStart, onError]);

  const start = useCallback(async () => {
    // Already running
    if (vadRef.current && vadStateRef.current === "running") {
      console.log("🎤 [VAD] Already running");
      return;
    }

    // Resume existing instance
    if (vadRef.current && vadStateRef.current === "paused") {
      console.log("🎤 [VAD] Resuming existing instance");
      try {
        await vadRef.current.start();
        setVadState("running");
        vadStateRef.current = "running";
        console.log("✅ [VAD] Resumed");
      } catch (err) {
        console.error("❌ [VAD] Resume failed:", err);
        onErrorRef.current?.(err instanceof Error ? err : new Error("Resume failed"));
      }
      return;
    }

    // Create new instance
    try {
      console.log("🎤 [VAD] Creating new VAD instance...");
      const vad = await import("@ricky0123/vad-web");

      vadRef.current = await vad.MicVAD.new({
        onSpeechStart: () => {
          // Check current state via refs
          if (vadStateRef.current === "stopping") {
            console.log("🎤 [VAD] Ignoring speech start - stopping");
            return;
          }
          if (vadStateRef.current === "paused") {
            console.log("🎤 [VAD] Ignoring speech start - paused");
            return;
          }
          
          console.log("🎤 [VAD] Speech started");
          setIsRecording(true);
          isRecordingRef.current = true;
          onSpeechStartRef.current?.();
        },
        onSpeechRealStart: () => {
          // Check current state via refs
          if (vadStateRef.current === "stopping") {
            console.log("🎤 [VAD] Ignoring real speech start - stopping");
            return;
          }
          if (vadStateRef.current === "paused") {
            console.log("🎤 [VAD] Ignoring real speech start - paused");
            return;
          }
          
          console.log("🎤 [VAD] Real speech started");
          onSpeechRealStartRef.current?.();
        },
        onSpeechEnd: (audio) => {
          // Check current state via refs
          if (vadStateRef.current === "stopping") {
            console.log("🎤 [VAD] Ignoring speech end - stopping");
            return;
          }
          
          // If paused, allow last speech if was recording before pause
          if (vadStateRef.current === "paused") {
            if (wasRecordingBeforePauseRef.current) {
              console.log(`🎤 [VAD] Allowing last speech to finish (${audio.length} samples)`);
              wasRecordingBeforePauseRef.current = false;
              // Continue to process below
            } else {
              console.log("🎤 [VAD] Ignoring speech end - paused");
              return;
            }
          }
          
          console.log(`🎤 [VAD] Speech ended (${audio.length} samples)`);
          setIsRecording(false);
          isRecordingRef.current = false;
          onSpeechEndRef.current?.(audio);
        },
        getStream: async () => {
          return navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              // @ts-expect-error: not in TS lib yet
              suppressLocalAudioPlayback: true,
            },
          });
        },
        minSpeechMs,
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/vad/",
        model: "legacy",
        positiveSpeechThreshold,
        negativeSpeechThreshold,
        redemptionMs,
        preSpeechPadMs,
      });

      await vadRef.current.start();
      setVadState("running");
      vadStateRef.current = "running";
      console.log("✅ [VAD] Started");
    } catch (err) {
      console.error("❌ [VAD] Start failed:", err);
      vadRef.current = null;
      setVadState("idle");
      vadStateRef.current = "idle";
      onErrorRef.current?.(err instanceof Error ? err : new Error("Start failed"));
    }
  }, [positiveSpeechThreshold, negativeSpeechThreshold, redemptionMs, preSpeechPadMs, minSpeechMs]);

  const pause = useCallback(async () => {
    if (!vadRef.current || vadStateRef.current !== "running") {
      console.log("🎤 [VAD] Nothing to pause");
      return;
    }

    console.log("🎤 [VAD] Pausing...");
    wasRecordingBeforePauseRef.current = isRecordingRef.current; // Save current recording state
    
    try {
      await vadRef.current.pause();
      setVadState("paused");
      vadStateRef.current = "paused";
      setIsRecording(false);
      isRecordingRef.current = false;
      console.log("✅ [VAD] Paused");
    } catch (err) {
      console.error("❌ [VAD] Pause failed:", err);
    }
  }, []);

  const resume = useCallback(async () => {
    if (!vadRef.current || vadStateRef.current !== "paused") {
      console.log("🎤 [VAD] Nothing to resume");
      return;
    }

    console.log("🎤 [VAD] Resuming...");
    wasRecordingBeforePauseRef.current = false; // Clear flag
    
    try {
      await vadRef.current.start();
      setVadState("running");
      vadStateRef.current = "running";
      console.log("✅ [VAD] Resumed");
    } catch (err) {
      console.error("❌ [VAD] Resume failed:", err);
    }
  }, []);

  const stop = useCallback(async () => {
    if (!vadRef.current) {
      console.log("🎤 [VAD] Nothing to stop");
      return;
    }

    console.log("🎤 [VAD] Stopping...");
    setVadState("stopping");
    vadStateRef.current = "stopping";
    wasRecordingBeforePauseRef.current = false;

    try {
      await vadRef.current.pause();
      await vadRef.current.destroy();
      vadRef.current = null;
      setVadState("idle");
      vadStateRef.current = "idle";
      setIsRecording(false);
      isRecordingRef.current = false;
      console.log("✅ [VAD] Stopped");
    } catch (err) {
      console.error("❌ [VAD] Stop failed:", err);
      vadRef.current = null;
      setVadState("idle");
      vadStateRef.current = "idle";
      setIsRecording(false);
      isRecordingRef.current = false;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (vadRef.current) {
        console.log("🎤 [VAD] Cleanup on unmount");
        vadRef.current.pause().catch((err) => console.error("❌ [VAD] Pause cleanup failed:", err));
        vadRef.current.destroy().catch((err) => console.error("❌ [VAD] Destroy cleanup failed:", err));
        vadRef.current = null;
      }
    };
  }, []);

  return {
    start,
    pause,
    resume,
    stop,
    isRunning: vadState === "running",
    isRecording,
    vadState,
  };
}

export default useVAD;