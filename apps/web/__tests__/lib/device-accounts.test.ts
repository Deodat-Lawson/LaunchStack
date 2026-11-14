/**
 * The account limit as the server reads it from cookie names: the same
 * count the multi-session plugin uses when it decides whether a new sign-in
 * is remembered. At the limit, adding an account must be refused up front,
 * or the new sign-in becomes active without being remembered and switching
 * away from it signs it out.
 */
import {
    deviceAccountCount,
    isAtAccountLimit,
    isAddAccountMode,
    MAX_DEVICE_ACCOUNTS,
    withAddAccount,
} from "~/lib/auth/device-accounts";

const multi = (token: string, prefix = "") => ({
    name: `${prefix}better-auth.session_token_multi-${token.toLowerCase()}`,
    value: `${token}.sig%3D`,
});
const active = (token: string, prefix = "") => ({
    name: `${prefix}better-auth.session_token`,
    value: `${token}.c2lnbmF0dXJl%3D`,
});
const tokens = (n: number) => Array.from({ length: n }, (_, i) => `Tok${i}AbC`);

describe("deviceAccountCount", () => {
    it("is zero with no session cookies", () => {
        expect(deviceAccountCount([{ name: "pdr_active_company", value: "50" }])).toBe(0);
    });

    it("counts one per remembered account, the active one included", () => {
        const [a, b] = tokens(2);
        expect(deviceAccountCount([active(a!), multi(a!), multi(b!)])).toBe(2);
    });

    it("counts an active session that isn't remembered yet (it will be, before an add)", () => {
        const [a, b] = tokens(2);
        expect(deviceAccountCount([active(a!), multi(b!)])).toBe(2);
    });

    it("matches the token case-insensitively, as the plugin names the cookie", () => {
        expect(deviceAccountCount([active("MiXeD"), multi("mixed")])).toBe(1);
    });

    it("reads the __Secure- names an HTTPS deployment uses", () => {
        const [a, b] = tokens(2);
        expect(
            deviceAccountCount([
                active(a!, "__Secure-"),
                multi(a!, "__Secure-"),
                multi(b!, "__Secure-"),
            ])
        ).toBe(2);
    });
});

describe("isAtAccountLimit", () => {
    it(`is false below ${MAX_DEVICE_ACCOUNTS} accounts`, () => {
        const ts = tokens(MAX_DEVICE_ACCOUNTS - 1);
        expect(isAtAccountLimit([active(ts[0]!), ...ts.map(t => multi(t))])).toBe(false);
    });

    it(`is true at ${MAX_DEVICE_ACCOUNTS} remembered accounts`, () => {
        const ts = tokens(MAX_DEVICE_ACCOUNTS);
        expect(isAtAccountLimit([active(ts[0]!), ...ts.map(t => multi(t))])).toBe(true);
    });

    it("is true when an unremembered active session would make it the limit", () => {
        const ts = tokens(MAX_DEVICE_ACCOUNTS);
        // Four remembered plus an active one that isn't: remembering it fills the browser.
        expect(isAtAccountLimit([active(ts[0]!), ...ts.slice(1).map(t => multi(t))])).toBe(true);
    });
});

describe("the add-account flag", () => {
    it("is add=1 and nothing else", () => {
        expect(isAddAccountMode(new URLSearchParams("add=1"))).toBe(true);
        expect(isAddAccountMode(new URLSearchParams("add=true"))).toBe(false);
        expect(isAddAccountMode(new URLSearchParams(""))).toBe(false);
    });

    it("joins an existing query", () => {
        expect(withAddAccount("/signin")).toBe("/signin?add=1");
        expect(withAddAccount("/signup?next=%2Fx")).toBe("/signup?next=%2Fx&add=1");
    });
});
