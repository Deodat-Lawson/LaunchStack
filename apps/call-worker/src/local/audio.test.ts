import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { type spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import {
    encodePcm16Wav,
    SystemAudioPcmSource,
    SystemAudioPcmSourceError,
    type PcmFrame,
} from "./audio";

class FakeHelperProcess extends EventEmitter {
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

function fakeSpawn(process: FakeHelperProcess, calls: string[][]) {
    return ((_: string, args: readonly string[], options: SpawnOptions) => {
        calls.push([...args, `shell=${String(options.shell)}`]);
        process.start();
        return process as unknown as ChildProcess;
    }) as typeof spawn;
}

function fakeSystemSpawn(
    statusProcess: FakeHelperProcess,
    captureProcess: FakeHelperProcess,
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
    const ready = { supported: true, authorized: true, reason: "ready", message: "ready" };
    return new TextEncoder().encode(JSON.stringify({ microphone: ready, system: ready }));
}

const FIXED_START = new Date("2026-08-20T10:00:00.000Z");

await test("SystemAudioPcmSource strictly parses a ready status response", async () => {
    const statusProcess = new FakeHelperProcess([readyStatus()]);
    const captureProcess = new FakeHelperProcess([], 0, "", true);
    const calls: string[][] = [];
    const source = new SystemAudioPcmSource({
        helperPath: "launchstack-system-audio",
        source: "system",
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
});

await test("SystemAudioPcmSource waits for a valid slow native readiness probe", async context => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const helper = new FakeHelperProcess([], 0, "", true);
    const source = new SystemAudioPcmSource({
        helperPath: "launchstack-system-audio",
        source: "system",
        spawn: fakeSpawn(helper, []),
    });
    const result = source.probeStatus();
    context.mock.timers.tick(4_000);
    helper.stdout.end(readyStatus());
    helper.stderr.end();
    helper.emit("close", 0, null);
    assert.equal((await result).ready, true);
    assert.deepEqual(helper.killed, []);
});

await test("SystemAudioPcmSource still bounds an unresponsive native readiness probe", async context => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const helper = new FakeHelperProcess([], 0, "", true);
    const source = new SystemAudioPcmSource({
        helperPath: "launchstack-system-audio",
        source: "system",
        spawn: fakeSpawn(helper, []),
    });
    const result = source.probeStatus();
    context.mock.timers.tick(7_000);
    assert.equal((await result).code, "status_timeout");
    assert.deepEqual(helper.killed, ["SIGTERM"]);
});

await test("SystemAudioPcmSource returns typed permission diagnostics", async () => {
    const statusProcess = new FakeHelperProcess(
        [
            new TextEncoder().encode(
                JSON.stringify({
                    system: {
                        supported: true,
                        authorized: false,
                        reason: "permission_denied",
                        message: "Screen capture permission is required",
                    },
                })
            ),
        ],
        0
    );
    const source = new SystemAudioPcmSource({
        helperPath: "launchstack-system-audio",
        source: "system",
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
    const statusProcess = new FakeHelperProcess([new TextEncoder().encode("{}")]);
    const captureProcess = new FakeHelperProcess([], 0, "", true);
    const calls: string[][] = [];
    const source = new SystemAudioPcmSource({
        helperPath: "launchstack-system-audio",
        source: "system",
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
            error.message.includes("system permissions")
    );
    assert.equal(captureProcess.started, false);
});

await test("SystemAudioPcmSource cancels the capture child without retaining a process", async () => {
    const statusProcess = new FakeHelperProcess([readyStatus()]);
    const captureProcess = new FakeHelperProcess([], 0, "", true);
    const calls: string[][] = [];
    const source = new SystemAudioPcmSource({
        helperPath: "launchstack-system-audio",
        source: "system",
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
});

await test("SystemAudioPcmSource reports capture child failures", async () => {
    const statusProcess = new FakeHelperProcess([readyStatus()]);
    const captureProcess = new FakeHelperProcess([], 9, "capture failed\n");
    const source = new SystemAudioPcmSource({
        helperPath: "launchstack-system-audio",
        source: "system",
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
    const statusProcess = new FakeHelperProcess([readyStatus()]);
    const captureProcess = new FakeHelperProcess([]);
    const source = new SystemAudioPcmSource({
        helperPath: "launchstack-system-audio",
        source: "system",
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

await test("microphone helper uses its own readiness and the same PCM framing and EOF semantics", async () => {
    const status = new FakeHelperProcess([
        new TextEncoder().encode(
            JSON.stringify({
                microphone: {
                    supported: true,
                    authorized: true,
                    reason: "ready",
                    message: "Microphone ready",
                },
            })
        ),
    ]);
    const capture = new FakeHelperProcess([
        new Uint8Array([1]),
        new Uint8Array([2, 3, 4, 5, 6]),
        new Uint8Array([7, 8, 9, 10]),
    ]);
    const calls: string[][] = [];
    const source = new SystemAudioPcmSource({
        helperPath: "launchstack-system-audio",
        source: "microphone",
        sampleRate: 1_000,
        frameSamples: 2,
        clock: () => new Date(FIXED_START),
        spawn: fakeSystemSpawn(status, capture, calls),
    });
    const frames: PcmFrame[] = [];
    await assert.rejects(async () => {
        for await (const frame of source.frames(new AbortController().signal)) frames.push(frame);
    }, /microphone audio helper stopped unexpectedly/);
    assert.deepEqual(
        frames.map(frame => [...frame.pcm]),
        [
            [1, 2, 3, 4],
            [5, 6, 7, 8],
            [9, 10],
        ]
    );
    assert.deepEqual(
        frames.map(frame => frame.capturedAt.toISOString()),
        [
            FIXED_START.toISOString(),
            new Date(FIXED_START.getTime() + 2).toISOString(),
            new Date(FIXED_START.getTime() + 4).toISOString(),
        ]
    );
});
