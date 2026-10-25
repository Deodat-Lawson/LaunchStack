import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import type { useTranslations } from "next-intl";

/** `useTranslations("chat.voice")`, for the errors this writes itself. */
export type VoiceTranslator = ReturnType<typeof useTranslations<"chat.voice">>;

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
    isProcessingRef: MutableRefObject<boolean>;
    ttsStartedAtRef: MutableRefObject<number>;
    /** Words the screen reads; without it the errors stay in English. */
    t?: VoiceTranslator;
}

export async function playTextToSpeech({
    text,
    audioRef,
    isPlayingAudio,
    isGeneratingTTSRef,
    setCallState,
    setIsLoadingAudio,
    setIsPlayingAudio,
    setError,
    isProcessingRef,
    ttsStartedAtRef,
    t,
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
            const errorData = (await response.json().catch(() => ({ error: "Unknown error" }))) as {
                error?: string;
            };
            throw new Error(
                errorData.error ??
                    (t
                        ? t("generateFailedStatus", { status: response.statusText })
                        : `Failed to generate speech: ${response.statusText}`)
            );
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
            };
            audio.onerror = () => {
                setIsPlayingAudio(false);
                setIsLoadingAudio(false);
                setCallState("connected");
                setError(t ? t("playFailed") : "Failed to play audio");
                URL.revokeObjectURL(urlToRevoke);
                audioRef.current = null;
                isGeneratingTTSRef.current = false;
            };
        };

        // One buffered response, not a stream. Speech generation returns the whole
        // clip in a single reply, so there is nothing to feed a MediaSource
        // incrementally — and the previous streaming path hardcoded `audio/mpeg`,
        // which no longer describes what this endpoint sends.
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);

        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        setupAudioHandlers(audio, audioUrl);

        ttsStartedAtRef.current = performance.now();
        await audio.play();
    } catch (error) {
        console.error("Error playing audio:", error);
        setIsPlayingAudio(false);
        setIsLoadingAudio(false);
        setCallState("connected");
        setError(
            error instanceof Error
                ? error.message
                : t
                  ? t("generateFailed")
                  : "Failed to generate speech"
        );
        isGeneratingTTSRef.current = false;
        setTimeout(() => setError(null), 5000);
    }
}
