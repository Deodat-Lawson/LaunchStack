import { beforeEach, describe, expect, it } from "vitest";
import type { BaseRetriever } from "@langchain/core/retrievers";

import { configureEnsemble, getEnsembleConfig, type FactsLegProvider } from "./config";

const stubRetriever = {} as BaseRetriever;

const factsLegs: FactsLegProvider = {
    createDocumentLeg: () => stubRetriever,
    createCompanyLeg: () => stubRetriever,
    createMultiDocLeg: () => stubRetriever,
};

describe("ensemble runtime config", () => {
    beforeEach(() => {
        configureEnsemble({ graphRetrieval: false, notesLegs: null, factsLegs: null });
    });

    it("runs no optional leg until the composition root says so", () => {
        const config = getEnsembleConfig();
        expect(config.graphRetrieval).toBe(false);
        expect(config.notesLegs).toBeNull();
        expect(config.factsLegs).toBeNull();
    });

    it("registers the company-facts leg without touching the other legs", () => {
        configureEnsemble({ factsLegs });
        const config = getEnsembleConfig();
        expect(config.factsLegs).toBe(factsLegs);
        expect(config.graphRetrieval).toBe(false);
        expect(config.notesLegs).toBeNull();
    });

    it("lets the host withdraw a leg by passing null", () => {
        configureEnsemble({ factsLegs });
        configureEnsemble({ factsLegs: null });
        expect(getEnsembleConfig().factsLegs).toBeNull();
    });
});
