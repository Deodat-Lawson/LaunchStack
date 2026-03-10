import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import OpenAI from "openai";
import { File } from "formdata-node";

/**
 * Speech-to-Text API using OpenAI Whisper
 * Converts audio to text
 * Note: OpenAI client is lazy-initialized at runtime to avoid build failures
 * when OPENAI_API_KEY is not available during Next.js build (e.g. in Docker).
 */

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

    // Check OpenAI API key (must be done before instantiating client)
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Get audio file from request
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | Blob;

    if (!audioFile) {
      return NextResponse.json(
        { error: "Audio file is required" },
        { status: 400 }
      );
    }

    // Convert to buffer for Node.js File creation
    const audioBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(audioBuffer);

    // Quick guard: avoid sending zero-duration/header-only audio to OpenAI
    const MIN_AUDIO_BYTES = 45; // WAV header is 44 bytes; anything at/below is empty
    if (!buffer.length || buffer.length < MIN_AUDIO_BYTES) {
      console.warn("🎤 [Speech-to-Text] Skipping transcription: audio too short", {
        mimeType: audioFile.type,
        size: buffer.length,
      });
      return NextResponse.json(
        { error: "Audio too short. Please record at least 0.1 seconds before sending." },
        { status: 400 }
      );
    }

    // Determine file extension from MIME type
    const mimeType = audioFile.type || "audio/webm";
    let extension = "webm";
    if (mimeType.includes("wav")) extension = "wav";
    else if (mimeType.includes("mp3")) extension = "mp3";
    else if (mimeType.includes("m4a")) extension = "m4a";
    else if (mimeType.includes("ogg")) extension = "ogg";
    else if (mimeType.includes("flac")) extension = "flac";
    
    // Create File object compatible with OpenAI SDK using formdata-node
    // Ensure proper filename with extension for OpenAI to recognize format
    const audioFileForOpenAI = new File([buffer], `audio.${extension}`, {
      type: mimeType,
      lastModified: Date.now(),
    });

    console.log("🎤 [Speech-to-Text] Processing audio file:");
    console.log("   MIME type:", mimeType);
    console.log("   Extension:", extension);
    console.log("   File size:", buffer.length, "bytes");
    console.log("   Filename:", `audio.${extension}`);

    const transcription = await openai.audio.transcriptions.create({
      file: audioFileForOpenAI as unknown as globalThis.File, // Type assertion for OpenAI SDK compatibility
      model: "gpt-4o-transcribe",
      response_format: "text",
    });

    const transcribedText = String(transcription);
    
    // Log the transcribed text
    console.log("🎤 [Speech-to-Text] Transcribed audio:");
    console.log("   Text:", transcribedText);
    console.log("   Length:", transcribedText.length, "characters");
    console.log("   Audio size:", audioFile.size, "bytes");

    return NextResponse.json(
      {
        text: transcribedText,
      },
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
