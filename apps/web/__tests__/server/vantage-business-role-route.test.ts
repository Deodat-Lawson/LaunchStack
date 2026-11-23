jest.mock("~/server/beta-apps", () => ({ requireBetaAppContext: jest.fn() }));
jest.mock("~/server/vantage/weekly-review-service", () => ({
    weeklyReviewEnabled: jest.fn(() => true),
    scopedEvidenceV2Enabled: jest.fn(() => true),
    weeklyReviewDatabase: { transaction: jest.fn() },
    weeklyReviewServices: jest.fn(),
}));

import { requireBetaAppContext } from "~/server/beta-apps";
import { GET, PATCH } from "~/app/api/vantage/reviews/context/role/route";
import { PATCH as saveStars } from "~/app/api/vantage/reviews/context/route";
import { createWeeklyReviewAuthority } from "~/server/vantage/weekly-review-authority";
import {
    weeklyReviewDatabase,
    weeklyReviewEnabled,
    weeklyReviewServices,
} from "~/server/vantage/weekly-review-service";
import type { WeeklyReviewQuery } from "~/server/vantage/weekly-review-types";

const input = {
    primaryRole: "Finance lead",
    responsibilities: ["Forecast cash flow"],
    priorities: ["Extend runway"],
    confirmed: true,
};
const confirmedRole = {
    ...input,
    schemaVersion: "vantage-business-role/v1",
    confirmedBy: "person",
    companyId: "1",
    revision: 3,
};
const request = (body: unknown) =>
    new Request("http://localhost/api/vantage/reviews/context/role", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });

function setup() {
    let current = { companyId: "1", userId: "person", canRead: true, canEdit: true, active: true };
    let preference: Record<string, unknown> | undefined = {
        version: 3,
        business_role_context: confirmedRole,
        star_document_ids: ["hidden-document"],
        star_source_scopes: { "hidden-document": { private: "preserved scope" } },
    };
    const queries: { sql: string; params: unknown[] }[] = [];
    let onEpochLock = () => {};
    let rejectUpdate = false;
    const query: WeeklyReviewQuery = async (sql, params = []) => {
        queries.push({ sql, params });
        if (sql.includes("weekly_review_epochs") && sql.includes("FOR ")) {
            onEpochLock();
            return [{ version: 1 }];
        }
        if (sql.startsWith("SELECT id,title,category")) return [];
        if (sql.startsWith("SELECT") && sql.includes("weekly_review_preferences")) {
            if (params[0] !== current.companyId || params[1] !== current.userId)
                throw Error("wrong preference identity");
            return preference ? [preference] : [];
        }
        if (sql.startsWith("INSERT INTO pdr_ai_v2_vantage_weekly_review_preferences")) {
            if (rejectUpdate) return [];
            const next = Number(preference?.version ?? 0) + 1;
            preference = {
                ...preference,
                version: next,
                business_role_context: typeof params[2] === "string" ? JSON.parse(params[2]) : null,
            };
            return [{ version: next }];
        }
        return [];
    };
    jest.mocked(requireBetaAppContext).mockImplementation(async () =>
        current.active
            ? ({
                  success: true,
                  data: {
                      companyId: BigInt(current.companyId),
                      authUserId: current.userId,
                      role: "admin",
                      can: (permission: string) =>
                          permission === "documents.read" ? current.canRead : current.canEdit,
                  },
              } as Awaited<ReturnType<typeof requireBetaAppContext>>)
            : ({
                  success: false,
                  response: Response.json({ error: "forbidden" }, { status: 403 }),
              } as Awaited<ReturnType<typeof requireBetaAppContext>>)
    );
    jest.mocked(weeklyReviewEnabled).mockReturnValue(true);
    jest.mocked(weeklyReviewDatabase.transaction).mockImplementation(work => work(query));
    const authority = createWeeklyReviewAuthority(weeklyReviewDatabase, async () => ({
        companyId: current.companyId,
        userId: current.userId,
        canRead: current.active && current.canRead,
        canMutate: current.canEdit,
        role: "admin",
        documentScope: { kind: "everything" },
    }));
    jest.mocked(weeklyReviewServices).mockReturnValue({ authority } as ReturnType<
        typeof weeklyReviewServices
    >);
    return {
        queries,
        getPreference: () => preference,
        setPreference: (value: Record<string, unknown> | undefined) => {
            preference = value;
        },
        changeActor: (changes: Partial<typeof current>) => {
            current = { ...current, ...changes };
        },
        atEpochLock: (callback: () => void) => {
            onEpochLock = callback;
        },
        rejectUpdate: () => {
            rejectUpdate = true;
        },
    };
}

beforeEach(() => jest.clearAllMocks());

describe("own-actor confirmed business role API (synthetic)", () => {
    it("returns only the current actor's confirmed role and current preference version", async () => {
        const f = setup();
        const response = await GET();
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            role: confirmedRole,
            version: 3,
            canEdit: true,
            enabled: true,
        });
        const read = f.queries.find(({ sql }) => sql.includes("SELECT business_role_context"));
        expect(read?.params).toEqual(["1", "person"]);
        expect(read?.sql).toContain("company_id=$1::bigint AND actor_id=$2");
    });

    it("returns null for legacy membership-only preferences without inferring a business role", async () => {
        const f = setup();
        f.setPreference({ version: 3, role: "admin" });
        expect(await (await GET()).json()).toEqual({
            role: null,
            version: 3,
            canEdit: true,
            enabled: true,
        });
    });

    it("does not return role context saved for another actor", async () => {
        const f = setup();
        f.setPreference({
            version: 3,
            business_role_context: { ...confirmedRole, confirmedBy: "other" },
        });
        expect((await (await GET()).json()).role).toBeNull();
    });

    it("derives identity and revision while preserving hidden stars and scopes", async () => {
        const f = setup();
        const old = f.getPreference();
        const response = await PATCH(request({ expectedVersion: 3, ...input }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            role: { ...confirmedRole, revision: 4 },
            version: 4,
        });
        expect(f.getPreference()?.star_document_ids).toBe(old?.star_document_ids);
        expect(f.getPreference()?.star_source_scopes).toBe(old?.star_source_scopes);
        const write = f.queries.find(({ sql }) => sql.includes("DO UPDATE SET"));
        expect(write?.sql).toContain("$3::text::jsonb");
        expect(write?.sql.split("DO UPDATE SET")[1]).not.toMatch(
            /star_document_ids|star_source_scopes/
        );
    });

    it.each(["companyId", "confirmedBy", "revision", "schemaVersion", "actorId"])(
        "rejects client identity or revision spoofing via %s",
        async field => {
            const f = setup();
            const response = await PATCH(
                request({ expectedVersion: 3, ...input, [field]: "spoof" })
            );
            expect(response.status).toBe(400);
            expect(f.queries).toHaveLength(0);
        }
    );

    it("requires explicit confirmation", async () => {
        setup();
        expect(
            (await PATCH(request({ expectedVersion: 3, ...input, confirmed: false }))).status
        ).toBe(400);
    });

    it("clears only the role and increments the shared preference version", async () => {
        const f = setup();
        const stars = f.getPreference()?.star_document_ids;
        expect(await (await PATCH(request({ expectedVersion: 3, role: null }))).json()).toEqual({
            role: null,
            version: 4,
        });
        expect(f.getPreference()?.business_role_context).toBeNull();
        expect(f.getPreference()?.star_document_ids).toBe(stars);
    });

    it("creates the first confirmed role with server revision one", async () => {
        const f = setup();
        f.setPreference(undefined);
        expect(await (await PATCH(request({ expectedVersion: 0, ...input }))).json()).toEqual({
            role: { ...confirmedRole, revision: 1 },
            version: 1,
        });
    });

    it("rejects stale preference versions after a source-preference change", async () => {
        const f = setup();
        f.setPreference({ ...f.getPreference(), version: 4 });
        const response = await PATCH(request({ expectedVersion: 3, ...input }));
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ error: "stale_context_preferences" });
        expect(f.queries.some(({ sql }) => sql.includes("DO UPDATE SET"))).toBe(false);
    });

    it("rejects a failed database compare-and-swap", async () => {
        const f = setup();
        f.rejectUpdate();
        expect((await PATCH(request({ expectedVersion: 3, ...input }))).status).toBe(409);
    });

    it("allows read-only retrieval and denies the mutation", async () => {
        const f = setup();
        f.changeActor({ canEdit: false });
        expect((await (await GET()).json()).canEdit).toBe(false);
        expect((await PATCH(request({ expectedVersion: 3, ...input }))).status).toBe(403);
    });

    it.each([
        ["membership revocation", { active: false }],
        ["edit revocation", { canEdit: false }],
        ["read revocation", { canRead: false }],
        ["actor switch", { userId: "other-person" }],
        ["company switch", { companyId: "2" }],
    ])("rejects %s occurring at the epoch barrier", async (_label, changes) => {
        const f = setup();
        f.atEpochLock(() => f.changeActor(changes));
        expect((await PATCH(request({ expectedVersion: 3, ...input }))).status).toBe(403);
        expect(f.queries.some(({ sql }) => sql.includes("DO UPDATE SET"))).toBe(false);
    });

    it("checks fresh read authority when GET crosses the epoch barrier", async () => {
        const f = setup();
        f.atEpochLock(() => f.changeActor({ canRead: false }));
        expect((await GET()).status).toBe(403);
    });

    it("keeps role writes default-off behind the weekly-review gate", async () => {
        const f = setup();
        jest.mocked(weeklyReviewEnabled).mockReturnValue(false);
        expect((await PATCH(request({ expectedVersion: 3, ...input }))).status).toBe(404);
        expect(f.queries).toHaveLength(0);
    });

    it("locks epoch before preferences and reloads authority while the epoch lock is held", async () => {
        const f = setup();
        let callsAtEpoch = 0;
        f.atEpochLock(() => {
            callsAtEpoch = jest.mocked(requireBetaAppContext).mock.calls.length;
        });
        await PATCH(request({ expectedVersion: 3, ...input }));
        const epoch = f.queries.findIndex(
            ({ sql }) => sql.includes("weekly_review_epochs") && sql.includes("FOR UPDATE")
        );
        const pref = f.queries.findIndex(
            ({ sql }) => sql.includes("weekly_review_preferences") && sql.includes("FOR UPDATE")
        );
        expect(epoch).toBeGreaterThanOrEqual(0);
        expect(pref).toBeGreaterThan(epoch);
        expect(callsAtEpoch).toBe(1);
        expect(requireBetaAppContext).toHaveBeenCalledTimes(2);
    });
});

it("takes the same epoch-first lock order for source-preference PATCH", async () => {
    const f = setup();
    f.setPreference({ version: 3, star_source_scopes: {} });
    const validatePreferenceSources = jest.fn(async () => []);
    jest.mocked(weeklyReviewServices).mockReturnValue({
        authority: { validatePreferenceSources },
    } as unknown as ReturnType<typeof weeklyReviewServices>);
    expect((await saveStars(request({ expectedVersion: 3, starDocumentIds: [] }))).status).toBe(
        200
    );
    const epoch = f.queries.findIndex(
        ({ sql }) => sql.includes("weekly_review_epochs") && sql.includes("FOR UPDATE")
    );
    const pref = f.queries.findIndex(
        ({ sql }) => sql.includes("weekly_review_preferences") && sql.includes("FOR UPDATE")
    );
    expect(epoch).toBeGreaterThanOrEqual(0);
    expect(pref).toBeGreaterThan(epoch);
    expect(validatePreferenceSources).toHaveBeenCalled();
});
