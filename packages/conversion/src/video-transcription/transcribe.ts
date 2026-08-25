/**
 * Video transcription — detection of video-platform URLs and the
 * download-then-transcribe path (yt-dlp on the service side). Shares the
 * backing service with audio-transcription; owns its own contract and entry.
 */
import {
    getTranscriptionServiceApiKey,
    getTranscriptionServiceUrl,
} from "../transcription-service";

export interface VideoTranscriptionResult {
    text: string;
    language: string;
    confidence: number;
    title: string;
    duration: number | null;
    source_url: string;
}

/** Check if a string looks like a video platform URL that yt-dlp can handle. */
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
        return videoHosts.some(host => hostname === host || hostname.endsWith(`.${host}`));
    } catch {
        return false;
    }
}

/**
 * Transcribe audio from a video platform URL via the transcription service's
 * /download-and-transcribe endpoint (yt-dlp, then local transcription).
 */
export async function transcribeVideoFromUrl(
    videoUrl: string,
    maxDuration = 7200
): Promise<VideoTranscriptionResult> {
    console.log(`[TranscribeVideo] Sending to transcription service: ${videoUrl}`);

    const response = await fetch(`${getTranscriptionServiceUrl()}/download-and-transcribe`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-API-Key": getTranscriptionServiceApiKey(),
        },
        body: JSON.stringify({ url: videoUrl, max_duration: maxDuration }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Video transcription failed: ${response.statusText} - ${errorText}`);
    }

    const result = (await response.json()) as VideoTranscriptionResult;
    console.log(
        `[TranscribeVideo] Complete: "${result.title}" → ${result.text.length} chars, lang=${result.language}`
    );

    return result;
}
