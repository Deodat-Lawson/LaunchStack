/**
 * Audio transcription — detection, transcription via the configured provider
 * (Gemini audio understanding, or the self-hosted transcription service),
 * and conversion of the transcript into an ingestable document.
 */
import { getStoragePort } from "@launchstack/runtime/storage";
import { creditsDebitSafe } from "@launchstack/store/credits";
import { getTranscriptionProvider } from "./providers";
import { TranscriptionError } from "./errors";

export interface TranscriptionResult {
    text: string;
    /** Main spoken language as a BCP-47 code, or "unknown". */
    language: string;
    /** Every language heard, main one first, when the provider reports them. */
    languages?: string[];
    confidence: number;
    filename: string;
    /** Recording length when the provider measured it. */
    durationSeconds?: number;
    segments?: { start: number; end: number; text: string }[];
}

/** Determine if a MIME type is audio. */
export function isAudioMimeType(mimeType?: string): boolean {
    if (!mimeType) return false;
    return mimeType.startsWith("audio/") || mimeType === "video/mp4";
}

/** Determine if a filename has an audio extension. */
export function isAudioFileName(filename?: string): boolean {
    if (!filename) return false;
    const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase();
    return [".mp3", ".mp4", ".wav", ".flac", ".m4a", ".ogg", ".wma"].includes(ext);
}

/**
 * The formats both cloud (native Gemini) and self-hosted (ffmpeg + Whisper)
 * transcription decode: MP3, MPEG-4 (video, or audio-only .m4a), WAV, AAC,
 * FLAC and Ogg. Browsers disagree on names: Chrome and Safari call an .m4a
 * `audio/x-m4a`, others `audio/mp4` or `audio/m4a`; a .wav arrives as
 * `audio/wav`, `audio/x-wav` or `audio/wave`.
 */
const TRANSCRIBABLE_MIME_TYPES = new Set([
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "video/mp4",
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/aac",
    "audio/x-aac",
    "audio/flac",
    "audio/x-flac",
    "audio/ogg",
]);
const TRANSCRIBABLE_EXTENSIONS = new Set([".mp3", ".mp4", ".m4a", ".wav", ".aac", ".flac", ".ogg"]);

/** The client's placeholder for a type it could not name; the file name decides instead. */
const GENERIC_MIME_TYPE = "application/octet-stream";

/** Check if a file should be transcribed (see {@link TRANSCRIBABLE_MIME_TYPES}). */
export function shouldTranscribeFile(mimeType?: string, originalFilename?: string): boolean {
    if (mimeType && mimeType !== GENERIC_MIME_TYPE) {
        return TRANSCRIBABLE_MIME_TYPES.has(mimeType.toLowerCase());
    }
    if (originalFilename) {
        const ext = originalFilename.substring(originalFilename.lastIndexOf(".")).toLowerCase();
        return TRANSCRIBABLE_EXTENSIONS.has(ext);
    }
    return false;
}

/**
 * Transcribe an audio file by downloading it from storage and sending it to
 * the configured provider. Optionally debits credits for cloud deployments.
 */
export async function transcribeAudioFromUrl(
    audioUrl: string,
    filename: string,
    companyId?: bigint,
    mimeType?: string
): Promise<TranscriptionResult> {
    try {
        console.log(`[TranscribeAudio] Fetching audio from: ${audioUrl}`);

        const audioResponse = await getStoragePort().download(audioUrl);
        if (!audioResponse.ok) {
            throw new TranscriptionError(
                `Failed to fetch audio file: ${audioResponse.status} ${audioResponse.statusText}`,
                "The recording was uploaded but couldn't be read back from storage. Try again.",
                502
            );
        }

        const audioArrayBuffer = await audioResponse.arrayBuffer();
        const audioBuffer = Buffer.from(audioArrayBuffer);
        console.log(
            `[TranscribeAudio] Downloaded audio: ${filename} (${audioBuffer.length} bytes)`
        );

        const provider = await getTranscriptionProvider();
        console.log(`[TranscribeAudio] Using ${provider.name} for: ${filename}`);

        const { data, usage } = await provider.transcribe(audioBuffer, filename, {
            ...(mimeType ? { mimeType } : {}),
        });

        // creditsDebitSafe no-ops when metering is off or no CreditsPort is
        // registered, and swallows bookkeeping errors.
        if (companyId != null && usage.tokensUsed > 0) {
            await creditsDebitSafe({
                companyId,
                tokens: usage.tokensUsed,
                service: "transcription",
                description: `Transcribe ${filename} via ${provider.name}`,
                metadata: { ...usage.details, filename },
            });
        }

        console.log(
            `[TranscribeAudio] Complete: ${filename} → ${data.text.length} chars, lang=${data.language}`
        );

        return {
            text: data.text,
            language: data.language,
            ...(data.languages?.length ? { languages: data.languages } : {}),
            confidence: data.confidence,
            filename,
            ...(data.durationSeconds ? { durationSeconds: data.durationSeconds } : {}),
            ...(data.segments ? { segments: data.segments } : {}),
        };
    } catch (error) {
        console.error(`[TranscribeAudio] Error transcribing ${filename}:`, error);
        throw error;
    }
}

/**
 * Create a text document from transcribed audio — a pseudo-document that the
 * standard ingestion path processes like any text file.
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
    void language;
    const baseFilename = audioFilename.replace(/\.(mp3|mp4|wav|flac|m4a|ogg|wma)$/i, "");
    return {
        title: `${baseFilename} (Transcription)`,
        content: transcribedText,
        mimeType: "text/plain",
    };
}
