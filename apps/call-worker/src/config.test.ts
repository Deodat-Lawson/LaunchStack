import assert from "node:assert/strict";
import { test } from "node:test";

import { CallWorkerConfigError, loadCallWorkerConfig } from "./config";

const REQUIRED = {
    origin: "https://launchstack.example/",
    deviceToken: `lsc_${"a".repeat(43)}`,
    appVersion: "1.2.3",
    systemAudioHelperPath:
        "/Applications/LaunchStack Capture.app/Contents/Helpers/launchstack-system-audio",
};

await test("stdin configuration validates the first JSON line and applies tuning defaults", () => {
    const config = loadCallWorkerConfig(JSON.stringify(REQUIRED));
    assert.equal(config.origin, "https://launchstack.example");
    assert.equal(config.deviceToken, REQUIRED.deviceToken);
    assert.equal(config.autoEnrich, false);
    assert.equal(config.silenceTimeoutMs, 240_000);
    assert.equal(config.audioFrameMs, 20);
    assert.equal(config.vadThreshold, 0.015);
    assert.equal(config.vadActivationFrames, 3);
    assert.equal(config.vadReleaseFrames, 15);
    assert.equal(config.utteranceMaxMs, 3_000);
    assert.equal(config.audioPreRollMs, 200);
    assert.equal(config.audioReadyTimeoutMs, 10_000);
    assert.equal(config.stopDrainTimeoutMs, 30_000);
    assert.equal(config.transcriptionTimeoutMs, 20_000);
});

await test("stdin configuration accepts explicit language and tuning without environment configuration", () => {
    const config = loadCallWorkerConfig(
        JSON.stringify({
            ...REQUIRED,
            language: "en-US",
            autoEnrich: true,
            silenceTimeoutMs: 1_000,
            audioFrameMs: 10,
            vadThreshold: 0.1,
            utteranceMaxMs: 5_000,
        })
    );
    assert.equal(config.language, "en-US");
    assert.equal(config.autoEnrich, true);
    assert.equal(config.silenceTimeoutMs, 1_000);
    assert.equal(config.audioFrameMs, 10);
    assert.equal(config.vadThreshold, 0.1);
    assert.equal(config.utteranceMaxMs, 5_000);
});

await test("stdin configuration rejects missing, malformed, obsolete and invalid settings without leaking secrets", () => {
    for (const line of [
        "",
        "{",
        "{}",
        "null",
        "[]",
        JSON.stringify({ ...REQUIRED, origin: "https://host/path" }),
        JSON.stringify({ ...REQUIRED, deviceToken: "" }),
        JSON.stringify({ ...REQUIRED, appVersion: "latest" }),
        JSON.stringify({ ...REQUIRED, systemAudioHelperPath: "" }),
        JSON.stringify({ ...REQUIRED, silenceTimeoutMs: 0 }),
        JSON.stringify({ ...REQUIRED, vadThreshold: 1.1 }),
        JSON.stringify({ ...REQUIRED, audioFrameMs: 100, utteranceMaxMs: 10 }),
        JSON.stringify({ ...REQUIRED, utteranceMaxMs: 63_000 }),
        JSON.stringify({ ...REQUIRED, internalToken: "obsolete-secret" }),
    ]) {
        assert.throws(
            () => loadCallWorkerConfig(line),
            error => {
                assert.ok(error instanceof CallWorkerConfigError);
                assert.equal(error.exitCode, 64);
                assert.equal(error.message.includes(REQUIRED.deviceToken), false);
                assert.equal(error.message.includes("obsolete-secret"), false);
                return true;
            }
        );
    }
});
