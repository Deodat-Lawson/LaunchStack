import {
    groupContentFromChunks,
    cleanText,
    extractKeywords,
    hasReferencePattern,
    calculateTextSimilarity,
    truncateText,
    hasSpecificIdentifier,
} from "~/app/api/agents/predictive-document-analysis/utils/content";
import type { PdfChunk } from "~/app/api/agents/predictive-document-analysis/types";
import { db } from "~/server/db/index";
import { document, documentSections } from "@launchstack/core/db/schema";
import { hybridSearchWithRRF } from "~/app/api/agents/predictive-document-analysis/services/hybridSearch";
import { findSuggestedCompanyDocuments } from "~/app/api/agents/predictive-document-analysis/services/documentMatcher";

jest.mock("~/server/db/index", () => ({
    db: {
        select: jest.fn(),
    },
}));

jest.mock("~/app/api/agents/predictive-document-analysis/utils/embeddings", () => ({
    getEmbeddings: jest.fn().mockResolvedValue([]),
}));

type ChunkQueryRow = {
    id: number;
    content: string;
    page: number;
    documentId: bigint;
    versionId: bigint;
    distance: number;
};

const historicalChunk: ChunkQueryRow = {
    id: 10,
    content: '"schedule a" appears in the historical version',
    page: 1,
    documentId: 2n,
    versionId: 1n,
    distance: 0.1,
};

const currentChunk: ChunkQueryRow = {
    id: 11,
    content: "schedule a appears in the current version",
    page: 2,
    documentId: 2n,
    versionId: 2n,
    distance: 0.2,
};

function containsColumn(value: unknown, column: object, seen = new Set<object>()): boolean {
    if (value === column) return true;
    if (!value || typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);

    if (Array.isArray(value)) {
        return value.some(item => containsColumn(item, column, seen));
    }

    return Object.values(value).some(item => containsColumn(item, column, seen));
}

function rowsForQuery(source: unknown, condition: unknown): unknown[] {
    if (source === document) {
        return [{ id: 2, title: "Unrelated report" }];
    }

    const hasCurrentVersionPredicate =
        containsColumn(condition, documentSections.versionId) &&
        containsColumn(condition, document.currentVersionId);

    return hasCurrentVersionPredicate ? [currentChunk] : [historicalChunk, currentChunk];
}

type QueryChain = {
    from(table: unknown): QueryChain;
    innerJoin(...args: unknown[]): QueryChain;
    where(condition: unknown): QueryChain;
    orderBy(...args: unknown[]): QueryChain;
    limit(limit: number): Promise<unknown[]>;
    then<TResult1 = unknown[], TResult2 = never>(
        onFulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): PromiseLike<TResult1 | TResult2>;
};

function mockPredictiveSelects(): void {
    (db.select as jest.Mock).mockImplementation(() => {
        let source: unknown;
        let condition: unknown;
        const query: QueryChain = {
            from(table) {
                source = table;
                return query;
            },
            innerJoin() {
                return query;
            },
            where(nextCondition) {
                condition = nextCondition;
                return query;
            },
            orderBy() {
                return query;
            },
            limit() {
                return Promise.resolve(rowsForQuery(source, condition));
            },
            then(onFulfilled, onRejected) {
                return Promise.resolve(rowsForQuery(source, condition)).then(
                    onFulfilled,
                    onRejected
                );
            },
        };
        return query;
    });
}

describe("predictive current-version retrieval", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPredictiveSelects();
    });

    it("excludes historical chunks from hybrid results", async () => {
        const results = await hybridSearchWithRRF("schedule a", [2], 8);

        expect(results).toHaveLength(1);
        expect(results[0]?.content).toBe(currentChunk.content);
        expect(results.map(result => result.content)).not.toContain(historicalChunk.content);
    });

    it("excludes historical chunks from matcher exact-reference results", async () => {
        const results = await findSuggestedCompanyDocuments(
            {
                documentType: "agreement",
                documentName: "Schedule A",
                reason: "referenced",
                page: 1,
                priority: "high",
            },
            1,
            1,
            new Map([[2, "Unrelated report"]])
        );

        expect(results).toHaveLength(1);
        expect(results[0]?.snippet).toContain(currentChunk.content);
        expect(results[0]?.snippet).not.toContain(historicalChunk.content);
    });
});

describe("groupContentFromChunks", () => {
    it("formats each chunk with its page header", () => {
        const chunks: PdfChunk[] = [
            { id: 1, page: 1, content: "Introduction" },
            { id: 2, page: 2, content: "Body text" },
        ];
        const result = groupContentFromChunks(chunks);
        expect(result).toContain("=== Page 1 ===");
        expect(result).toContain("Introduction");
        expect(result).toContain("=== Page 2 ===");
        expect(result).toContain("Body text");
    });

    it("returns an empty string for an empty chunk array", () => {
        expect(groupContentFromChunks([])).toBe("");
    });

    it("separates chunks with double newlines", () => {
        const chunks: PdfChunk[] = [
            { id: 1, page: 1, content: "A" },
            { id: 2, page: 2, content: "B" },
        ];
        const result = groupContentFromChunks(chunks);
        expect(result).toMatch(/A\n\n.*B/s);
    });
});

describe("cleanText", () => {
    it("lowercases the input", () => {
        expect(cleanText("HELLO WORLD")).toBe("hello world");
    });

    it("removes non-alphanumeric characters except spaces", () => {
        expect(cleanText("Hello, World! (2024)")).toBe("hello world 2024");
    });

    it("trims leading and trailing whitespace", () => {
        expect(cleanText("  hello  ")).toBe("hello");
    });

    it("returns an empty string for blank input", () => {
        expect(cleanText("")).toBe("");
        expect(cleanText("!!!")).toBe("");
    });
});

describe("extractKeywords", () => {
    it("excludes common stop words", () => {
        const keywords = extractKeywords("the quick brown fox and the lazy dog");
        expect(keywords).not.toContain("the");
        expect(keywords).not.toContain("and");
    });

    it("excludes words at or below minLength", () => {
        // Default minLength is 2; words with length <= 2 should be excluded.
        const keywords = extractKeywords("go up and do it now");
        expect(keywords).not.toContain("go");
        expect(keywords).not.toContain("up");
        expect(keywords).not.toContain("it");
    });

    it("includes words longer than minLength", () => {
        const keywords = extractKeywords("contract financial technical compliance");
        expect(keywords).toContain("contract");
        expect(keywords).toContain("financial");
        expect(keywords).toContain("technical");
        expect(keywords).toContain("compliance");
    });

    it("strips non-alphanumeric characters from words", () => {
        const keywords = extractKeywords("hello! world?");
        expect(keywords).toContain("hello");
        expect(keywords).toContain("world");
    });

    it("respects a custom minLength", () => {
        const keywords = extractKeywords("exhibit schedule addendum", 7);
        // "exhibit" length 7 — borderline; only "schedule" (8) and "addendum" (8) should pass
        expect(keywords).not.toContain("exhibit");
        expect(keywords).toContain("schedule");
        expect(keywords).toContain("addendum");
    });

    it("returns an empty array for input with only stop words", () => {
        expect(extractKeywords("the and or but")).toEqual([]);
    });
});

describe("hasReferencePattern", () => {
    it("detects 'see <documentName>' pattern", () => {
        expect(
            hasReferencePattern(
                "Please see employment contract for details.",
                "employment contract"
            )
        ).toBe(true);
    });

    it("detects 'refer to <documentName>' pattern", () => {
        expect(hasReferencePattern("Please refer to privacy policy.", "privacy policy")).toBe(true);
    });

    it("detects 'as per <documentName>' pattern", () => {
        expect(
            hasReferencePattern("As per service agreement, payment is due.", "service agreement")
        ).toBe(true);
    });

    it("detects 'according to <documentName>' pattern", () => {
        expect(
            hasReferencePattern(
                "According to compliance report, standards are met.",
                "compliance report"
            )
        ).toBe(true);
    });

    it("detects '<documentName> attached' pattern", () => {
        expect(hasReferencePattern("NDA attached for your review.", "nda")).toBe(true);
    });

    it("returns false when no pattern matches", () => {
        expect(hasReferencePattern("This is an unrelated sentence.", "exhibit a")).toBe(false);
    });

    it("is case-insensitive", () => {
        expect(hasReferencePattern("In MASTER AGREEMENT terms apply.", "master agreement")).toBe(
            true
        );
    });
});

describe("calculateTextSimilarity", () => {
    it("returns 1.0 for identical strings", () => {
        expect(calculateTextSimilarity("hello world", "hello world")).toBe(1.0);
    });

    it("returns 0.8 when one string contains the other", () => {
        expect(calculateTextSimilarity("hello world today", "hello world")).toBe(0.8);
    });

    it("returns a Jaccard-based score for partially overlapping strings", () => {
        const score = calculateTextSimilarity("apple banana cherry", "banana cherry date");
        expect(score).toBeGreaterThan(0);
        expect(score).toBeLessThan(1);
    });

    it("returns 0 for completely different strings", () => {
        const score = calculateTextSimilarity("alpha beta gamma", "delta epsilon zeta");
        expect(score).toBe(0);
    });
});

describe("truncateText", () => {
    it("returns the original string when it is within maxLength", () => {
        expect(truncateText("short text", 200)).toBe("short text");
    });

    it("truncates and appends '...' when text exceeds maxLength", () => {
        const long = "a".repeat(300);
        const result = truncateText(long, 200);
        expect(result.length).toBe(200);
        expect(result.endsWith("...")).toBe(true);
    });

    it("uses the default maxLength of 200 when not specified", () => {
        const long = "b".repeat(250);
        const result = truncateText(long);
        expect(result.length).toBe(200);
    });

    it("returns exact-length strings unchanged", () => {
        const exact = "c".repeat(200);
        expect(truncateText(exact, 200)).toBe(exact);
    });
});

describe("hasSpecificIdentifier", () => {
    it("matches 'Exhibit A' pattern", () => {
        expect(hasSpecificIdentifier("Exhibit A")).toBe(true);
    });

    it("matches 'Schedule 1' pattern", () => {
        expect(hasSpecificIdentifier("Schedule 1")).toBe(true);
    });

    it("matches 'Attachment B' pattern", () => {
        expect(hasSpecificIdentifier("Attachment B")).toBe(true);
    });

    it("matches 'Addendum 2A' pattern", () => {
        expect(hasSpecificIdentifier("Addendum 2A")).toBe(true);
    });

    it("matches 'Section 3.1' pattern", () => {
        expect(hasSpecificIdentifier("Section 3.1")).toBe(true);
    });

    it("returns false for generic names without identifiers", () => {
        expect(hasSpecificIdentifier("Supporting Documents")).toBe(false);
    });

    it("returns false for an empty string", () => {
        expect(hasSpecificIdentifier("")).toBe(false);
    });
});
