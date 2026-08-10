/**
 * The policy layer is what stops a request body from turning the connector
 * into an arbitrary-filesystem-read endpoint, so its failure mode is a
 * security failure rather than a broken feature.
 */

import path from "node:path";

import {
    configuredProjectRoots,
    isAgentKnowledgeConnectorEnabled,
    isWithinRoot,
    resolveProjectRoots,
} from "~/server/services/agent-knowledge-policy";

describe("isAgentKnowledgeConnectorEnabled", () => {
    it("defaults to off", () => {
        expect(isAgentKnowledgeConnectorEnabled(undefined)).toBe(false);
        expect(isAgentKnowledgeConnectorEnabled("")).toBe(false);
        expect(isAgentKnowledgeConnectorEnabled("false")).toBe(false);
        expect(isAgentKnowledgeConnectorEnabled("0")).toBe(false);
    });

    it("accepts the usual affirmative spellings", () => {
        for (const value of ["true", "TRUE", "1", "yes", " on "]) {
            expect(isAgentKnowledgeConnectorEnabled(value)).toBe(true);
        }
    });
});

describe("configuredProjectRoots", () => {
    it("is empty when unset", () => {
        expect(configuredProjectRoots(undefined)).toEqual([]);
        expect(configuredProjectRoots("  ")).toEqual([]);
    });

    it("splits on the platform delimiter, resolves and de-duplicates", () => {
        const raw = ["/srv/a", "/srv/b", "/srv/a", " "].join(path.delimiter);
        expect(configuredProjectRoots(raw)).toEqual([path.resolve("/srv/a"), path.resolve("/srv/b")]);
    });
});

describe("isWithinRoot", () => {
    it("accepts the root itself and its descendants", () => {
        expect(isWithinRoot("/srv/app", "/srv/app")).toBe(true);
        expect(isWithinRoot("/srv/app", "/srv/app/packages/core")).toBe(true);
    });

    it("rejects siblings and parents", () => {
        expect(isWithinRoot("/srv/app", "/srv/app-other")).toBe(false);
        expect(isWithinRoot("/srv/app", "/srv")).toBe(false);
        expect(isWithinRoot("/srv/app", "/etc")).toBe(false);
    });
});

describe("resolveProjectRoots", () => {
    const roots = [path.resolve("/srv/app"), path.resolve("/srv/other")];

    it("falls back to every configured root when nothing is requested", () => {
        expect(resolveProjectRoots(undefined, roots)).toEqual({ allowed: roots, rejected: [] });
        expect(resolveProjectRoots([], roots)).toEqual({ allowed: roots, rejected: [] });
    });

    it("allows a subdirectory of a configured root", () => {
        const decision = resolveProjectRoots(["/srv/app/apps/web"], roots);
        expect(decision.allowed).toEqual([path.resolve("/srv/app/apps/web")]);
        expect(decision.rejected).toEqual([]);
    });

    it("rejects a directory outside every root", () => {
        const decision = resolveProjectRoots(["/etc"], roots);
        expect(decision.allowed).toEqual([]);
        expect(decision.rejected).toEqual([path.resolve("/etc")]);
    });

    it("cannot be escaped with a traversal segment", () => {
        const decision = resolveProjectRoots(["/srv/app/../../etc"], roots);
        expect(decision.allowed).toEqual([]);
        expect(decision.rejected).toEqual([path.resolve("/etc")]);
    });

    it("rejects everything when no roots are configured", () => {
        const decision = resolveProjectRoots(["/srv/app"], []);
        expect(decision.allowed).toEqual([]);
        expect(decision.rejected).toEqual([path.resolve("/srv/app")]);
    });

    it("de-duplicates repeated requests", () => {
        const decision = resolveProjectRoots(["/srv/app", "/srv/app/"], roots);
        expect(decision.allowed).toEqual([path.resolve("/srv/app")]);
    });
});
