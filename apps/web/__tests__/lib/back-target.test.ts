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
            "/employer/tools/growth",
            "/employer/tools/marketing-pipeline",
            "/employer/tools/knowledge-graph",
            "/employer/tools/distribution",
            "/employer/tools/email-pipeline",
            "/employer/tools/repo-explainer",
            "/employer/tools/vantage",
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

    /**
     * Growth, Proposals and Vantage are tabs of the workspace now. Their old
     * pages only redirect into the tab, and back inside a tool is the tab's
     * own history — so none of their paths has a parent but the Studio.
     */
    it("sends every old tool page up to the Studio, where the tool is a tab", () => {
        for (const path of [
            "/employer/tools/growth/prospects/deals",
            "/employer/tools/growth/prospects/companies/42",
            "/employer/tools/growth/brand/calendar",
            "/employer/tools/proposals",
            "/employer/tools/proposals/write/abc",
            "/employer/tools/vantage/agenda",
            "/employer/tools/prospects/deals",
        ]) {
            expect(backTargetFor(path)).toEqual(STUDIO);
        }
    });

    it("never points a page at itself", () => {
        for (const path of [
            "/employer/documents",
            "/employer/tools/growth",
            "/employer/tools/growth/prospects",
            "/employer/tools/growth/prospects/companies",
            "/employer/settings",
        ]) {
            expect(backTargetFor(path)?.href).not.toBe(path);
        }
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
