/**
 * Which sign-in providers a deployment offers, read from its environment:
 * the one list the auth instance registers and the pages draw buttons for.
 */
import {
    enabledSocialProviders,
    microsoftSignInConfig,
    oidcSignInConfig,
} from "~/server/auth/providers";

const KEYS = [
    "AUTH_GOOGLE_CLIENT_ID",
    "AUTH_GOOGLE_CLIENT_SECRET",
    "AUTH_GITHUB_CLIENT_ID",
    "AUTH_GITHUB_CLIENT_SECRET",
    "AUTH_MICROSOFT_CLIENT_ID",
    "AUTH_MICROSOFT_CLIENT_SECRET",
    "AUTH_MICROSOFT_TENANT_ID",
    "AUTH_MICROSOFT_AUTHORITY",
    "AUTH_OIDC_ISSUER",
    "AUTH_OIDC_CLIENT_ID",
    "AUTH_OIDC_CLIENT_SECRET",
    "AUTH_OIDC_NAME",
] as const;

const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

beforeEach(() => {
    for (const key of KEYS) {
        saved[key] = process.env[key];
        delete process.env[key];
    }
});

afterEach(() => {
    for (const key of KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    }
});

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
    Object.assign(process.env, values);
}

describe("enabledSocialProviders", () => {
    it("offers nothing without credentials", () => {
        expect(enabledSocialProviders()).toEqual([]);
    });

    it("offers a provider only when both halves are set", () => {
        setEnv({ AUTH_MICROSOFT_CLIENT_ID: "id", AUTH_OIDC_CLIENT_SECRET: "secret" });
        expect(enabledSocialProviders()).toEqual([]);
    });

    it("lists every configured provider, the deployment's own first, with names", () => {
        setEnv({
            AUTH_GOOGLE_CLIENT_ID: "g",
            AUTH_GOOGLE_CLIENT_SECRET: "g",
            AUTH_GITHUB_CLIENT_ID: "gh",
            AUTH_GITHUB_CLIENT_SECRET: "gh",
            AUTH_MICROSOFT_CLIENT_ID: "ms",
            AUTH_MICROSOFT_CLIENT_SECRET: "ms",
            AUTH_OIDC_ISSUER: "https://id.example.com/realms/acme",
            AUTH_OIDC_CLIENT_ID: "oidc",
            AUTH_OIDC_CLIENT_SECRET: "oidc",
            AUTH_OIDC_NAME: "Acme SSO",
        });
        expect(enabledSocialProviders()).toEqual([
            { id: "oidc", name: "Acme SSO" },
            { id: "google", name: "Google" },
            { id: "microsoft", name: "Microsoft" },
            { id: "github", name: "GitHub" },
        ]);
    });
});

describe("microsoftSignInConfig", () => {
    it("takes any Microsoft account on the public cloud by default", () => {
        setEnv({ AUTH_MICROSOFT_CLIENT_ID: "ms-id", AUTH_MICROSOFT_CLIENT_SECRET: "ms-secret" });
        expect(microsoftSignInConfig()).toEqual({
            clientId: "ms-id",
            clientSecret: "ms-secret",
            tenantId: "common",
            authority: "https://login.microsoftonline.com",
        });
    });

    it("narrows the tenant and moves to a national cloud when asked", () => {
        setEnv({
            AUTH_MICROSOFT_CLIENT_ID: "ms-id",
            AUTH_MICROSOFT_CLIENT_SECRET: "ms-secret",
            AUTH_MICROSOFT_TENANT_ID: " organizations ",
            AUTH_MICROSOFT_AUTHORITY: "https://login.chinacloudapi.cn/",
        });
        expect(microsoftSignInConfig()).toMatchObject({
            tenantId: "organizations",
            authority: "https://login.chinacloudapi.cn",
        });
    });

    it("ignores an authority that isn't a web address", () => {
        setEnv({
            AUTH_MICROSOFT_CLIENT_ID: "ms-id",
            AUTH_MICROSOFT_CLIENT_SECRET: "ms-secret",
            AUTH_MICROSOFT_AUTHORITY: "login.microsoftonline.com",
        });
        expect(microsoftSignInConfig()?.authority).toBe("https://login.microsoftonline.com");
    });
});

describe("oidcSignInConfig", () => {
    const credentials = { AUTH_OIDC_CLIENT_ID: "client", AUTH_OIDC_CLIENT_SECRET: "secret" };

    it("finds the discovery document under the issuer", () => {
        setEnv({ ...credentials, AUTH_OIDC_ISSUER: "https://id.example.com/realms/acme/" });
        expect(oidcSignInConfig()).toEqual({
            clientId: "client",
            clientSecret: "secret",
            discoveryUrl: "https://id.example.com/realms/acme/.well-known/openid-configuration",
            name: "SSO",
        });
    });

    it("accepts the discovery URL itself", () => {
        setEnv({
            ...credentials,
            AUTH_OIDC_ISSUER: "https://acme.okta.com/.well-known/openid-configuration",
        });
        expect(oidcSignInConfig()?.discoveryUrl).toBe(
            "https://acme.okta.com/.well-known/openid-configuration"
        );
    });

    it("is off without a usable issuer", () => {
        setEnv({ ...credentials });
        expect(oidcSignInConfig()).toBeNull();
        setEnv({ AUTH_OIDC_ISSUER: "id.example.com" });
        expect(oidcSignInConfig()).toBeNull();
        setEnv({ AUTH_OIDC_ISSUER: "ftp://id.example.com" });
        expect(oidcSignInConfig()).toBeNull();
    });

    it("tidies and bounds the button's name", () => {
        setEnv({
            ...credentials,
            AUTH_OIDC_ISSUER: "https://id.example.com",
            AUTH_OIDC_NAME: `  Acme \n ${"x".repeat(60)}`,
        });
        const name = oidcSignInConfig()!.name;
        expect(name.startsWith("Acme x")).toBe(true);
        expect(name.length).toBe(40);
        setEnv({ AUTH_OIDC_NAME: "   " });
        expect(oidcSignInConfig()!.name).toBe("SSO");
    });
});
