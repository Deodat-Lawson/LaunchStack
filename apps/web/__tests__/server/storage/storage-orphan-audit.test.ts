import { classifyInventoryObject } from "~/server/storage/orphan-audit";

describe("storage orphan classification", () => {
    it("never classifies objects as orphans when provider listing is unavailable", () => {
        expect(
            classifyInventoryObject(
                {
                    ref: {
                        adapter: "s3",
                        storageLocationId: "s3:test@bucket",
                        key: "documents/missing.pdf",
                    },
                    size: 12,
                },
                {
                    listingAvailable: false,
                    highConfidenceRefs: new Set(),
                    mediumConfidenceRefs: new Set(),
                }
            )
        ).toEqual("unknown");
    });

    it("only permits high-confidence referenced objects for backfill", () => {
        const object = {
            ref: {
                adapter: "s3" as const,
                storageLocationId: "s3:test@bucket",
                key: "documents/live.pdf",
            },
            size: 42,
        };

        expect(
            classifyInventoryObject(object, {
                listingAvailable: true,
                highConfidenceRefs: new Set(["s3\u0000s3:test@bucket\u0000documents/live.pdf"]),
                mediumConfidenceRefs: new Set(),
            })
        ).toEqual("referenced_high_confidence");
    });
});
