import assert from "node:assert/strict";
import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";

// Native ESM integration with the installed auth runtime; no database, HTTP server or network.
const [primary, local, loopback] = JSON.parse(process.argv[2]);
const database = { user: [], account: [], session: [], verification: [] };
const authForOrigin = origin =>
    betterAuth({
        baseURL: origin,
        secret: "synthetic-auth-origin-test-secret-at-least-32-characters",
        database: memoryAdapter(database),
        emailAndPassword: { enabled: true },
        advanced: { disableCSRFCheck: false, disableOriginCheck: false },
        telemetry: { enabled: false },
        logger: { disabled: true },
    });
const request = (origin, route, body) =>
    new Request(`${origin}/api/auth/${route}`, {
        method: "POST",
        headers: { host: new URL(origin).host, origin, "content-type": "application/json" },
        body: JSON.stringify(body),
    });
const credentials = { email: "vantage@example.invalid", password: "test-password-123" };
assert.equal(
    (
        await authForOrigin(local).handler(
            request(local, "sign-up/email", {
                ...credentials,
                name: "Synthetic Vantage",
            })
        )
    ).status,
    200
);
for (const origin of [local, loopback, primary]) {
    const auth = authForOrigin(origin);
    const signedIn = await auth.handler(request(origin, "sign-in/email", credentials));
    assert.equal(signedIn.status, 200);
    const cookie = signedIn.headers.getSetCookie().find(value => value.includes("session_token="));
    assert(cookie);
    assert(!/;\s*domain=/i.test(cookie));
    assert.equal(/;\s*secure(?:;|$)/i.test(cookie), origin === primary);
    const session = await auth.handler(
        new Request(`${origin}/api/auth/get-session`, {
            headers: { host: new URL(origin).host, cookie: cookie.split(";")[0] },
        })
    );
    assert.equal(session.status, 200);
    assert.equal((await session.json()).user.email, credentials.email);
}
const denied = await authForOrigin(local).handler(
    new Request(`${local}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
            host: new URL(local).host,
            origin: "https://unlisted.example.com",
            "content-type": "application/json",
        },
        body: JSON.stringify(credentials),
    })
);
assert.equal(denied.status, 403);
console.log(JSON.stringify({ origins: 3, sessions: 3, unknownOriginRejected: true }));
