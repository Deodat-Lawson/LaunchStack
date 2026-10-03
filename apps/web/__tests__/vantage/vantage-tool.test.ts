/**
 * Vantage is a tab now, not a route tree. These pin the table that replaced
 * its pages: every old route has the same screen at the same app-relative
 * path, an agenda link keeps its `?week=`, Triage is gated on
 * `settings.manage`, and an unknown path is "not found" rather than a blank
 * tab. They also pin that old `/employer/tools/vantage/...` links resolve
 * into the tab at the same place.
 */
import OldVantagePage from "~/app/employer/tools/vantage/[[...slug]]/page";
import { vantagePath, VANTAGE_BASE } from "~/app/employer/tools/vantage/_lib/paths";
import { VANTAGE_ROOTS, vantageScreenFor } from "~/app/employer/tools/vantage/_lib/screens";
import { isToolPath, toolTabHref, toolTargetFromHref } from "~/lib/tool-app/locations";

describe("vantageScreenFor", () => {
    it.each([
        ["/", "overview"],
        ["", "overview"],
        ["/commitments", "commitments"],
        ["/evidence", "evidence"],
        ["/metrics", "metrics"],
        ["/program", "triage"],
    ])("shows %p as %p", (href, kind) => {
        expect(vantageScreenFor(href).kind).toBe(kind);
    });

    it("ignores a trailing slash, a hash and an unrelated query", () => {
        expect(vantageScreenFor("/evidence/")).toEqual({ kind: "evidence" });
        expect(vantageScreenFor("/metrics#recorded")).toEqual({ kind: "metrics" });
        expect(vantageScreenFor("/commitments?view=all")).toEqual({ kind: "commitments" });
    });

    it("opens the agenda on the week in ?week=", () => {
        expect(vantageScreenFor("/agenda?week=2026-10-05")).toEqual({
            kind: "agenda",
            week: "2026-10-05",
        });
        expect(vantageScreenFor("/agenda/?week=2026-09-28&x=1")).toEqual({
            kind: "agenda",
            week: "2026-09-28",
        });
    });

    it("falls back to the default week without a usable ?week=", () => {
        expect(vantageScreenFor("/agenda")).toEqual({ kind: "agenda", week: null });
        expect(vantageScreenFor("/agenda?week=")).toEqual({ kind: "agenda", week: null });
        expect(vantageScreenFor("/agenda?week=next-week")).toEqual({ kind: "agenda", week: null });
    });

    it("gates Triage on settings.manage, and waits for the answer", () => {
        expect(vantageScreenFor("/program", "allowed")).toEqual({ kind: "triage" });
        expect(vantageScreenFor("/program", "denied")).toEqual({ kind: "triage-denied" });
        expect(vantageScreenFor("/program", "pending")).toEqual({ kind: "triage-pending" });
        // The gate is Triage's alone: a founder's own screens never wait on it.
        expect(vantageScreenFor("/agenda", "denied").kind).toBe("agenda");
        expect(vantageScreenFor("/", "pending").kind).toBe("overview");
    });

    it.each(["/agenda/2026-10-05", "/program/deadlines", "/settings", "/brand", "/week"])(
        "has no screen for %p",
        href => {
            expect(vantageScreenFor(href)).toEqual({ kind: "not-found" });
        }
    );
});

describe("vantage paths inside the tab", () => {
    it("are app-relative, with the home at /", () => {
        expect(VANTAGE_BASE).toBe("");
        expect(vantagePath("")).toBe("/");
        expect(vantagePath()).toBe("/");
        expect(vantagePath("/agenda?week=2026-10-05")).toBe("/agenda?week=2026-10-05");
    });

    it("are all the tab's own, so links stay inside it", () => {
        for (const to of ["", "/agenda", "/commitments", "/evidence", "/metrics", "/program"]) {
            expect(isToolPath(vantagePath(to), VANTAGE_ROOTS)).toBe(true);
        }
        expect(isToolPath("/employer/documents?docId=12", VANTAGE_ROOTS)).toBe(false);
    });

    it("resolves the old /employer/tools/vantage URLs to the same screen", () => {
        const at = (href: string) => {
            const target = toolTargetFromHref(href);
            expect(target?.toolId).toBe("vantage");
            return target!.at;
        };
        expect(vantageScreenFor(at("/employer/tools/vantage")).kind).toBe("overview");
        expect(vantageScreenFor(at("/employer/tools/vantage/metrics")).kind).toBe("metrics");
        // The history loader still builds this shape (src/server/history/loaders.ts).
        expect(vantageScreenFor(at("/employer/tools/vantage/agenda?week=2026-10-05"))).toEqual({
            kind: "agenda",
            week: "2026-10-05",
        });
        expect(toolTabHref("vantage", at("/employer/tools/vantage/program"))).toBe(
            "/employer/documents?feature=vantage&at=%2Fprogram"
        );
    });
});

describe("the old /employer/tools/vantage pages", () => {
    /** Runs the catch-all page and returns where Next's `redirect()` sends the browser. */
    async function redirectFor(
        slug: string[] | undefined,
        query: Record<string, string | string[] | undefined> = {}
    ): Promise<string> {
        try {
            await OldVantagePage({
                params: Promise.resolve({ slug }),
                searchParams: Promise.resolve(query),
            });
        } catch (err) {
            // NEXT_REDIRECT;<type>;<url>;<status>;
            const digest = (err as { digest?: string }).digest ?? "";
            if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2]!;
            throw err;
        }
        throw new Error("the page rendered instead of redirecting");
    }

    it("redirect every screen into the tab, query included", async () => {
        // The old home URL lands on the tool's home, not the last screen.
        await expect(redirectFor(undefined)).resolves.toBe(
            "/employer/documents?feature=vantage&at=%2F"
        );
        await expect(redirectFor(["agenda"], { week: "2026-10-05" })).resolves.toBe(
            "/employer/documents?feature=vantage&at=%2Fagenda%3Fweek%3D2026-10-05"
        );
        for (const screen of ["commitments", "evidence", "metrics", "program"]) {
            await expect(redirectFor([screen])).resolves.toBe(
                `/employer/documents?feature=vantage&at=%2F${screen}`
            );
        }
    });
});
