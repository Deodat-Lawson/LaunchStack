/**
 * Audio Transcription Service
 *
 * Handles transcription of MP3/MP4 audio files using the configured provider
 * (Groq Whisper, OpenAI Whisper, or sidecar).
 * Converts audio files to text for processing through the standard document pipeline.
 */

import { getStoragePort } from "@launchstack/core/storage";
import { getTranscriptionProvider } from "./providers";
import { creditsDebitSafe } from "@launchstack/core/credits";
import { isCloudMode } from "@launchstack/core/providers/registry";

const SIDECAR_URL = process.env.SIDECAR_URL ?? "http://localhost:8000";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  language: string;
  confidence: number;
  filename: string;
  segments?: TranscriptSegment[];
}

export interface VideoTranscriptionResult {
  text: string;
  language: string;
  confidence: number;
  title: string;
  duration: number | null;
  source_url: string;
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

    const audioResponse = await getStoragePort().download(audioUrl);
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

    // Debit credits if cloud mode and companyId available. creditsDebitSafe
    // no-ops when no CreditsPort is registered and swallows bookkeeping errors.
    if (isCloudMode() && companyId != null && usage.tokensUsed > 0) {
      await creditsDebitSafe({
        companyId,
        tokens: usage.tokensUsed,
        service: "transcription",
        description: `Transcribe ${filename} via ${provider.name}`,
        metadata: { ...usage.details, filename },
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

/**
 * Check if a string looks like a video platform URL that yt-dlp can handle
 */
export function isVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const videoHosts = [
      "youtube.com",
      "www.youtube.com",
      "youtu.be",
      "m.youtube.com",
      "vimeo.com",
      "www.vimeo.com",
      "player.vimeo.com",
      "tiktok.com",
      "www.tiktok.com",
      "twitter.com",
      "x.com",
      "dailymotion.com",
      "www.dailymotion.com",
      "twitch.tv",
      "www.twitch.tv",
      "clips.twitch.tv",
      "facebook.com",
      "www.facebook.com",
      "fb.watch",
      "instagram.com",
      "www.instagram.com",
      "soundcloud.com",
      "www.soundcloud.com",
      "bilibili.com",
      "www.bilibili.com",
    ];
    return videoHosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}

/**
 * Transcribe audio from a video platform URL via the sidecar's
 * /download-and-transcribe endpoint (yt-dlp + Whisper).
 */
export async function transcribeVideoFromUrl(
  videoUrl: string,
  maxDuration = 7200
): Promise<VideoTranscriptionResult> {
  console.log(`[TranscribeVideo] Sending to sidecar: ${videoUrl}`);

  const response = await fetch(`${SIDECAR_URL}/download-and-transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: videoUrl, max_duration: maxDuration }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Video transcription failed: ${response.statusText} - ${errorText}`
    );
  }

  const result = (await response.json()) as VideoTranscriptionResult;
  console.log(
    `[TranscribeVideo] Complete: "${result.title}" → ${result.text.length} chars, lang=${result.language}`
  );

  return result;
}
