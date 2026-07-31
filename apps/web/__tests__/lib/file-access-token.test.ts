import {
  signFileAccessToken,
  verifyFileAccessToken,
} from "@launchstack/core/crypto";

const SECRET = "test-file-access-secret";

describe("file access tokens", () => {
  it("verifies a freshly signed token for the same file", () => {
    const token = signFileAccessToken("123", SECRET);

    expect(token).not.toBeNull();
    expect(verifyFileAccessToken(token, "123", SECRET)).toBe(true);
  });

  it("rejects a token minted for a different file", () => {
    const token = signFileAccessToken("123", SECRET);

    expect(verifyFileAccessToken(token, "124", SECRET)).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signFileAccessToken("123", "other-secret");

    expect(verifyFileAccessToken(token, "123", SECRET)).toBe(false);
  });

  it("rejects a token past its expiry", () => {
    const now = Date.now();
    const token = signFileAccessToken("123", SECRET, { ttlMs: 1000, now });

    expect(verifyFileAccessToken(token, "123", SECRET, { now: now + 500 })).toBe(true);
    expect(verifyFileAccessToken(token, "123", SECRET, { now: now + 1001 })).toBe(false);
  });

  it("rejects a token whose expiry has been extended", () => {
    const now = Date.now();
    const token = signFileAccessToken("123", SECRET, { ttlMs: 1000, now })!;
    const mac = token.slice(token.indexOf(".") + 1);
    const extended = `${now + 60_000}.${mac}`;

    expect(verifyFileAccessToken(extended, "123", SECRET, { now })).toBe(false);
  });

  it("rejects malformed tokens", () => {
    for (const token of ["", "abc", "123", ".", "notanumber.deadbeef"]) {
      expect(verifyFileAccessToken(token, "123", SECRET)).toBe(false);
    }
  });

  it("fails closed when no secret is configured", () => {
    expect(signFileAccessToken("123", undefined)).toBeNull();
    expect(verifyFileAccessToken(signFileAccessToken("123", SECRET), "123", undefined)).toBe(false);
  });
});
