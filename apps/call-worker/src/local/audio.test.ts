import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { type spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import {
    encodePcm16Wav,
    FfmpegPcmSource,
    FfmpegPcmSourceError,
    SystemAudioPcmSource,
    SystemAudioPcmSourceError,
} from "./audio";

class FakeFfmpegProcess extends EventEmitter {
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    readonly killed: NodeJS.Signals[] = [];
    started = false;

    private closed = false;

    constructor(
        private readonly outputChunks: readonly Uint8Array[] = [],
        private readonly exitCode: number | null = 0,
        private readonly errorText = "",
        private readonly holdOpen = false
    ) {
        super();
    }

    start(): void {
        this.started = true;
        queueMicrotask(() => {
            if (this.closed || this.holdOpen) return;
            for (const chunk of this.outputChunks) {
                if (this.closed) return;
                this.stdout.write(chunk);
            }
            if (this.errorText) this.stderr.write(this.errorText);
            this.close(this.exitCode, null);
        });
    }

    kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
        this.killed.push(signal);
        this.close(null, signal);
        return true;
    }

    private close(code: number | null, signal: NodeJS.Signals | null): void {
        if (this.closed) return;
        this.closed = true;
        this.stdout.end();
        this.stderr.end();
        queueMicrotask(() => this.emit("close", code, signal));
    }
}

function fakeSpawn(process: FakeFfmpegProcess, calls: string[][]) {
    return ((_: string, args: readonly string[], options: SpawnOptions) => {
        calls.push([...args, `shell=${String(options.shell)}`]);
        process.start();
        return process as unknown as ChildProcess;
    }) as typeof spawn;
}

function fakeSystemSpawn(
    statusProcess: FakeFfmpegProcess,
    captureProcess: FakeFfmpegProcess,
    calls: string[][]
) {
    return ((_: string, args: readonly string[], options: SpawnOptions) => {
        calls.push([...args, `shell=${String(options.shell)}`]);
        const process = args[0] === "--status" ? statusProcess : captureProcess;
        process.start();
        return process as unknown as ChildProcess;
    }) as typeof spawn;
}

function readyStatus(): Uint8Array {
    return new TextEncoder().encode(
        JSON.stringify({
            supported: true,
            authorized: true,
            reason: "ready",
            message: "ready",
        })
    );
}

const FIXED_START = new Date("2026-08-20T10:00:00.000Z");

await test("FfmpegPcmSource frames PCM across arbitrary stdout chunks and preserves timing", async () => {
    const child = new FakeFfmpegProcess([
        new Uint8Array([0x01]),
        new Uint8Array([0x02, 0x03, 0x04, 0x05, 0x06]),
        new Uint8Array([0x07]),
        new Uint8Array([0x08, 0x09, 0x0a]),
    ]);
    const spawnCalls: string[][] = [];
    const source = new FfmpegPcmSource({
        ffmpegPath: "fake-ffmpeg",
        input: "fake-device",
        inputFormat: "fake-format",
        sampleRate: 1_000,
        frameSamples: 2,
        clock: () => new Date(FIXED_START),
        spawn: fakeSpawn(child, spawnCalls),
    });

    const frames = [];
    for await (const frame of source.frames(new AbortController().signal)) frames.push(frame);

    assert.deepEqual(
        frames.map(frame => ({
            pcm: [...frame.pcm],
            capturedAt: frame.capturedAt.toISOString(),
            durationMs: frame.durationMs,
        })),
        [
            {
                pcm: [0x01, 0x02, 0x03, 0x04],
                capturedAt: FIXED_START.toISOString(),
                durationMs: 2,
            },
            {
                pcm: [0x05, 0x06, 0x07, 0x08],
                capturedAt: new Date(FIXED_START.getTime() + 2).toISOString(),
                durationMs: 2,
            },
            {
                pcm: [0x09, 0x0a],
                capturedAt: new Date(FIXED_START.getTime() + 4).toISOString(),
                durationMs: 1,
            },
        ]
    );
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0]?.at(-1), "shell=false");
    assert.equal(child.killed.length, 0);
});

await test("FfmpegPcmSource stops a running process cleanly when aborted", async () => {
    const child = new FakeFfmpegProcess([], 0, "", true);
    const source = new FfmpegPcmSource({
        ffmpegPath: "fake-ffmpeg",
        input: "fake-device",
        inputFormat: "fake-format",
        sampleRate: 16_000,
        frameSamples: 320,
        spawn: fakeSpawn(child, []),
    });
    const controller = new AbortController();
    const iterator = source.frames(controller.signal)[Symbol.asyncIterator]();
    const pending = iterator.next();

    await Promise.resolve();
    assert.equal(child.started, true);
    controller.abort(new Error("test stopped"));

    assert.deepEqual(await pending, { done: true, value: undefined });
    assert.deepEqual(child.killed, ["SIGTERM"]);
});

await test("FfmpegPcmSource exposes prompt native shutdown for a blocked iterator", async () => {
    const child = new FakeFfmpegProcess([], 0, "", true);
    const source = new FfmpegPcmSource({
        ffmpegPath: "fake-ffmpeg",
        input: "fake-device",
        inputFormat: "fake-format",
        sampleRate: 16_000,
        frameSamples: 320,
        spawn: fakeSpawn(child, []),
    });
    const controller = new AbortController();
    const pending = source.frames(controller.signal)[Symbol.asyncIterator]().next();
    await Promise.resolve();
    source.stop();
    await new Promise<void>(resolve => setImmediate(resolve));
    controller.abort(new Error("test stopped"));
    assert.deepEqual(await pending, { done: true, value: undefined });
    assert.deepEqual(child.killed, ["SIGTERM"]);
});

await test("FfmpegPcmSource reports nonzero fake ffmpeg exits and stderr", async () => {
    const child = new FakeFfmpegProcess([], 7, "device unavailable\n");
    const source = new FfmpegPcmSource({
        ffmpegPath: "fake-ffmpeg",
        input: "fake-device",
        inputFormat: "fake-format",
        sampleRate: 16_000,
        frameSamples: 320,
        spawn: fakeSpawn(child, []),
    });

    await assert.rejects(
        async () => {
            for await (const _frame of source.frames(new AbortController().signal)) {
                assert.fail(`Unexpected ${_frame.pcm.byteLength}-byte frame before source failure`);
            }
        },
        (error: unknown) =>
            error instanceof FfmpegPcmSourceError &&
            error.message.includes("ffmpeg exited with code 7: device unavailable")
    );
});

await test("SystemAudioPcmSource strictly parses a ready status response", async () => {
    const statusProcess = new FakeFfmpegProcess([readyStatus()]);
    const captureProcess = new FakeFfmpegProcess([], 0, "", true);
    const calls: string[][] = [];
    const source = new SystemAudioPcmSource({
        helperPath: "launchstack-system-audio",
        sampleRate: 1_000,
        frameSamples: 2,
        spawn: fakeSystemSpawn(statusProcess, captureProcess, calls),
    });

    const readiness = await source.probeStatus();

    assert.deepEqual(readiness, {
        ready: true,
        code: "ready",
        supported: true,
        authorized: true,
        message: "ready",
    });
    assert.deepEqual(calls, [["--status", "shell=false"]]);
});

await test("SystemAudioPcmSource returns typed permission diagnostics", async () => {
    const statusProcess = new FakeFfmpegProcess(
        [
            new TextEncoder().encode(
                JSON.stringify({
                    supported: true,
                    authorized: false,
                    reason: "permission_denied",
                    message: "Screen capture permission is required",
                })
            ),
        ],
        2
    );
    const source = new SystemAudioPcmSource({
        helperPath: "launchstack-system-audio",
        spawn: fakeSpawn(statusProcess, []),
    });

    assert.deepEqual(await source.probeStatus(), {
        ready: false,
        code: "permission_denied",
        supported: true,
        authorized: false,
        message: "Screen capture permission is required",
    });
});

await test("SystemAudioPcmSource rejects malformed status JSON before capture", async () => {
    const statusProcess = new FakeFfmpegProcess([new TextEncoder().encode("{}")]);
    const captureProcess = new FakeFfmpegProcess([], 0, "", true);
    const calls: string[][] = [];
    const source = new SystemAudioPcmSource({
        helperPath: "launchstack-system-audio",
        spawn: fakeSystemSpawn(statusProcess, captureProcess, calls),
    });

    await assert.rejects(
        async () => {
            for await (const _frame of source.frames(new AbortController().signal)) {
                assert.fail(`Unexpected ${_frame.pcm.byteLength}-byte frame before readiness`);
            }
        },
        (error: unknown) =>
            error instanceof SystemAudioPcmSourceError &&
            error.code === "invalid_status" &&
            error.message.includes("supported and authorized")
    );
    assert.deepEqual(calls, [["--status", "shell=false"]]);
});

await test("SystemAudioPcmSource cancels the capture child without retaining a process", async () => {
    const statusProcess = new FakeFfmpegProcess([readyStatus()]);
    const captureProcess = new FakeFfmpegProcess([], 0, "", true);
    const calls: string[][] = [];
    const source = new SystemAudioPcmSource({
        helperPath: "launchstack-system-audio",
        sampleRate: 16_000,
        frameSamples: 320,
        spawn: fakeSystemSpawn(statusProcess, captureProcess, calls),
    });
    const controller = new AbortController();
    const iterator = source.frames(controller.signal)[Symbol.asyncIterator]();
    const pending = iterator.next();
    while (!captureProcess.started) {
        await new Promise<void>(resolve => setImmediate(resolve));
    }

    await Promise.resolve();
    await Promise.resolve();
    controller.abort(new Error("test stopped"));

    assert.deepEqual(await pending, { done: true, value: undefined });
    assert.deepEqual(captureProcess.killed, ["SIGTERM"]);
    assert.deepEqual(calls, [
        ["--status", "shell=false"],
        ["--sample-rate", "16000", "shell=false"],
    ]);
});

await test("SystemAudioPcmSource reports capture child failures", async () => {
    const statusProcess = new FakeFfmpegProcess([readyStatus()]);
    const captureProcess = new FakeFfmpegProcess([], 9, "capture failed\n");
    const source = new SystemAudioPcmSource({
        helperPath: "launchstack-system-audio",
        spawn: fakeSystemSpawn(statusProcess, captureProcess, []),
    });

    await assert.rejects(
        async () => {
            for await (const _frame of source.frames(new AbortController().signal)) {
                assert.fail(`Unexpected ${_frame.pcm.byteLength}-byte frame before source failure`);
            }
        },
        (error: unknown) =>
            error instanceof SystemAudioPcmSourceError &&
            error.code === "capture_failed" &&
            error.message.includes("exited with code 9: capture failed")
    );
});

await test("SystemAudioPcmSource treats a clean capture exit as stream loss", async () => {
    const statusProcess = new FakeFfmpegProcess([readyStatus()]);
    const captureProcess = new FakeFfmpegProcess([]);
    const source = new SystemAudioPcmSource({
        helperPath: "launchstack-system-audio",
        spawn: fakeSystemSpawn(statusProcess, captureProcess, []),
    });

    await assert.rejects(
        async () => {
            for await (const _frame of source.frames(new AbortController().signal)) {
                assert.fail(`Unexpected ${_frame.pcm.byteLength}-byte frame before source exit`);
            }
        },
        (error: unknown) =>
            error instanceof SystemAudioPcmSourceError &&
            error.code === "capture_failed" &&
            error.message.includes("stopped unexpectedly")
    );
});

await test("encodePcm16Wav writes a canonical PCM header and exact payload", () => {
    const pcm = new Uint8Array([0x00, 0x80, 0xff, 0x7f]);
    const wav = encodePcm16Wav(pcm, { sampleRate: 16_000 });
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const ascii = (start: number, length: number) =>
        new TextDecoder().decode(wav.subarray(start, start + length));

    assert.equal(wav.byteLength, 44 + pcm.byteLength);
    assert.equal(ascii(0, 4), "RIFF");
    assert.equal(view.getUint32(4, true), 36 + pcm.byteLength);
    assert.equal(ascii(8, 4), "WAVE");
    assert.equal(ascii(12, 4), "fmt ");
    assert.equal(view.getUint32(16, true), 16);
    assert.equal(view.getUint16(20, true), 1);
    assert.equal(view.getUint16(22, true), 1);
    assert.equal(view.getUint32(24, true), 16_000);
    assert.equal(view.getUint32(28, true), 32_000);
    assert.equal(view.getUint16(32, true), 2);
    assert.equal(view.getUint16(34, true), 16);
    assert.equal(ascii(36, 4), "data");
    assert.equal(view.getUint32(40, true), pcm.byteLength);
    assert.deepEqual([...wav.subarray(44)], [...pcm]);

    assert.throws(
        () => encodePcm16Wav(new Uint8Array([0, 1]), { sampleRate: 16_000, channels: 2 }),
        /complete samples for every channel/
    );
});
