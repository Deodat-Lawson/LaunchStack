/**
 * Audio Transcription Service
 *
 * Handles transcription of MP3/MP4 audio files using the configured provider
 * (Groq Whisper, OpenAI Whisper, or sidecar).
 * Converts audio files to text for processing through the standard document pipeline.
 */

import { fetchBlob } from "~/server/storage/vercel-blob";
import { getTranscriptionProvider } from "~/lib/providers/transcription";
import { debitTokens } from "~/lib/credits";
import { isCloudMode } from "~/lib/providers/registry";

export interface TranscriptionResult {
  text: string;
  language: string;
  confidence: number;
  filename: string;
}

/**
 * Determine if a MIME type is audio
 */
export function isAudioMimeType(mimeType?: string): boolean {
  if (!mimeType) return false;
  return mimeType.startsWith("audio/") || mimeType === "video/mp4";
}

/**
 * Determine if a filename has an audio extension
 */
export function isAudioFileName(filename?: string): boolean {
  if (!filename) return false;
  const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase();
  return [".mp3", ".mp4", ".wav", ".flac", ".m4a", ".ogg", ".wma"].includes(ext);
}

/**
 * Check if file should be transcribed
 */
export function shouldTranscribeFile(
  mimeType?: string,
  originalFilename?: string
): boolean {
  // Only transcribe MP3 and MP4 as per requirements
  if (mimeType) {
    return mimeType === "audio/mpeg" || mimeType === "video/mp4" || mimeType === "audio/mp4";
  }
  
  if (originalFilename) {
    const ext = originalFilename.substring(originalFilename.lastIndexOf(".")).toLowerCase();
    return ext === ".mp3" || ext === ".mp4";
  }
  
  return false;
}

/**
 * Transcribe audio file by downloading from URL and sending to the configured provider.
 * Optionally debits credits for cloud deployments.
 */
export async function transcribeAudioFromUrl(
  audioUrl: string,
  filename: string,
  companyId?: bigint,
): Promise<TranscriptionResult> {
  try {
    console.log(`[TranscribeAudio] Fetching audio from: ${audioUrl}`);

    // Fetch the audio file (use fetchBlob to handle private Vercel Blob URLs)
    const audioResponse = await fetchBlob(audioUrl);
    if (!audioResponse.ok) {
      throw new Error(`Failed to fetch audio file: ${audioResponse.statusText}`);
    }

    const audioArrayBuffer = await audioResponse.arrayBuffer();
    const audioBuffer = Buffer.from(audioArrayBuffer);
    console.log(`[TranscribeAudio] Downloaded audio: ${filename} (${audioBuffer.length} bytes)`);

    // Send to provider for transcription
    const provider = await getTranscriptionProvider();
    console.log(`[TranscribeAudio] Using ${provider.name} for: ${filename}`);

    const { data, usage } = await provider.transcribe(audioBuffer, filename);

    // Debit credits if cloud mode and companyId available
    if (isCloudMode() && companyId != null && usage.tokensUsed > 0) {
      await debitTokens({
        companyId,
        amount: usage.tokensUsed,
        service: "transcription",
        description: `Transcribe ${filename} via ${provider.name}`,
        metadata: { ...usage.details, filename },
      }).catch((err) => {
        console.warn("[TranscribeAudio] Credit debit failed (non-blocking):", err);
      });
    }

    console.log(`[TranscribeAudio] Complete: ${filename} → ${data.text.length} chars, lang=${data.language}`);

    return {
      text: data.text,
      language: data.language,
      confidence: data.confidence,
      filename,
    };
  } catch (error) {
    console.error(`[TranscribeAudio] Error transcribing ${filename}:`, error);
    throw error;
  }
}

/**
 * Create a text document from transcribed audio
 * Returns a pseudo-document that can be processed like a text file
 */
export function createTranscriptionDocument(
  audioFilename: string,
  transcribedText: string,
  language: string
): {
  title: string;
  content: string;
  mimeType: string;
} {
  // Remove audio extension and add .txt
  const baseFilename = audioFilename.replace(/\.(mp3|mp4|wav|flac|m4a|ogg|wma)$/i, "");
  
  return {
    title: `${baseFilename} (Transcription)`,
    content: transcribedText,
    mimeType: "text/plain",
  };
}
