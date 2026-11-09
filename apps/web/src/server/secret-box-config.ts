import type { SecretBoxConfig } from "@launchstack/store/crypto";

/** Parse only this encryption configuration; failures never echo key material. */
export function parseSecretBoxConfiguration(input: {
    key?: string;
    currentVersion?: string;
    previousKeys?: string;
}): SecretBoxConfig {
    const version = input.currentVersion?.trim() ? Number(input.currentVersion) : 1;
    if (!Number.isInteger(version) || version < 1 || version > 255)
        throw new Error("SECRET_BOX_CURRENT_VERSION must be an integer from 1 to 255");
    let raw: unknown;
    try {
        raw = input.previousKeys?.trim() ? JSON.parse(input.previousKeys) : {};
    } catch {
        throw new Error("SECRET_BOX_PREVIOUS_KEYS must be a JSON object of versioned keys");
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new Error("SECRET_BOX_PREVIOUS_KEYS must be a JSON object of versioned keys");
    const previousKeys: Record<number, string> = {};
    for (const [label, key] of Object.entries(raw)) {
        const id = Number(label);
        if (
            !/^[1-9]\d*$/.test(label) ||
            !Number.isInteger(id) ||
            id > 255 ||
            id === version ||
            typeof key !== "string" ||
            !/^[A-Za-z0-9+/]{43}=$/.test(key) ||
            Buffer.from(key, "base64").length !== 32 ||
            Buffer.from(key, "base64").toString("base64") !== key
        )
            throw new Error("SECRET_BOX_PREVIOUS_KEYS contains an invalid versioned key");
        previousKeys[id] = key;
    }
    if (
        input.key &&
        (!/^[A-Za-z0-9+/]{43}=$/.test(input.key) ||
            Buffer.from(input.key, "base64").length !== 32 ||
            Buffer.from(input.key, "base64").toString("base64") !== input.key)
    )
        throw new Error("The active encryption key must encode exactly 32 bytes");
    if (version !== 1 && !input.key)
        throw new Error("An active encryption key is required when selecting a key version");
    return { key: input.key, currentVersion: version, previousKeys };
}
