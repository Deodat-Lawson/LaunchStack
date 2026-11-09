import { describe, expect, it } from "vitest";

import {
    CreateTrackerTaskSchema,
    SaveTrackerOpportunitySchema,
    UpdateTrackerOpportunitySchema,
    UpdateTrackerTaskSchema,
    assertTrackerCycleChange,
    selectTrackerOpportunity,
    trackerCompletionTime,
} from "./tracker";

describe("tracker opportunity identity", () => {
    it("upgrades the Program-only opportunity without creating a second one", () => {
        const saved = { id: "saved", cycleId: null, status: "preparing", notes: "Keep this" };
        expect(selectTrackerOpportunity([saved], "spring")).toEqual({
            kind: "upgrade",
            opportunity: saved,
        });
        expect(saved).toEqual({
            id: "saved",
            cycleId: null,
            status: "preparing",
            notes: "Keep this",
        });
    });
    it("reuses the same company/Program/cycle and creates a separate later cycle", () => {
        const past = { id: "past", cycleId: "spring", status: "rejected" };
        expect(selectTrackerOpportunity([past], "spring")).toEqual({
            kind: "existing",
            opportunity: past,
        });
        expect(selectTrackerOpportunity([past], "fall")).toEqual({ kind: "create" });
        expect(past.status).toBe("rejected");
        expect(selectTrackerOpportunity([past], null)).toEqual({ kind: "create" });
    });
    it("prefers an exact cycle over an unrelated Program-only opportunity", () => {
        const exact = { id: "exact", cycleId: "fall" };
        expect(selectTrackerOpportunity([{ id: "general", cycleId: null }, exact], "fall")).toEqual(
            { kind: "existing", opportunity: exact }
        );
    });
    it("does not retarget or clear a previously selected cycle", () => {
        expect(() => assertTrackerCycleChange(null, "spring")).not.toThrow();
        expect(() => assertTrackerCycleChange("spring", "spring")).not.toThrow();
        expect(() => assertTrackerCycleChange("spring", "fall")).toThrow();
        expect(() => assertTrackerCycleChange("spring", null)).toThrow();
    });
});

describe("tracker request schemas", () => {
    it("keeps priority independent of status and excludes pending as a stored status", () => {
        expect(
            UpdateTrackerOpportunitySchema.parse({ priority: "high", status: "rejected" })
        ).toEqual({ priority: "high", status: "rejected" });
        expect(UpdateTrackerOpportunitySchema.safeParse({ status: "pending" }).success).toBe(false);
    });
    it("accepts nullable dates but rejects invented dates, unknown fields and client tenancy", () => {
        expect(
            UpdateTrackerOpportunitySchema.safeParse({
                submittedOn: "2028-02-29",
                plannedDeadline: null,
            }).success
        ).toBe(true);
        expect(
            UpdateTrackerOpportunitySchema.safeParse({ submittedOn: "2026-02-29" }).success
        ).toBe(false);
        expect(
            CreateTrackerTaskSchema.safeParse({ title: "Prepare", dueOn: "2026-02-30" }).success
        ).toBe(false);
        expect(
            SaveTrackerOpportunitySchema.safeParse({ programId: "program", companyId: "other" })
                .success
        ).toBe(false);
        expect(
            UpdateTrackerTaskSchema.safeParse({ completedAt: "2026-11-07T00:00:00Z" }).success
        ).toBe(false);
        expect(UpdateTrackerTaskSchema.safeParse({}).success).toBe(false);
        expect(UpdateTrackerOpportunitySchema.safeParse({}).success).toBe(false);
    });
});

describe("task completion", () => {
    const original = new Date("2026-11-01T00:00:00Z");
    const now = new Date("2026-11-07T00:00:00Z");
    it("records first completion, preserves it on other edits, and clears it on reopening", () => {
        expect(trackerCompletionTime(false, null, true, now)).toEqual(now);
        expect(trackerCompletionTime(true, original, true, now)).toEqual(original);
        expect(trackerCompletionTime(true, original, undefined, now)).toEqual(original);
        expect(trackerCompletionTime(true, original, false, now)).toBeNull();
    });
});
