import {
  encryptSecret,
  decryptSecret,
  MissingSecretsKeyError,
  CiphertextDecodeError,
} from "~/lib/crypto/secret-box";

function setKey() {
  // Deterministic 32-byte key for tests — never use in production.
  process.env.EMBEDDING_SECRETS_KEY = Buffer.alloc(32, 7).toString("base64");
}

describe("secret-box", () => {
  const originalKey = process.env.EMBEDDING_SECRETS_KEY;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.EMBEDDING_SECRETS_KEY;
    } else {
      process.env.EMBEDDING_SECRETS_KEY = originalKey;
    }
  });

  it("round-trips a typical API key", () => {
    setKey();
    const plaintext = "sk-test-" + "a".repeat(40);
    const { ciphertext, keyVersion } = encryptSecret(plaintext);
    expect(keyVersion).toBe(1);
    expect(ciphertext).not.toContain(plaintext);
    expect(decryptSecret(ciphertext)).toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext (fresh IV)", () => {
    setKey();
    const plaintext = "repeatable-key";
    const a = encryptSecret(plaintext).ciphertext;
    const b = encryptSecret(plaintext).ciphertext;
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(plaintext);
    expect(decryptSecret(b)).toBe(plaintext);
  });

  it("refuses to encrypt empty plaintext", () => {
    setKey();
    expect(() => encryptSecret("")).toThrow(/empty/i);
  });

  it("throws MissingSecretsKeyError when env key is absent", () => {
    delete process.env.EMBEDDING_SECRETS_KEY;
    expect(() => encryptSecret("anything")).toThrow(MissingSecretsKeyError);
  });

  it("rejects tampered ciphertext", () => {
    setKey();
    const { ciphertext } = encryptSecret("protected-value");
    // Flip a byte in the middle of the payload.
    const bytes = Buffer.from(ciphertext, "base64");
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    const tampered = bytes.toString("base64");
    expect(() => decryptSecret(tampered)).toThrow(CiphertextDecodeError);
  });

  it("rejects payload that decodes to too few bytes", () => {
    setKey();
    expect(() => decryptSecret("dG9vc2hvcnQ=")).toThrow(CiphertextDecodeError);
  });
});
