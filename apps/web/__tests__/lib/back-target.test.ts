import { backTargetFor, STUDIO } from "~/app/employer/_chrome/backTarget";

/**
 * The back control is only trustworthy if the same page always sends you to
 * the same place, and no page ever sends you to itself. These pin both, plus
 * the one rule that is easy to get backwards: a section's landing page is the
 * parent for things under it, not for itself.
 */
describe("backTargetFor", () => {
    it("sends the workspace's own pages up to the Studio", () => {
        for (const path of [
            "/employer/settings",
            "/employer/employees",
            "/employer/statistics",
            "/employer/metadata",
            "/employer/upload",
            "/employer/contact",
            "/employer/agent-sessions",
            "/employer/artifacts",
            "/employer/tools/growth",
            "/employer/tools/marketing-pipeline",
            "/employer/tools/knowledge-graph",
            "/employer/tools/distribution",
            "/employer/tools/email-pipeline",
            "/employer/tools/repo-explainer",
        ]) {
            expect(backTargetFor(path)).toEqual(STUDIO);
        }
    });

    /**
     * The Studio is the top of the app. It used to point "back" at the
     * workspace picker, but a workspace is a separate environment: leaving
     * one is switching, and that lives in Settings, not behind a back arrow.
     */
    it("gives the Studio itself no way back — switching workspace is not back", () => {
        expect(backTargetFor("/employer/documents")).toBeNull();
        expect(backTargetFor("/employer/home")).toBeNull();
        expect(backTargetFor("/employer")).toBeNull();
    });

    it("prefers the nearest section over the Studio", () => {
        expect(backTargetFor("/employer/artifacts/abc123")).toEqual({
            href: "/employer/artifacts",
            label: "Artifacts",
        });
        expect(backTargetFor("/employer/tools/growth/prospects/deals")).toEqual({
            href: "/employer/tools/growth/prospects",
            label: "Prospects",
        });
        expect(backTargetFor("/employer/tools/growth/prospects/companies/42")).toEqual({
            href: "/employer/tools/growth/prospects/companies",
            label: "Companies",
        });
        expect(backTargetFor("/employer/tools/growth/brand/calendar")).toEqual({
            href: "/employer/tools/growth/brand",
            label: "Brand",
        });
        // Prospects moved under Growth; the old path is a redirect shim and
        // must not send anyone back to where it no longer lives.
        expect(backTargetFor("/employer/tools/prospects/deals")).toEqual({
            href: "/employer/tools/growth/prospects",
            label: "Prospects",
        });
    });

    it("never points a page at itself", () => {
        for (const path of [
            "/employer/documents",
            "/employer/artifacts",
            "/employer/tools/growth",
            "/employer/tools/growth/prospects",
            "/employer/tools/growth/prospects/companies",
            "/employer/settings",
        ]) {
            expect(backTargetFor(path)?.href).not.toBe(path);
        }
    });

    /**
     * `/employer/tools/growth` redirects to Brand, so "never points at itself"
     * was true on paper and false in the browser: Brand's back went to Growth,
     * which came straight back to Brand. A page that only redirects is not a
     * place to go back to.
     */
    it("sends Growth's two halves out to the Studio, not to a redirect back into them", () => {
        expect(backTargetFor("/employer/tools/growth/brand")).toEqual(STUDIO);
        expect(backTargetFor("/employer/tools/growth/prospects")).toEqual(STUDIO);
    });

    it("ignores a trailing slash", () => {
        expect(backTargetFor("/employer/settings/")).toEqual(STUDIO);
        expect(backTargetFor("/employer/documents/")).toBeNull();
    });

    it("stays out of the way outside the workspace", () => {
        expect(backTargetFor("/signin")).toBeNull();
        expect(backTargetFor("/workspaces")).toBeNull();
        expect(backTargetFor("/")).toBeNull();
    });

    it("gives every employer route an answer", () => {
        for (const path of [
            "/employer/documents/viewer",
            "/employer/mindmap/12",
            "/employer/onboarding",
            "/employer/pending-approval",
            "/employer/pdfTest",
        ]) {
            const target = backTargetFor(path);
            expect(target).not.toBeNull();
            expect(target!.href).not.toBe(path);
            expect(target!.label.length).toBeGreaterThan(0);
        }
    });
});
