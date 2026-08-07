import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  CLOUD_TTS_DEFAULT_LANGUAGE,
  CLOUD_TTS_DEFAULT_VOICE,
  CLOUD_TTS_ENDPOINT,
  CLOUD_TTS_MAX_INPUT_BYTES,
} from "@launchstack/core/llm/types";
import { validateRequestBody, TextToSpeechSchema } from "~/lib/validation";

/**
 * Speech generation, via Google Cloud Text-to-Speech.
 *
 * The one capability that cannot go through the OpenAI-compatible endpoint the
 * rest of the deployment uses: that layer exposes `/chat/completions`,
 * `/embeddings`, `/images/generations`, `/videos` and `/models`, and no audio
 * route at all. So this calls the REST API directly with `fetch` — no client
 * library, and the same `GOOGLE_AI_API_KEY` as everything else rather than a
 * service account.
 */

interface TextToSpeechRequest {
  text: string;
  voiceId?: string;
  languageCode?: string;
}

const DEFAULT_VOICE = process.env.GEMINI_TTS_VOICE ?? CLOUD_TTS_DEFAULT_VOICE;

interface CloudTtsResponse {
  audioContent?: string;
  error?: { message?: string; status?: string };
}

async function synthesize(
  body: TextToSpeechRequest,
  apiKey: string,
): Promise<NextResponse> {
  // A leading [tag] used to steer delivery on the previous provider. Chirp 3: HD
  // exposes no style field, so the tag is stripped rather than spoken — leaving
  // it in would have the voice read the word "excited" aloud.
  const emotionTagMatch = /^\[(\w+)\]\s*(.+)$/.exec(body.text);
  const text = emotionTagMatch?.[2] ?? body.text;

  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > CLOUD_TTS_MAX_INPUT_BYTES) {
    return NextResponse.json(
      {
        error:
          `Text too long for speech generation (${bytes} bytes, limit ` +
          `${CLOUD_TTS_MAX_INPUT_BYTES}). Split it into shorter turns.`,
      },
      { status: 413 },
    );
  }

  const name = body.voiceId ?? DEFAULT_VOICE;
  // The locale must agree with the voice, which embeds one: sending
  // "en-US-Chirp3-HD-Kore" with languageCode "de-DE" is rejected. Derive it
  // from the voice name unless the caller is explicit.
  const languageCode =
    body.languageCode ??
    /^([a-z]{2}-[A-Z]{2})-/.exec(name)?.[1] ??
    CLOUD_TTS_DEFAULT_LANGUAGE;

  console.log("🔊 [TTS] Synthesizing:", text.length, "chars, voice:", name);

  const response = await fetch(CLOUD_TTS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode, name },
      audioConfig: { audioEncoding: "MP3" },
    }),
  });

  const payload = (await response.json()) as CloudTtsResponse;

  if (!response.ok) {
    console.error("❌ [TTS] Request failed:", response.status, payload.error);
    return NextResponse.json(
      {
        error:
          payload.error?.message ??
          `Speech generation failed (${response.status})`,
      },
      { status: response.status === 429 ? 429 : 502 },
    );
  }

  if (!payload.audioContent) {
    console.error("❌ [TTS] Response carried no audio payload");
    return NextResponse.json(
      { error: "Speech generation returned no audio" },
      { status: 502 },
    );
  }

  const mp3 = Buffer.from(payload.audioContent, "base64");

  return new NextResponse(new Uint8Array(mp3), {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const validation = await validateRequestBody(request, TextToSpeechSchema);
    if (!validation.success) return validation.response;
    const body = validation.data as TextToSpeechRequest;

    const apiKey = process.env.GOOGLE_AI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "Speech generation is not configured. Set GOOGLE_AI_API_KEY." },
        { status: 500 },
      );
    }

    return await synthesize(body, apiKey);
  } catch (error) {
    console.error("Error in text-to-speech:", error);
    return NextResponse.json(
      { error: "Failed to generate speech" },
      { status: 500 },
    );
  }
}
