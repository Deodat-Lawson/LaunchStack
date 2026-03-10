import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

/**
 * Text-to-Speech API using ElevenLabs TTS v3
 * Converts text to speech audio
 */

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Initialize ElevenLabs client
const getElevenLabsClient = () => {
  if (!ELEVENLABS_API_KEY) {
    throw new Error("ElevenLabs API key not configured");
  }
  return new ElevenLabsClient({
    apiKey: ELEVENLABS_API_KEY,
  });
};

// Default voice ID (Lily voice)
// const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "L1QogKoobNwLy4IaMsyA";
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "qyFhaJEAwHR0eYLCmlUT";

interface TextToSpeechRequest {
  text: string;
  voiceId?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
}

export async function POST(request: Request) {
  try {
    // Authenticate user
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json() as TextToSpeechRequest;
    const { text, voiceId, modelId, stability, similarityBoost, style, useSpeakerBoost } = body;

    // Check for emotion tags in text (ElevenLabs format: [emotion])
    const emotionTagMatch = /^\[(\w+)\]\s*(.+)$/.exec(text);
    const emotionTag = emotionTagMatch?.[1] ?? null;
    const cleanText = emotionTagMatch?.[2] ?? text;
    
    // Log the text being converted to speech
    console.log("🔊 [Text-to-Speech API] Streaming text to speech:");
    console.log("   Text:", cleanText);
    console.log("   Length:", cleanText.length, "characters");
    console.log("   Voice ID:", voiceId ?? DEFAULT_VOICE_ID);
    console.log("   Model:", modelId ?? "eleven_v3");
    if (emotionTag) {
      console.log("   🎭 Emotion tag detected:", emotionTag);
    }

    if (!text || text.trim().length === 0) {
      return NextResponse.json(
        { error: "Text is required" },
        { status: 400 }
      );
    }

    // Check API key and initialize client
    let elevenLabsClient: ElevenLabsClient;
    try {
      elevenLabsClient = getElevenLabsClient();
    } catch {
      return NextResponse.json(
        { error: "ElevenLabs API key not configured" },
        { status: 500 }
      );
    }

    // Use default voice if not specified
    const selectedVoiceId = voiceId ?? DEFAULT_VOICE_ID;
    // Use streaming model (eleven_v3 supports streaming)
    const selectedModelId = modelId ?? "eleven_v3"; // Streaming-capable model

    console.log("🔊 [Text-to-Speech API] Starting streaming TTS...");

    // Use ElevenLabs streaming API
    const audioStream = await elevenLabsClient.textToSpeech.stream(selectedVoiceId, {
      text: text, // Include emotion tag like [happy] at the start
      modelId: selectedModelId,
      voiceSettings: {
        stability: stability ?? 0.5,
        similarityBoost: similarityBoost ?? 0.75,
        style: style ?? 0.0,
        useSpeakerBoost: useSpeakerBoost ?? true,
      },
    });

    // Create a ReadableStream to pipe the audio chunks to the response
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Process the audio stream chunk by chunk
          // ElevenLabs stream is an AsyncIterable
          for await (const chunk of audioStream as unknown as AsyncIterable<Uint8Array | Buffer | ArrayBuffer>) {
            // Convert chunk to Uint8Array if needed
            // ElevenLabs stream returns Buffer or Uint8Array chunks
            let chunkData: Uint8Array;
            
            if (chunk instanceof Uint8Array) {
              chunkData = chunk;
            } else if (Buffer.isBuffer(chunk)) {
              chunkData = new Uint8Array(chunk);
            } else if (chunk instanceof ArrayBuffer) {
              chunkData = new Uint8Array(chunk);
            } else {
              // Try to convert to Uint8Array
              chunkData = new Uint8Array(chunk as ArrayBuffer);
            }
            
            // Enqueue the chunk to the response stream
            controller.enqueue(chunkData);
          }
          
          // Close the stream when done
          controller.close();
          console.log("✅ [Text-to-Speech API] Streaming completed");
        } catch (error) {
          console.error("❌ [Text-to-Speech API] Streaming error:", error);
          controller.error(error);
        }
      },
    });

    // Return streaming response
    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
        "Transfer-Encoding": "chunked",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Error in text-to-speech:", error);
    return NextResponse.json(
      { error: "Failed to generate speech" },
      { status: 500 }
    );
  }
}
