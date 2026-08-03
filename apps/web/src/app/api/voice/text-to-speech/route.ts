import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  GEMINI_NATIVE_BASE_URL,
  GEMINI_TTS_DEFAULT_VOICE,
  GEMINI_TTS_MAX_INPUT_BYTES,
  GEMINI_TTS_MODEL,
  GEMINI_TTS_SAMPLE_RATE,
} from "@launchstack/core/llm/types";
import { validateRequestBody, TextToSpeechSchema } from "~/lib/validation";

/**
 * Speech generation, via Gemini.
 *
 * This is the one capability that cannot go through the OpenAI-compatible
 * endpoint the rest of the deployment uses: that layer exposes
 * `/chat/completions`, `/embeddings`, `/images/generations`, `/videos` and
 * `/models`, and no speech route at all. So this calls the native Gemini API
 * directly with `fetch` — deliberately not through `@google/genai`, which would
 * pull `google-auth-library`, `protobufjs` and `ws` into the route bundle to
 * save one HTTP call.
 */

interface TextToSpeechRequest {
  text: string;
  voiceId?: string;
  modelId?: string;
}

const DEFAULT_VOICE = process.env.GEMINI_TTS_VOICE ?? GEMINI_TTS_DEFAULT_VOICE;

/**
 * Wrap raw PCM in a WAV container.
 *
 * Gemini returns headerless little-endian signed 16-bit PCM, which no browser
 * will play. A 44-byte RIFF header is the whole difference between that and an
 * `audio/wav` a plain `<audio>` element accepts, so we add one rather than
 * pulling in a transcoder to produce mp3.
 */
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4); // file size minus the first 8 bytes
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format 1 = PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

interface GeminiTtsResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { data?: string } }> };
  }>;
  error?: { message?: string };
}

async function synthesizeGemini(
  body: TextToSpeechRequest,
  apiKey: string,
): Promise<NextResponse> {
  // A leading [tag] is a style instruction, not something to read aloud.
  // Gemini takes direction as ordinary prose rather than inline markup, so the
  // tag becomes a prefix sentence and never reaches the spoken output.
  const emotionTagMatch = /^\[(\w+)\]\s*(.+)$/.exec(body.text);
  const emotion = emotionTagMatch?.[1];
  const cleanText = emotionTagMatch?.[2] ?? body.text;
  const prompt = emotion
    ? `Say the following in a ${emotion} tone: ${cleanText}`
    : cleanText;

  // Google truncates silently past its ceiling, which would ship a
  // half-finished sentence as a success. Refuse instead.
  const promptBytes = Buffer.byteLength(prompt, "utf8");
  if (promptBytes > GEMINI_TTS_MAX_INPUT_BYTES) {
    return NextResponse.json(
      {
        error:
          `Text too long for speech generation (${promptBytes} bytes, limit ` +
          `${GEMINI_TTS_MAX_INPUT_BYTES}). Split it into shorter turns.`,
      },
      { status: 413 },
    );
  }

  const model = body.modelId ?? GEMINI_TTS_MODEL;
  const voiceName = body.voiceId ?? DEFAULT_VOICE;

  console.log(
    "🔊 [TTS/Gemini] Synthesizing:",
    cleanText.length,
    "chars, voice:",
    voiceName,
  );

  const response = await fetch(
    `${GEMINI_NATIVE_BASE_URL}/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
        },
      }),
    },
  );

  const payload = (await response.json()) as GeminiTtsResponse;

  if (!response.ok) {
    console.error("❌ [TTS/Gemini] Request failed:", response.status, payload.error);
    return NextResponse.json(
      {
        error:
          payload.error?.message ??
          `Speech generation failed (${response.status})`,
      },
      { status: response.status === 429 ? 429 : 502 },
    );
  }

  const base64 = payload.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64) {
    console.error("❌ [TTS/Gemini] Response carried no audio payload");
    return NextResponse.json(
      { error: "Speech generation returned no audio" },
      { status: 502 },
    );
  }

  const wav = pcmToWav(Buffer.from(base64, "base64"), GEMINI_TTS_SAMPLE_RATE);

  return new NextResponse(new Uint8Array(wav), {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
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

    return await synthesizeGemini(body, apiKey);
  } catch (error) {
    console.error("Error in text-to-speech:", error);
    return NextResponse.json(
      { error: "Failed to generate speech" },
      { status: 500 },
    );
  }
}
