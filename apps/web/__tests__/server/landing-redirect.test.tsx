/**
 * Links to the public site (apps/landing) resolve at request time.
 *
 * The app image is built once in CI, so a landing origin inlined into the
 * client bundle is the build machine's, not the deployment's. That is how the
 * sign-in logo came to point at https://launchstack.app (down) while the real
 * site was https://home.launchstack-internal.com. Product surfaces therefore
 * link to /site/..., which redirects using LANDING_PUBLIC_URL as the server
 * sees it on each request.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import { GET as site } from "~/app/site/[[...path]]/route";
import { GET as privacy } from "~/app/privacy/route";
import { GET as terms } from "~/app/terms/route";
import { LogoLink } from "~/components/LogoLink";
import { LANDING_URL } from "~/config/landing";
import { redirectToLanding } from "~/server/landing-redirect";

const ORIGINAL = process.env.LANDING_PUBLIC_URL;

afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.LANDING_PUBLIC_URL;
    else process.env.LANDING_PUBLIC_URL = ORIGINAL;
});

function visit(pathAndQuery: string) {
    const url = new URL(pathAndQuery, "https://app.example.com");
    const segments = url.pathname.split("/").slice(2).filter(Boolean).map(decodeURIComponent);
    return site(new Request(url), {
        params: Promise.resolve(segments.length ? { path: segments } : {}),
    });
}

describe("/site", () => {
    beforeEach(() => {
        process.env.LANDING_PUBLIC_URL = "https://home.example.com";
    });

    it("sends the logo to the landing home page", async () => {
        const response = await visit("/site");

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe("https://home.example.com/");
    });

    it("keeps the page and the query string", async () => {
        expect((await visit("/site/contact")).headers.get("location")).toBe(
            "https://home.example.com/contact"
        );
        expect((await visit("/site/deployment?section=uploadthing")).headers.get("location")).toBe(
            "https://home.example.com/deployment?section=uploadthing"
        );
    });

    it("reads the landing origin per request, not at build or import time", async () => {
        process.env.LANDING_PUBLIC_URL = "https://home.other.test";

        expect((await visit("/site")).headers.get("location")).toBe("https://home.other.test/");
    });

    it("tolerates a trailing slash and keeps a path prefix on the origin", async () => {
        process.env.LANDING_PUBLIC_URL = "https://example.com/marketing/";

        expect((await visit("/site/contact")).headers.get("location")).toBe(
            "https://example.com/marketing/contact"
        );
    });

    it("treats a blank variable as unset", async () => {
        // Compose passes `${LANDING_PUBLIC_URL:-}` through as "".
        process.env.LANDING_PUBLIC_URL = "  ";

        const location = (await visit("/site")).headers.get("location");
        expect(location).toBe(new URL("/", LANDING_URL).href);
    });

    it("never leaves the landing host, whatever the path", async () => {
        for (const sneaky of [
            "/site/%2F%2Fevil.example",
            "/site/..%2F..%2Fx",
            "/site/@evil.example",
        ]) {
            const location = (await visit(sneaky)).headers.get("location")!;
            expect(new URL(location).host).toBe("home.example.com");
        }
        // Below the route's per-segment encoding: the helper alone must hold too.
        const bare = redirectToLanding("//evil.example").headers.get("location")!;
        expect(new URL(bare).host).toBe("home.example.com");
    });
});

describe("/privacy and /terms", () => {
    it("still redirect to the landing pages", () => {
        process.env.LANDING_PUBLIC_URL = "https://home.example.com";

        expect(privacy().headers.get("location")).toBe("https://home.example.com/privacy");
        expect(terms().headers.get("location")).toBe("https://home.example.com/terms");
    });
});

describe("the brand logo", () => {
    it("links a signed-out visitor to /site, never to a landing origin", () => {
        const html = renderToStaticMarkup(<LogoLink signedIn={false}>Launchstack</LogoLink>);

        expect(html).toContain('href="/site"');
    });
});

describe("LANDING_URL stays on the server", () => {
    // Any component that reads it gets the build machine's value baked into the
    // bundle. Only the redirect helper may use it, as its fallback.
    const SRC = join(__dirname, "../../src");
    const ALLOWED = new Set(["config/landing.ts", "server/landing-redirect.ts"]);

    function files(dir: string): string[] {
        return readdirSync(dir).flatMap(name => {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) return files(path);
            return /\.(ts|tsx)$/.test(name) ? [path] : [];
        });
    }

    it("is referenced only by the redirect helper", () => {
        const offenders = files(SRC)
            .filter(path => !ALLOWED.has(relative(SRC, path)))
            .filter(path => /\bLANDING_URL\b/.test(readFileSync(path, "utf8")))
            .map(path => relative(SRC, path));

        expect(offenders).toEqual([]);
    });
});
