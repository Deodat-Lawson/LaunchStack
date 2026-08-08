import {
  UnsubscribeSecretMissingError,
  createUnsubscribeToken,
  verifyUnsubscribeToken,
} from "@launchstack/features/email-pipeline";

/**
 * The unsubscribe link is the one URL in this system handed to strangers, and
 * it mutates a suppression list. These tests pin the property that makes it
 * safe to publish: only a token WE signed can suppress an address, and it can
 * only ever suppress the address written inside it.
 */

const env = { EMAIL_UNSUBSCRIBE_SECRET: "test-secret-value-long-enough" };
const other = { EMAIL_UNSUBSCRIBE_SECRET: "a-completely-different-secret" };

describe("unsubscribe tokens", () => {
  it("round-trips the company and address it was issued for", () => {
    const token = createUnsubscribeToken(
      { companyId: 42, email: "Person@Example.com" },
      env,
    );

    expect(verifyUnsubscribeToken(token, env)).toEqual({
      companyId: 42,
      // Lower-cased at mint time so it matches what the suppression list stores.
      email: "person@example.com",
    });
  });

  it("rejects a token signed with a different secret", () => {
    const token = createUnsubscribeToken(
      { companyId: 42, email: "person@example.com" },
      other,
    );

    expect(verifyUnsubscribeToken(token, env)).toBeNull();
  });

  it("rejects a token whose company was edited", () => {
    const token = createUnsubscribeToken(
      { companyId: 42, email: "person@example.com" },
      env,
    );
    const [version, , email, signature] = token.split(".");

    // The attack the signature exists to stop: point a valid-looking link at
    // someone else's workspace.
    const forged = [version, "99", email, signature].join(".");
    expect(verifyUnsubscribeToken(forged, env)).toBeNull();
  });

  it("rejects a token whose address was edited", () => {
    const token = createUnsubscribeToken(
      { companyId: 42, email: "person@example.com" },
      env,
    );
    const [version, companyId, , signature] = token.split(".");

    const victim = Buffer.from("someone-else@example.com").toString("base64url");
    const forged = [version, companyId, victim, signature].join(".");
    expect(verifyUnsubscribeToken(forged, env)).toBeNull();
  });

  it("rejects unsigned, truncated and malformed tokens", () => {
    for (const bad of [
      "",
      "garbage",
      "v1.42.cGVyc29uQGV4YW1wbGUuY29t", // no signature
      "v1.42.cGVyc29uQGV4YW1wbGUuY29t.", // empty signature
      "v2.42.cGVyc29uQGV4YW1wbGUuY29t.abc", // unknown version
    ]) {
      expect(verifyUnsubscribeToken(bad, env)).toBeNull();
    }
  });

  it("refuses to mint or verify without a configured secret", () => {
    expect(() => createUnsubscribeToken({ companyId: 1, email: "a@b.c" }, {})).toThrow(
      UnsubscribeSecretMissingError,
    );
    expect(() => verifyUnsubscribeToken("v1.1.YUBiLmM.sig", {})).toThrow(
      UnsubscribeSecretMissingError,
    );
  });
});
