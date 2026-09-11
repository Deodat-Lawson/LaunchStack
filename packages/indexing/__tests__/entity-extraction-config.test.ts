import { afterEach, describe, expect, it } from "vitest";

import {
    configureEntityExtraction,
    isEntityExtractionEnabled,
    resetEntityExtractionConfig,
} from "../src/entity-extraction-config";

describe("entity extraction gate", () => {
    afterEach(() => {
        resetEntityExtractionConfig();
    });

    it("is off when the host never configured it", () => {
        expect(isEntityExtractionEnabled()).toBe(false);
    });

    it("is on only when the host enables it explicitly", () => {
        configureEntityExtraction({ enabled: true });
        expect(isEntityExtractionEnabled()).toBe(true);

        configureEntityExtraction({ enabled: false });
        expect(isEntityExtractionEnabled()).toBe(false);
    });

    it("treats a non-boolean truthy value as off", () => {
        configureEntityExtraction({ enabled: "yes" as unknown as boolean });
        expect(isEntityExtractionEnabled()).toBe(false);
    });

    it("returns to off after reset", () => {
        configureEntityExtraction({ enabled: true });
        resetEntityExtractionConfig();
        expect(isEntityExtractionEnabled()).toBe(false);
    });
});
