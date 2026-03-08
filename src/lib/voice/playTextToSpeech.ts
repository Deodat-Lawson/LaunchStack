import type { MutableRefObject, Dispatch, SetStateAction } from "react";

export type VoiceCallState = "connected" | "listening" | "speaking" | "muted";

interface PlayTextToSpeechParams {
  text: string;
  audioRef: MutableRefObject<HTMLAudioElement | null>;
  isPlayingAudio: boolean;
  isGeneratingTTSRef: MutableRefObject<boolean>;
  setCallState: Dispatch<SetStateAction<VoiceCallState>>;
  setIsLoadingAudio: Dispatch<SetStateAction<boolean>>;
  setIsPlayingAudio: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  continuousListening: boolean;
  vad: { isRunning: boolean; start: () => Promise<void>; resume: () => void };
  isProcessingRef: MutableRefObject<boolean>;
  ttsStartedAtRef: MutableRefObject<number>;
}

const canUseMediaSourceStreaming = (): boolean => {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const isFirefox = ua.includes("Firefox");
  const isMac = ua.includes("Mac OS");
  if (isFirefox && isMac) return false;
  if (typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg")) return true;
  return false;
};

export async function playTextToSpeech({
  text,
  audioRef,
  isPlayingAudio,
  isGeneratingTTSRef,
  setCallState,
  setIsLoadingAudio,
  setIsPlayingAudio,
  setError,
  continuousListening,
  vad,
  isProcessingRef,
  ttsStartedAtRef,
}: PlayTextToSpeechParams) {
  if (!text || text.trim().length === 0) return;
  if (isPlayingAudio || isGeneratingTTSRef.current) return;

  isGeneratingTTSRef.current = true;

  try {
    setError(null);
    setCallState("speaking");
    setIsLoadingAudio(true);
    setIsPlayingAudio(true);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const response = await fetch("/api/voice/text-to-speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        modelId: "eleven_v3",
        stability: 0.5,
        similarityBoost: 0.75,
        useSpeakerBoost: true,
      }),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({ error: "Unknown error" }))) as { error?: string };
      throw new Error(errorData.error ?? `Failed to generate speech: ${response.statusText}`);
    }

    const setupAudioHandlers = (audio: HTMLAudioElement, urlToRevoke: string) => {
      audio.onloadeddata = () => setIsLoadingAudio(false);
      audio.onended = () => {
        setIsPlayingAudio(false);
        setIsLoadingAudio(false);
        setCallState("connected");
        URL.revokeObjectURL(urlToRevoke);
        audioRef.current = null;
        isGeneratingTTSRef.current = false;

        if (continuousListening) {
          setTimeout(() => {
            if (!isProcessingRef.current) {
              if (vad.isRunning) {
                vad.resume();
                setCallState("listening");
              } else {
                void vad.start();
              }
            }
          }, 300);
        }
      };
      audio.onerror = () => {
        setIsPlayingAudio(false);
        setIsLoadingAudio(false);
        setCallState("connected");
        setError("Failed to play audio");
        URL.revokeObjectURL(urlToRevoke);
        audioRef.current = null;
        isGeneratingTTSRef.current = false;
      };
    };

    if (canUseMediaSourceStreaming()) {
      const mediaSource = new MediaSource();
      const audio = new Audio();
      audioRef.current = audio;

      const mediaSourceUrl = URL.createObjectURL(mediaSource);
      audio.src = mediaSourceUrl;
      setupAudioHandlers(audio, mediaSourceUrl);

      mediaSource.addEventListener("sourceopen", () => {
        void (async () => {
          try {
            const sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
            const reader = response.body!.getReader();

            const pump = async (): Promise<void> => {
              const { done, value } = await reader.read();
              if (done) {
                if (mediaSource.readyState === "open") mediaSource.endOfStream();
                return;
              }
              if (sourceBuffer.updating) {
                await new Promise<void>((resolve) => {
                  sourceBuffer.addEventListener("updateend", () => resolve(), { once: true });
                });
              }
              sourceBuffer.appendBuffer(value);
              await new Promise<void>((resolve) => {
                sourceBuffer.addEventListener("updateend", () => resolve(), { once: true });
              });
              return pump();
            };

            await pump();
          } catch (err) {
            console.error("❌ [Voice] Error streaming audio:", err);
            if (mediaSource.readyState === "open") mediaSource.endOfStream("decode");
          }
        })();
      });

      ttsStartedAtRef.current = performance.now();
      await audio.play();
    } else {
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      setupAudioHandlers(audio, audioUrl);

      await audio.play();
    }
  } catch (error) {
    console.error("Error playing audio:", error);
    setIsPlayingAudio(false);
    setIsLoadingAudio(false);
    setCallState("connected");
    setError(error instanceof Error ? error.message : "Failed to generate speech");
    isGeneratingTTSRef.current = false;
    setTimeout(() => setError(null), 5000);
  }
}
