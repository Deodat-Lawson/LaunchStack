import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const HKDF_SALT = "pdr-ai-api-key-encryption";

let _cachedKey: Buffer | null = null;

/**
 * Derive a 32-byte AES key from the existing CLERK_SECRET_KEY using HKDF.
 * No extra env var needed — the Clerk secret is already required.
 */
function getEncryptionKey(): Buffer {
    if (_cachedKey) return _cachedKey;

    const secret = process.env.CLERK_SECRET_KEY;
    if (!secret) {
        throw new Error("CLERK_SECRET_KEY is required for API key encryption.");
    }

    _cachedKey = Buffer.from(
        crypto.hkdfSync("sha256", secret, HKDF_SALT, "api-key-encryption", 32),
    );

    return _cachedKey;
}

export interface EncryptedKey {
    ciphertext: string;
    iv: string;
    tag: string;
}

export function encryptApiKey(plaintext: string): EncryptedKey {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();

    return {
        ciphertext: encrypted,
        iv: iv.toString("hex"),
        tag: tag.toString("hex"),
    };
}

export function decryptApiKey(ciphertext: string, iv: string, tag: string): string {
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(
        ALGORITHM,
        key,
        Buffer.from(iv, "hex")
    );
    decipher.setAuthTag(Buffer.from(tag, "hex"));

    let decrypted = decipher.update(ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}

export function maskApiKey(plaintext: string): string {
    if (plaintext.length <= 8) return "****";
    return `${plaintext.slice(0, 3)}...${plaintext.slice(-4)}`;
}
