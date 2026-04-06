import { NextResponse } from "next/server";
import { auth } from "~/lib/auth-server";

interface TextToSpeechRequest {
  text: string;
  voiceId?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
}

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "qyFhaJEAwHR0eYLCmlUT";

async function streamElevenLabs(body: TextToSpeechRequest): Promise<NextResponse> {
  const { ElevenLabsClient } = await import("@elevenlabs/elevenlabs-js");
  const client = new ElevenLabsClient({ apiKey: ELEVENLABS_API_KEY });

  const emotionTagMatch = /^\[(\w+)\]\s*(.+)$/.exec(body.text);
  const cleanText = emotionTagMatch?.[2] ?? body.text;

  const voiceId = body.voiceId ?? DEFAULT_VOICE_ID;
  const modelId = body.modelId ?? "eleven_v3";

  console.log("🔊 [TTS/ElevenLabs] Streaming:", cleanText.length, "chars, voice:", voiceId);

  const audioStream = await client.textToSpeech.stream(voiceId, {
    text: body.text,
    modelId,
    voiceSettings: {
      stability: body.stability ?? 0.5,
      similarityBoost: body.similarityBoost ?? 0.75,
      style: body.style ?? 0.0,
      useSpeakerBoost: body.useSpeakerBoost ?? true,
    },
  });

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of audioStream as unknown as AsyncIterable<Uint8Array | Buffer | ArrayBuffer>) {
          let data: Uint8Array;
          if (chunk instanceof Uint8Array) data = chunk;
          else if (Buffer.isBuffer(chunk)) data = new Uint8Array(chunk);
          else data = new Uint8Array(chunk as ArrayBuffer);
          controller.enqueue(data);
        }
        controller.close();
      } catch (error) {
        console.error("❌ [TTS/ElevenLabs] Streaming error:", error);
        controller.error(error);
      }
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-cache",
      "Transfer-Encoding": "chunked",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function streamOpenAI(body: TextToSpeechRequest): Promise<NextResponse> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const voice = (body.voiceId as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer") ?? "nova";

  console.log("🔊 [TTS/OpenAI] Streaming:", body.text.length, "chars, voice:", voice);

  const response = await client.audio.speech.create({
    model: "tts-1",
    voice,
    input: body.text,
    response_format: "mp3",
  });

  const arrayBuffer = await response.arrayBuffer();

  return new NextResponse(arrayBuffer, {
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

    const body = (await request.json()) as TextToSpeechRequest;

    if (!body.text || body.text.trim().length === 0) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    if (ELEVENLABS_API_KEY) {
      return await streamElevenLabs(body);
    }

    if (process.env.OPENAI_API_KEY) {
      return await streamOpenAI(body);
    }

    return NextResponse.json(
      { error: "No TTS provider configured. Set ELEVENLABS_API_KEY or OPENAI_API_KEY." },
      { status: 500 }
    );
  } catch (error) {
    console.error("Error in text-to-speech:", error);
    return NextResponse.json(
      { error: "Failed to generate speech" },
      { status: 500 }
    );
  }
}
