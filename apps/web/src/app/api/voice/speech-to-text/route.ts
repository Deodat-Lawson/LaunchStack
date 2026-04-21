import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import OpenAI from "openai";
import { File } from "formdata-node";

/**
 * Speech-to-Text API using OpenAI Whisper.
 * OpenAI client is lazy-initialized at runtime to avoid build failures
 * when OPENAI_API_KEY is not available during Next.js build.
 */

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || process.env.AI_API_KEY,
      ...(process.env.AI_BASE_URL ? { baseURL: process.env.AI_BASE_URL } : {}),
    });

    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | Blob;

    if (!audioFile) {
      return NextResponse.json(
        { error: "Audio file is required" },
        { status: 400 }
      );
    }

    const audioBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(audioBuffer);

    const MIN_AUDIO_BYTES = 45;
    if (!buffer.length || buffer.length < MIN_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "Audio too short. Please record at least 0.1 seconds before sending." },
        { status: 400 }
      );
    }

    const mimeType = audioFile.type || "audio/webm";
    let extension = "webm";
    if (mimeType.includes("wav")) extension = "wav";
    else if (mimeType.includes("mp3")) extension = "mp3";
    else if (mimeType.includes("m4a")) extension = "m4a";
    else if (mimeType.includes("ogg")) extension = "ogg";
    else if (mimeType.includes("flac")) extension = "flac";
    
    const audioFileForOpenAI = new File([buffer], `audio.${extension}`, {
      type: mimeType,
      lastModified: Date.now(),
    });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFileForOpenAI as unknown as globalThis.File,
      model: "gpt-4o-transcribe",
      response_format: "text",
    });

    const transcribedText = String(transcription);

    return NextResponse.json(
      { text: transcribedText },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in speech-to-text:", error);
    return NextResponse.json(
      { error: "Failed to transcribe audio" },
      { status: 500 }
    );
  }
}
