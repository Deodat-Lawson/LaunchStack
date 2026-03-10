import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { float32ToWav } from "./VoiceChatUtils";

interface ProcessVadAudioParams {
  audio: Float32Array;
  isProcessingRef: MutableRefObject<boolean>;
  onSendMessage: (content: string) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  isMutedRef: MutableRefObject<boolean>;
  forceProcessing?: boolean;
}

export async function processVadAudio({
  audio,
  isProcessingRef,
  onSendMessage,
  setError,
  isMutedRef,
  forceProcessing = false,
}: ProcessVadAudioParams) {
  if (!forceProcessing && (isProcessingRef.current || isMutedRef.current)) {
    return;
  }

  isProcessingRef.current = true;
  const duration = (audio.length / 16000).toFixed(2);
  console.log(`🎤 [VAD] Processing speech (${audio.length} samples, ${duration}s)`);

  try {
    const wavBlob = float32ToWav(audio, 16000);
    console.log(`🎤 [VAD] Created WAV blob: ${wavBlob.size} bytes`);

    const formData = new FormData();
    formData.append("audio", wavBlob, "recording.wav");

    console.log("🎤 [VAD] Sending audio to Speech-to-Text API");
    console.log("🎤 [VAD] Form data:", formData);

    const response = await fetch("/api/study-agent/speech-to-text", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) throw new Error("Failed to transcribe audio");

    const data = (await response.json()) as { text?: string };
    const transcribedText = data.text?.trim() ?? "";

    console.log("🎤 [VAD] Transcription:", transcribedText);

    if (transcribedText.length >= 2) {
      onSendMessage(transcribedText);
    } else {
      console.log("🎤 [VAD] Transcript too short, ignoring");
    }
  } catch (err) {
    console.error("❌ [VAD] Error processing audio:", err);
    setError("Failed to process speech");
    setTimeout(() => setError(null), 3000);
  } finally {
    isProcessingRef.current = false;
  }
}