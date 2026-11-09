/** Opaque local-demo storage retained across native regeneration; never used as evidence. */
const KEY = "vantageContextDemoV1";
const SCHEMA = "encrypted-vantage-context-demo/v1";

export function generationModelMetadataV1(
    generated: Record<string, unknown>,
    previous: Record<string, unknown> | null | undefined
): Record<string, unknown> {
    const result = { ...generated };
    // Generation output cannot introduce or replace the independently reviewed sidecar.
    delete result[KEY];
    const candidate = previous?.[KEY];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return result;
    const value = candidate as Record<string, unknown>;
    if (
        value.schemaVersion !== SCHEMA ||
        !Number.isSafeInteger(value.version) ||
        Number(value.version) <= 0 ||
        value.keyVersion !== 1 ||
        typeof value.ciphertext !== "string" ||
        value.ciphertext.length > 1050000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(value.ciphertext)
    )
        return result;
    const encoded = Buffer.from(value.ciphertext, "base64");
    if (encoded.length < 30 || encoded[0] !== 1 || encoded.toString("base64") !== value.ciphertext)
        return result;
    // Whitelist the envelope fields only. No old provider metadata, plaintext or
    // arbitrary caller properties cross the native generation boundary.
    result[KEY] = {
        schemaVersion: SCHEMA,
        version: value.version,
        keyVersion: 1,
        ciphertext: value.ciphertext,
    };
    return result;
}
