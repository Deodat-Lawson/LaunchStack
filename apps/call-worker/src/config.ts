export interface CallWorkerConfig {
    captureEnabled: boolean;
    webOrigin: string;
    internalToken: string;
    companyId: string;
    userId: string;
    ffmpegPath: string;
    audioInputFormat: string;
    audioInputDevice: string;
    systemAudioEnabled: boolean;
    systemAudioHelperPath: string;
    audioSampleRate: number;
    audioFrameMs: number;
    vadThreshold: number;
    vadActivationFrames: number;
    vadReleaseFrames: number;
    utteranceMaxMs: number;
    audioPreRollMs: number;
    audioReadyTimeoutMs: number;
    stopDrainTimeoutMs: number;
    transcriptionTimeoutMs: number;
    transcriptionProvider: "openai" | "azure_speech";
    transcriptionBaseUrl: string;
    transcriptionModel: string;
    transcriptionApiKey: string;
    transcriptionLanguage?: string;
    autoEnrich: boolean;
}

function raw(name: string): string | undefined {
    const value = process.env[name]?.trim();
    return value === "" ? undefined : value;
}

function required(name: string, enabled: boolean, fallback = ""): string {
    const value = raw(name);
    if (value) return value;
    if (!enabled) return fallback;
    throw new Error(`${name} is required when local capture is enabled`);
}

function boolean(name: string, enabled: boolean, fallback: boolean): boolean {
    const value = raw(name);
    if (value === undefined) {
        if (!enabled) return fallback;
        throw new Error(`${name} is required when local capture is enabled`);
    }
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error(`${name} must be exactly true or false`);
}

function transcriptionProvider(): "openai" | "azure_speech" {
    const value = raw("CALL_NOTES_TRANSCRIPTION_PROVIDER") ?? "openai";
    if (value === "openai" || value === "azure_speech") return value;
    throw new Error("CALL_NOTES_TRANSCRIPTION_PROVIDER must be openai or azure_speech");
}

function integer(
    name: string,
    enabled: boolean,
    fallback: number,
    predicate: (value: number) => boolean,
    description: string
): number {
    const value = raw(name);
    if (value === undefined) {
        if (!enabled) return fallback;
        throw new Error(`${name} is required when local capture is enabled`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || !predicate(parsed)) {
        throw new Error(`${name} must be a ${description}`);
    }
    return parsed;
}

function optionalInteger(
    name: string,
    _enabled: boolean,
    fallback: number,
    predicate: (value: number) => boolean,
    description: string
): number {
    const value = raw(name);
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || !predicate(parsed)) {
        throw new Error(`${name} must be a ${description}`);
    }
    return parsed;
}

function number(
    name: string,
    enabled: boolean,
    fallback: number,
    predicate: (value: number) => boolean,
    description: string
): number {
    const value = raw(name);
    if (value === undefined) {
        if (!enabled) return fallback;
        throw new Error(`${name} is required when local capture is enabled`);
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || !predicate(parsed)) {
        throw new Error(`${name} must be ${description}`);
    }
    return parsed;
}

function origin(name: string, enabled: boolean): string {
    const value = required(name, enabled);
    if (!value) return value;
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error(`${name} must be a valid HTTP(S) origin`);
    }
    if (
        (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash
    ) {
        throw new Error(`${name} must be a valid HTTP(S) origin`);
    }
    return parsed.origin;
}

function endpoint(name: string, enabled: boolean): string {
    const value = required(name, enabled);
    if (!value) return value;
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error(`${name} must be a valid HTTP(S) URL`);
    }
    if (
        (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
        parsed.username ||
        parsed.password
    ) {
        throw new Error(`${name} must be a valid HTTP(S) URL`);
    }
    return parsed.toString().replace(/\/$/, "");
}

export function loadCallWorkerConfig(): CallWorkerConfig {
    const captureEnabled = boolean("CALL_NOTES_CAPTURE_ENABLED", false, false);
    const systemAudioEnabled = boolean(
        "CALL_NOTES_SYSTEM_AUDIO_ENABLED",
        false,
        process.platform === "darwin"
    );
    const audioFrameMs = integer(
        "CALL_NOTES_AUDIO_FRAME_MS",
        captureEnabled,
        20,
        value => value > 0 && value <= 1_000,
        "positive integer no greater than 1000"
    );
    const audioSampleRate = integer(
        "CALL_NOTES_AUDIO_SAMPLE_RATE",
        captureEnabled,
        16_000,
        value => value >= 8_000 && value <= 192_000,
        "integer between 8000 and 192000"
    );
    const vadActivationFrames = integer(
        "CALL_NOTES_VAD_ACTIVATION_FRAMES",
        captureEnabled,
        3,
        value => value > 0 && value <= 10_000,
        "positive integer no greater than 10000"
    );
    const vadReleaseFrames = optionalInteger(
        "CALL_NOTES_VAD_RELEASE_FRAMES",
        captureEnabled,
        15,
        value => value > 0 && value <= 100_000,
        "positive integer no greater than 100000"
    );
    const audioPreRollMs = optionalInteger(
        "CALL_NOTES_AUDIO_PRE_ROLL_MS",
        captureEnabled,
        200,
        value => value >= 0 && value <= 60_000,
        "nonnegative integer no greater than 60000"
    );
    const audioReadyTimeoutMs = optionalInteger(
        "CALL_NOTES_AUDIO_READY_TIMEOUT_MS",
        captureEnabled,
        10_000,
        value => value > 0 && value <= 120_000,
        "positive integer no greater than 120000"
    );
    const stopDrainTimeoutMs = optionalInteger(
        "CALL_NOTES_STOP_DRAIN_TIMEOUT_MS",
        captureEnabled,
        30_000,
        value => value > 0 && value <= 300_000,
        "positive integer no greater than 300000"
    );
    const transcriptionTimeoutMs = optionalInteger(
        "CALL_NOTES_TRANSCRIPTION_TIMEOUT_MS",
        captureEnabled,
        20_000,
        value => value > 0 && value <= 300_000,
        "positive integer no greater than 300000"
    );
    const utteranceMaxMs = optionalInteger(
        "CALL_NOTES_UTTERANCE_MAX_MS",
        captureEnabled,
        3_000,
        value => value >= audioFrameMs && value <= 3_600_000,
        `an integer between ${audioFrameMs} and 3600000`
    );

    const language = raw("CALL_NOTES_TRANSCRIPTION_LANGUAGE");
    const configuredTranscriptionProvider = transcriptionProvider();
    const webOrigin = origin("CALL_NOTES_WEB_ORIGIN", captureEnabled);
    const internalToken = required("CALL_NOTES_INTERNAL_TOKEN", captureEnabled);
    const companyId = required("CALL_NOTES_LOCAL_COMPANY_ID", captureEnabled);
    const userId = required("CALL_NOTES_LOCAL_USER_ID", captureEnabled);
    if (captureEnabled && !/^\d+$/.test(companyId)) {
        throw new Error("CALL_NOTES_LOCAL_COMPANY_ID must contain only digits");
    }
    if (captureEnabled && userId.length > 256) {
        throw new Error("CALL_NOTES_LOCAL_USER_ID must be at most 256 characters");
    }
    const ffmpegPath = required("CALL_NOTES_FFMPEG_PATH", captureEnabled, "ffmpeg");
    const audioInputFormat = required("CALL_NOTES_AUDIO_INPUT_FORMAT", captureEnabled);
    const audioInputDevice = required("CALL_NOTES_AUDIO_INPUT_DEVICE", captureEnabled);
    const systemAudioHelperPath = required(
        "CALL_NOTES_SYSTEM_AUDIO_HELPER_PATH",
        captureEnabled && systemAudioEnabled
    );
    return {
        captureEnabled,
        webOrigin,
        internalToken,
        companyId,
        userId,
        ffmpegPath,
        audioInputFormat,
        audioInputDevice,
        systemAudioEnabled,
        systemAudioHelperPath,
        audioSampleRate,
        audioFrameMs,
        vadThreshold: number(
            "CALL_NOTES_VAD_THRESHOLD",
            captureEnabled,
            0.015,
            value => value >= 0 && value <= 1,
            "a finite number between 0 and 1"
        ),
        vadActivationFrames,
        vadReleaseFrames,
        utteranceMaxMs,
        audioPreRollMs,
        audioReadyTimeoutMs,
        stopDrainTimeoutMs,
        transcriptionTimeoutMs,
        transcriptionProvider: configuredTranscriptionProvider,
        transcriptionBaseUrl: endpoint("CALL_NOTES_TRANSCRIPTION_BASE_URL", captureEnabled),
        transcriptionModel: required(
            "CALL_NOTES_TRANSCRIPTION_MODEL",
            captureEnabled && configuredTranscriptionProvider === "openai"
        ),
        transcriptionApiKey: required("CALL_NOTES_TRANSCRIPTION_API_KEY", captureEnabled),
        ...(language ? { transcriptionLanguage: language } : {}),
        autoEnrich: boolean("CALL_NOTES_AUTO_ENRICH", false, false),
    };
}
