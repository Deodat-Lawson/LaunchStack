import { z } from "zod";

import {
    getTranscriptionProvider,
    isTranscriptionError,
} from "@launchstack/conversion/audio-transcription";

import { localeOfRequest } from "~/i18n/server";
import { wordEnglish } from "~/i18n/translate";
import { requireCaptureDevice } from "~/server/call-notes/device-auth";
import { getEngine } from "~/server/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const FieldsSchema = z.object({
    channel: z.enum(["microphone", "system"]),
    language: z.string().min(1).max(32).optional(),
});

export async function POST(request: Request): Promise<Response> {
    const auth = await requireCaptureDevice(request);
    if (!auth.success) return auth.response;
    const contentLength = request.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
        return Response.json({ error: "audio_too_large" }, { status: 413 });
    }
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "audio_required" }, { status: 400 });
    let received = 0;
    let tooLarge = false;
    const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
            const chunk = await reader.read();
            if (chunk.done) {
                controller.close();
                return;
            }
            received += chunk.value.byteLength;
            if (received > MAX_REQUEST_BYTES) {
                tooLarge = true;
                await reader.cancel();
                controller.error(new Error("audio_too_large"));
                return;
            }
            controller.enqueue(chunk.value);
        },
        cancel: reason => reader.cancel(reason),
    });
    let form: FormData;
    try {
        form = await new Response(body, { headers: request.headers }).formData();
    } catch {
        return Response.json(
            { error: tooLarge ? "audio_too_large" : "invalid_request" },
            { status: tooLarge ? 413 : 400 }
        );
    } finally {
        reader.releaseLock();
    }
    const fields = FieldsSchema.safeParse({
        channel: form.get("channel"),
        language: form.get("language") ?? undefined,
    });
    const audio = form.get("audio");
    if (!fields.success || !audio || typeof audio === "string" || audio.size < 44) {
        return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    try {
        // As in speech-to-text, install the configured provider registry before
        // resolving it. The request's WAV exists only in this invocation's memory.
        getEngine();
        const provider = await getTranscriptionProvider();
        const result = await provider.transcribe(
            Buffer.from(await audio.arrayBuffer()),
            "capture.wav",
            {
                mimeType: "audio/wav",
                timestamps: false,
            }
        );
        return Response.json({
            text: result.data.text,
            ...(result.data.language ? { language: result.data.language } : {}),
        });
    } catch (error) {
        // Never log provider errors: an upstream error may echo request audio.
        if (isTranscriptionError(error)) {
            return Response.json(
                {
                    error: wordEnglish(
                        error.userMessage,
                        "chat.server.voice.transcription",
                        localeOfRequest(request)
                    ),
                },
                { status: error.status }
            );
        }
        return Response.json({ error: "transcription_failed" }, { status: 503 });
    }
}
