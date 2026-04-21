import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * The master key (base64-encoded 32-byte random value) is injected by the
 * host at startup via configureSecretBox(). A process.env fallback is kept
 * for the transitional window where some callers (tests, migration scripts,
 * CLI tools) still expect to import this module without a configured
 * Engine. Remove the fallback once all such entry points route through
 * createEngine / configureSecretBox.
 */

let _keyBase64: string | null = null;

export interface SecretBoxConfig {
  /** EMBEDDING_SECRETS_KEY — base64-encoded 32-byte random value. */
  key: string | undefined;
}

export function configureSecretBox(config: SecretBoxConfig): void {
  _keyBase64 = config.key ?? null;
}

/**
 * AES-256-GCM envelope encryption for short secrets (API keys) stored in the
 * database. The output format is a single base64 string so it round-trips
 * cleanly through Postgres `text` columns without bytea handling.
 *
 * Layout of the binary payload (before base64):
 *   byte 0      : key version (currently always 1)
 *   bytes 1-12  : 12-byte random IV (nonce)
 *   bytes 13-28 : 16-byte GCM auth tag
 *   bytes 29+   : ciphertext
 *
 * Rotation story: bump `CURRENT_KEY_VERSION`, keep the old key available via
 * another env var, and add a case to `resolveKey()` so existing ciphertexts
 * can still decrypt. For now a single version is sufficient.
 */

const CURRENT_KEY_VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export class MissingSecretsKeyError extends Error {
  constructor() {
    super(
      "EMBEDDING_SECRETS_KEY is not configured. Required to encrypt per-company provider API keys. Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
    this.name = "MissingSecretsKeyError";
  }
}

export class CiphertextDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CiphertextDecodeError";
  }
}

function resolveKey(version: number): Buffer {
  if (version !== CURRENT_KEY_VERSION) {
    throw new CiphertextDecodeError(
      `Unknown encryption key version ${version}; expected ${CURRENT_KEY_VERSION}`,
    );
  }
  const raw = _keyBase64 ?? process.env.EMBEDDING_SECRETS_KEY;
  if (!raw) {
    throw new MissingSecretsKeyError();
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new CiphertextDecodeError(
      `EMBEDDING_SECRETS_KEY must decode to ${KEY_LENGTH} bytes (got ${key.length}). Ensure it is a base64-encoded 32-byte random value.`,
    );
  }
  return key;
}

/**
 * Encrypt a short secret. Returns the encoded ciphertext plus the key version
 * that was used — callers should persist both so future key rotations can
 * find the right key to decrypt each row.
 */
export function encryptSecret(plaintext: string): {
  ciphertext: string;
  keyVersion: number;
} {
  if (plaintext.length === 0) {
    throw new Error("Refusing to encrypt empty plaintext");
  }
  const key = resolveKey(CURRENT_KEY_VERSION);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([
    Buffer.from([CURRENT_KEY_VERSION]),
    iv,
    tag,
    encrypted,
  ]);
  return {
    ciphertext: payload.toString("base64"),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

/**
 * Decrypt a secret produced by `encryptSecret`. Throws if the payload is
 * malformed, the auth tag doesn't verify, or the key version is unknown.
 */
export function decryptSecret(ciphertext: string): string {
  const payload = Buffer.from(ciphertext, "base64");
  if (payload.length < 1 + IV_LENGTH + TAG_LENGTH + 1) {
    throw new CiphertextDecodeError("Ciphertext payload is too short");
  }
  const version = payload[0]!;
  const iv = payload.subarray(1, 1 + IV_LENGTH);
  const tag = payload.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
  const body = payload.subarray(1 + IV_LENGTH + TAG_LENGTH);
  const key = resolveKey(version);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    const decrypted = Buffer.concat([decipher.update(body), decipher.final()]);
    return decrypted.toString("utf8");
  } catch (err) {
    throw new CiphertextDecodeError(
      err instanceof Error
        ? `Failed to decrypt secret: ${err.message}`
        : "Failed to decrypt secret",
    );
  }
}

/**
 * Convenience helper: decrypts and then constant-time compares with a known
 * value. Not currently used by the embedding path but handy for webhook
 * signature checks etc. Included here so all crypto lives in one module.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
