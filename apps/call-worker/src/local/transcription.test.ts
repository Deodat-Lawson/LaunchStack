import assert from "node:assert/strict";
import { test } from "node:test";

import { encodePcm16Wav } from "./audio";
import { LocalBackendError } from "./backend-client";
import { DeviceTranscriptionModel } from "./transcription";

const OPTIONS = {
    origin: "https://launchstack.example",
    deviceToken: "device-secret",
    appVersion: "1.2.3",
};
const wav = () => encodePcm16Wav(new Uint8Array([1, 0, 2, 0]), 16_000);

await test("device transcription posts mono 16 kHz s16 WAV, channel and language to the paired origin", async () => {
    let requests = 0;
    const audio = wav();
    const model = new DeviceTranscriptionModel({
        ...OPTIONS,
        fetch: async (url, init) => {
            requests += 1;
            assert.equal(url, "https://launchstack.example/api/call-notes/devices/transcribe");
            assert.equal(init?.method, "POST");
            const headers = new Headers(init.headers);
            assert.equal(headers.get("authorization"), "Bearer device-secret");
            assert.equal(headers.get("x-launchstack-capture-version"), "1.2.3");
            assert.equal(
                headers.has("content-type"),
                false,
                "fetch must supply the multipart boundary"
            );
            assert.ok(init.body instanceof FormData);
            assert.deepEqual([...init.body.keys()], ["audio", "channel", "language"]);
            assert.equal(init.body.get("channel"), "system");
            assert.equal(init.body.get("language"), "en-US");
            const file = init.body.get("audio");
            assert.ok(file instanceof Blob);
            assert.equal(file.type, "audio/wav");
            const bytes = new Uint8Array(await file.arrayBuffer());
            assert.deepEqual(bytes, audio);
            const view = new DataView(bytes.buffer);
            assert.equal(view.getUint16(22, true), 1);
            assert.equal(view.getUint32(24, true), 16_000);
            assert.equal(view.getUint16(34, true), 16);
            return Response.json({ text: "Recognized speech", language: "en" });
        },
    });
    assert.equal(
        await model.transcribe({ audioWav: audio, channel: "system", language: "en-US" }),
        "Recognized speech"
    );
    assert.equal(requests, 1);
});

await test("device transcription omits unspecified language and accepts no recognized speech", async () => {
    const model = new DeviceTranscriptionModel({
        ...OPTIONS,
        fetch: async (_url, init) => {
            assert.ok(init?.body instanceof FormData);
            assert.equal(init.body.get("channel"), "microphone");
            assert.equal(init.body.has("language"), false);
            return Response.json({ text: "" });
        },
    });
    assert.equal(await model.transcribe({ audioWav: wav(), channel: "microphone" }), "");
});

await test("device transcription preserves non-retryable authorization and upgrade exit codes", async () => {
    for (const [status, exitCode] of [
        [401, 77],
        [426, 75],
    ] as const) {
        let requests = 0;
        const model = new DeviceTranscriptionModel({
            ...OPTIONS,
            fetch: async () => {
                requests += 1;
                return new Response("denied", { status });
            },
        });
        await assert.rejects(
            model.transcribe({ audioWav: wav(), channel: "microphone" }),
            error =>
                error instanceof LocalBackendError &&
                !error.retryable &&
                error.exitCode === exitCode
        );
        assert.equal(requests, 1);
    }
});

await test("device transcription bounds stalled requests even if a fetch adapter ignores abort", async context => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const model = new DeviceTranscriptionModel({
        ...OPTIONS,
        timeoutMs: 20,
        fetch: async () => Promise.withResolvers<Response>().promise,
    });
    const pending = model.transcribe({ audioWav: wav(), channel: "microphone" });
    const rejected = assert.rejects(pending, /timed out after 20ms/);
    context.mock.timers.tick(20);
    await rejected;
});

await test("device transcription respects cancellation and rejects malformed responses", async () => {
    const controller = new AbortController();
    controller.abort(new Error("capture stopped"));
    const model = new DeviceTranscriptionModel({
        ...OPTIONS,
        fetch: async () => Response.json({ other: "invalid" }),
    });
    await assert.rejects(
        model.transcribe({ audioWav: wav(), channel: "microphone", signal: controller.signal }),
        /capture stopped/
    );
    await assert.rejects(model.transcribe({ audioWav: wav(), channel: "microphone" }), /text/);
});
