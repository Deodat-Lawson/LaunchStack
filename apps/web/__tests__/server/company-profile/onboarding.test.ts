/**
 * What onboarding writes. Typed answers go to two places: the company record
 * (description, industry — what the source sorter already knows) and the
 * company profile as the person's own facts, through the same edit path the
 * profile page uses, so they survive a rebuild and can be changed or removed
 * there. Blank answers change nothing.
 */
import type * as CompanyMetadata from "@launchstack/pipelines/company-metadata";
import {
    createEmptyMetadata,
    type CompanyMetadataJSON,
} from "@launchstack/pipelines/company-metadata";

const mockUpdates: { set: Record<string, unknown> }[] = [];
let mockCompanyRows: Record<string, unknown>[] = [];
let mockStored: CompanyMetadataJSON | null = null;
const mockSaves: { metadata: CompanyMetadataJSON; options: Record<string, unknown> }[] = [];

jest.mock("~/server/db", () => ({
    db: {
        update: () => ({
            set: (set: Record<string, unknown>) => ({
                where: () => {
                    mockUpdates.push({ set });
                    return Promise.resolve(undefined);
                },
            }),
        }),
        select: () => ({
            from: () => ({ where: () => Promise.resolve(mockCompanyRows) }),
        }),
    },
}));

jest.mock("@launchstack/pipelines/company-metadata", () => {
    const actual = jest.requireActual<typeof CompanyMetadata>(
        "@launchstack/pipelines/company-metadata"
    );
    return {
        ...actual,
        saveProfileLocked: async (
            _companyId: bigint,
            update: (current: CompanyMetadataJSON | null) => { metadata: CompanyMetadataJSON },
            options: Record<string, unknown>
        ) => {
            const { metadata } = update(mockStored);
            mockSaves.push({ metadata, options });
            mockStored = metadata;
        },
        getProfileRow: () => Promise.resolve(mockStored ? { metadata: mockStored } : null),
    };
});

import {
    IDEA_LABEL,
    IDEA_PATH,
    loadOnboarding,
    onboardingEdits,
    saveOnboarding,
} from "~/server/company-profile/onboarding";

const ctx = { companyId: BigInt(5), authUserId: "user-a" };

beforeEach(() => {
    mockUpdates.length = 0;
    mockSaves.length = 0;
    mockStored = null;
    mockCompanyRows = [{ name: "Acme", description: null, industry: null }];
});

describe("onboardingEdits", () => {
    it("turns each answer into its fact", () => {
        expect(
            onboardingEdits({
                website: "acme.com",
                description: "  We make anvils.  ",
                idea: "Anvils by subscription.",
                industry: "Manufacturing",
            })
        ).toEqual([
            { path: "company.website", value: "https://acme.com/" },
            { path: "company.description", value: "We make anvils." },
            { path: IDEA_PATH, value: "Anvils by subscription.", label: IDEA_LABEL },
        ]);
    });

    it("changes nothing for blank answers or an address that is not one", () => {
        expect(onboardingEdits({})).toEqual([]);
        expect(onboardingEdits({ website: "not a site", description: "  ", idea: "" })).toEqual([]);
    });
});

describe("saveOnboarding", () => {
    it("writes the profile as the person's own facts and the company record", async () => {
        const saved = await saveOnboarding(ctx, {
            website: "acme.com",
            description: "We make anvils.",
            idea: "Anvils by subscription.",
            industry: "Manufacturing",
        });

        expect(saved).toEqual({ website: "https://acme.com/", facts: 3 });
        expect(mockUpdates).toEqual([
            { set: { description: "We make anvils.", industry: "Manufacturing" } },
        ]);

        expect(mockSaves).toHaveLength(1);
        expect(mockSaves[0]!.options).toEqual({
            changedBy: "user-a",
            changeType: "manual_override",
            built: false,
        });
        const { metadata } = mockSaves[0]!;
        expect(metadata.company.website).toMatchObject({
            value: "https://acme.com/",
            priority: "manual_override",
        });
        expect(metadata.company.description).toMatchObject({
            value: "We make anvils.",
            priority: "manual_override",
        });
        expect(metadata.profile?.facts?.idea).toMatchObject({
            value: "Anvils by subscription.",
            priority: "manual_override",
        });
    });

    it("keeps what the profile already has", async () => {
        const existing = createEmptyMetadata("5");
        existing.company.name = {
            value: "Acme Inc.",
            visibility: "public",
            confidence: 0.9,
            priority: "normal",
            status: "active",
            last_updated: "2026-10-01T00:00:00.000Z",
            sources: [],
            source: "extracted",
        } as never;
        mockStored = existing;

        await saveOnboarding(ctx, { website: "acme.com" });

        expect(mockSaves[0]!.metadata.company.name).toMatchObject({ value: "Acme Inc." });
        expect(mockSaves[0]!.metadata.company.website).toMatchObject({
            value: "https://acme.com/",
        });
    });

    it("skipped answers write nothing", async () => {
        const saved = await saveOnboarding(ctx, { website: "  ", description: "" });
        expect(saved).toEqual({ website: null, facts: 0 });
        expect(mockUpdates).toEqual([]);
        expect(mockSaves).toEqual([]);
    });

    it("an industry alone goes only to the company record", async () => {
        await saveOnboarding(ctx, { industry: "Legal" });
        expect(mockUpdates).toEqual([{ set: { industry: "Legal" } }]);
        expect(mockSaves).toEqual([]);
    });
});

describe("loadOnboarding", () => {
    it("starts a second pass filled in with what was saved", async () => {
        await saveOnboarding(ctx, {
            website: "acme.com",
            description: "We make anvils.",
            idea: "Anvils by subscription.",
        });
        mockCompanyRows = [{ name: "Acme", description: "Old words", industry: "Manufacturing" }];

        await expect(loadOnboarding(ctx)).resolves.toEqual({
            name: "Acme",
            website: "https://acme.com/",
            description: "We make anvils.",
            idea: "Anvils by subscription.",
            industry: "Manufacturing",
        });
    });

    it("falls back to the company record before there is a profile", async () => {
        mockCompanyRows = [{ name: "Acme", description: "From signup", industry: null }];
        await expect(loadOnboarding(ctx)).resolves.toEqual({
            name: "Acme",
            website: null,
            description: "From signup",
            idea: null,
            industry: null,
        });
    });
});
