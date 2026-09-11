/**
 * The service map is a description of the API, so it is only useful if it stays
 * true. These tests read the actual route tree and fail when the two drift:
 * a new route folder nobody claimed, or a claim pointing at a folder that no
 * longer exists.
 *
 * The intent is a ratchet, not a rule nobody reads — the same mechanism the
 * frontend design guardrails use.
 */

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
    ALL_SERVICES,
    PLATFORM_SERVICES,
    SYSTEM_SERVICES,
    TOOL_SERVICES,
    serviceForRoute,
} from "~/server/api/services";

const API_ROOT = join(process.cwd(), "src", "app", "api");

/** Every directory under `src/app/api` that actually contains a route file. */
function routeFolders(): string[] {
    const found: string[] = [];

    function walk(dir: string, relative: string) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
            const nextDir = join(dir, entry.name);
            if (existsSync(join(nextDir, "route.ts"))) {
                found.push(nextRelative);
            }
            walk(nextDir, nextRelative);
        }
    }

    walk(API_ROOT, "");
    return found;
}

describe("the service map", () => {
    it("claims every route in the tree", () => {
        const unclaimed = routeFolders().filter(route => serviceForRoute(route) === null);
        expect(unclaimed).toEqual([]);
    });

    it("does not claim routes that no longer exist", () => {
        const missing = ALL_SERVICES.flatMap(service =>
            service.routes
                .filter(route => !existsSync(join(API_ROOT, route)))
                .map(route => `${service.id} → ${route}`)
        );
        expect(missing).toEqual([]);
    });

    it("gives every service a unique id", () => {
        const ids = ALL_SERVICES.map(service => service.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("names each service in kebab-case, which is the convention routes converge on", () => {
        const offenders = ALL_SERVICES.map(s => s.id).filter(id => !/^[a-z][a-z0-9-]*$/.test(id));
        expect(offenders).toEqual([]);
    });

    it("assigns each service to exactly one route owner, so ownership is unambiguous", () => {
        const owners = new Map<string, string[]>();
        for (const service of ALL_SERVICES) {
            for (const route of service.routes) {
                owners.set(route, [...(owners.get(route) ?? []), service.id]);
            }
        }
        const shared = [...owners.entries()]
            .filter(([, claimants]) => claimants.length > 1)
            .map(([route, claimants]) => `${route}: ${claimants.join(", ")}`);
        expect(shared).toEqual([]);
    });

    it("explains every route it marks as running outside a workspace", () => {
        const unexplained = ALL_SERVICES.filter(
            service => service.scope !== "workspace" && !service.unscopedRoutes
        ).map(service => service.id);
        expect(unexplained).toEqual([]);
    });

    it("keeps the tier field consistent with the group a service is declared in", () => {
        expect(TOOL_SERVICES.every(s => s.tier === "tool")).toBe(true);
        expect(PLATFORM_SERVICES.every(s => s.tier === "platform")).toBe(true);
        expect(SYSTEM_SERVICES.every(s => s.tier === "system")).toBe(true);
    });

    it("resolves a nested route to its most specific owner", () => {
        // `documents` is knowledge; a nested path must not fall through to a
        // broader claim elsewhere in the map.
        expect(serviceForRoute("documents/[id]/versions")?.id).toBe("knowledge");
        expect(serviceForRoute("founder-weekly-reviews/[runId]/retry")?.id).toBe(
            "investor-updates"
        );
    });
});
