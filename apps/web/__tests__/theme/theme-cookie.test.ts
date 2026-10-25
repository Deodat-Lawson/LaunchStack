/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://app.example.co.uk/"}
 */

/**
 * The theme cookie both apps share (packages/design-tokens/theme.ts).
 *
 * The landing site and the app are separate origins, so the cookie has to
 * land on the domain they share, or a theme picked on one never reaches the
 * other. jsdom's cookie jar refuses public suffixes the way a browser does,
 * so this page runs on a host under one (`co.uk`) to prove the probe skips
 * it and settles on the registrable domain.
 */

import {
    THEME_BOOT_SCRIPT,
    cookieDomainCandidates,
    formatThemeChoice,
    parseThemeChoice,
    readThemeChoice,
    writeThemeChoice,
} from "@launchstack/design-tokens/theme";

const cookieProp = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;

/** Every cookie string written while `run` runs, in order. */
function recordWrites(run: () => void): string[] {
    const writes: string[] = [];
    Object.defineProperty(document, "cookie", {
        configurable: true,
        get: () => cookieProp.get!.call(document) as string,
        set: (value: string) => {
            writes.push(value);
            cookieProp.set!.call(document, value);
        },
    });
    try {
        run();
    } finally {
        delete (document as { cookie?: string }).cookie;
    }
    return writes;
}

function clearCookies() {
    for (const domain of ["", "; Domain=example.co.uk", "; Domain=app.example.co.uk"]) {
        document.cookie = `ls-theme=; Path=/; Max-Age=0${domain}`;
    }
}

beforeEach(() => {
    clearCookies();
    localStorage.clear();
});

describe("parseThemeChoice", () => {
    it("reads the theme and when it was chosen", () => {
        expect(parseThemeChoice("a=1; ls-theme=light.1700000000000; b=2")).toEqual({
            theme: "light",
            at: 1700000000000,
        });
    });

    it("ignores values that are not a theme and a time", () => {
        expect(parseThemeChoice("ls-theme=blue.1")).toBeNull();
        expect(parseThemeChoice("ls-theme=dark")).toBeNull();
        expect(parseThemeChoice("ls-theme=dark.soon")).toBeNull();
        expect(parseThemeChoice("other-ls-theme=dark.1")).toBeNull();
        expect(parseThemeChoice("")).toBeNull();
    });

    it("takes the newer of two copies", () => {
        // A host-only copy from before the shared one existed.
        expect(parseThemeChoice("ls-theme=dark.5; ls-theme=light.9")?.theme).toBe("light");
        expect(parseThemeChoice("ls-theme=light.9; ls-theme=dark.5")?.theme).toBe("light");
    });

    it("round-trips what formatThemeChoice writes", () => {
        const choice = { theme: "system" as const, at: 1760680000000 };
        expect(parseThemeChoice(`ls-theme=${formatThemeChoice(choice)}`)).toEqual(choice);
    });
});

describe("cookieDomainCandidates", () => {
    it("tries the broadest domain first", () => {
        // The two deployments: app. subdomain, and apex app with a home. landing.
        expect(cookieDomainCandidates("app.launchstack.app")).toEqual([
            "launchstack.app",
            "app.launchstack.app",
        ]);
        expect(cookieDomainCandidates("home.launchstack-internal.com")).toEqual([
            "launchstack-internal.com",
            "home.launchstack-internal.com",
        ]);
        expect(cookieDomainCandidates("launchstack-internal.com")).toEqual([
            "launchstack-internal.com",
        ]);
    });

    it("leaves localhost and IP addresses host-only", () => {
        expect(cookieDomainCandidates("localhost")).toEqual([]);
        expect(cookieDomainCandidates("127.0.0.1")).toEqual([]);
        expect(cookieDomainCandidates("::1")).toEqual([]);
    });
});

describe("writeThemeChoice", () => {
    it("skips the public suffix and settles on the registrable domain", () => {
        const writes = recordWrites(() => writeThemeChoice("light", 1000));
        expect(writes.map(w => /Domain=([^;]+)/.exec(w)?.[1] ?? "host-only")).toEqual([
            "co.uk", // refused by the jar, as a browser refuses it
            "example.co.uk",
        ]);
        expect(writes[1]).toContain("Secure");
        expect(writes[1]).toContain("SameSite=Lax");
        expect(readThemeChoice()).toEqual({ theme: "light", at: 1000 });
    });

    it("replaces the previous choice", () => {
        writeThemeChoice("light", 1000);
        writeThemeChoice("dark", 2000);
        expect(document.cookie.match(/ls-theme=/g)).toHaveLength(1);
        expect(readThemeChoice()).toEqual({ theme: "dark", at: 2000 });
    });
});

describe("THEME_BOOT_SCRIPT", () => {
    // The way the page runs it: an inline <script> (jest's jsdom runs scripts).
    const boot = () => {
        const script = document.createElement("script");
        script.textContent = THEME_BOOT_SCRIPT;
        document.head.appendChild(script);
        script.remove();
    };

    it("hands the cookie's theme to next-themes before it paints", () => {
        localStorage.setItem("theme", "dark");
        document.cookie = "ls-theme=light.10; Path=/";
        boot();
        expect(localStorage.getItem("theme")).toBe("light");
    });

    it("leaves next-themes alone without a valid cookie", () => {
        localStorage.setItem("theme", "dark");
        boot();
        expect(localStorage.getItem("theme")).toBe("dark");
        document.cookie = "ls-theme=purple.10; Path=/";
        boot();
        expect(localStorage.getItem("theme")).toBe("dark");
    });

    it("picks the newer of two copies, like parseThemeChoice", () => {
        document.cookie = "ls-theme=light.20; Path=/; Domain=example.co.uk";
        document.cookie = "ls-theme=dark.10; Path=/";
        expect(document.cookie.match(/ls-theme=/g)).toHaveLength(2);
        boot();
        expect(localStorage.getItem("theme")).toBe("light");
        expect(readThemeChoice()?.theme).toBe("light");
    });
});
