import { NextResponse } from "next/server";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";
import { getTranscriptionProvider } from "@launchstack/features/voice";
import { getEngine } from "~/server/engine";

/**
 * Speech-to-Text.
 *
 * Delegates to the configured transcription provider rather than holding its
 * own client, so the sidecar and cloud paths stay interchangeable and this
 * route does not need to know which one is active. The cloud provider defaults
 * to Gemini, reached on the same OpenAI-compatible endpoint as everything else.
 *
 * Callers must upload a format Gemini accepts — wav, mp3, aiff, aac, ogg or
 * flac. `MediaRecorder` produces WebM/Opus, which is not one of them, so the
 * browser converts to WAV before uploading (see `lib/voice/encodeWav.ts`).
 */

const MIN_AUDIO_BYTES = 45;

export async function POST(request: Request) {
  try {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const formData = await request.formData();
    const audioFile = formData.get("audio");

    if (!audioFile || typeof audioFile === "string") {
      return NextResponse.json(
        { error: "Audio file is required" },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await audioFile.arrayBuffer());

    if (buffer.length < MIN_AUDIO_BYTES) {
      return NextResponse.json(
        {
          error:
            "Audio too short. Please record at least 0.1 seconds before sending.",
        },
        { status: 400 },
      );
    }

    // The provider validates the extension against what the endpoint accepts,
    // so pass through what the client actually sent rather than guessing.
    const filename =
      "name" in audioFile && typeof audioFile.name === "string" && audioFile.name
        ? audioFile.name
        : "recording.wav";

    // Install provider configuration before the registry is read. On a cold
    // invocation nothing else here touches core, so without this the registry
    // is empty: TRANSCRIPTION_PROVIDER=sidecar and AI_BASE_URL are both
    // ignored, and the cloud provider is chosen with no credential. Worse,
    // getTranscriptionProvider() memoizes per process, so that wrong choice
    // would persist for every later transcription in the same instance.
    // getEngine() is idempotent and cached.
    getEngine();

    const provider = await getTranscriptionProvider();
    const result = await provider.transcribe(buffer, filename);

    return NextResponse.json({ text: result.data.text }, { status: 200 });
  } catch (error) {
    console.error("Error in speech-to-text:", error);
    return NextResponse.json(
      { error: "Failed to transcribe audio" },
      { status: 500 },
    );
  }
}
